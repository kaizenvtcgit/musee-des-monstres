import './ui.css';
import { t } from '../i18n/index.js';
import { BALANCE } from '../config/balance.js';
import { SPECIES, LOCATIONS, HABITATS } from '../config/species.js';
import { ENCLOSURE_DECOR, decorForHabitat } from '../config/decor.js';
import { OBJECTIVES } from '../sim/objectives.js';
import { resolveMonsterTexture, realKey, visitorLook } from './sprites.js';
import { capacity, canBreed } from '../sim/breeding.js';
import { eraseGame } from '../save/storage.js';

const TOOLS = [
  { type: 'select', label: 'tool.select', icon: 'visitor-0' },
  { type: 'path', label: 'tool.path', icon: 'tile-path', price: () => t('tool.perTile', { n: BALANCE.pathCost }) },
  { type: 'enclosure', label: 'tool.enclosure', icon: 'tile-forest', price: () => t('tool.perTile', { n: BALANCE.enclosureCostPerTile }) },
  { type: 'decoration', label: 'tool.decoration', icon: 'decoration', price: () => t('tool.price', { n: BALANCE.decorationCost }) },
  { type: 'snack', label: 'tool.snack', icon: 'snack', price: () => t('tool.price', { n: BALANCE.snackCost }) },
  { type: 'souvenir', label: 'tool.souvenir', icon: 'souvenir', price: () => t('tool.price', { n: BALANCE.souvenirCost }) },
  { type: 'keeper', label: 'tool.keeper', icon: 'keeper', price: () => t('tool.price', { n: BALANCE.keeperHireCost }), action: true },
  { type: 'demolish', label: 'tool.demolish', icon: null },
];

const NEW_GAME_CONFIRM_MS = 3000;
const SAVED_BADGE_MS = 1800;

const LOCATION_HABITAT = { volcano: 'lava', lagoon: 'water', crypt: 'dark', ancientForest: 'forest', glacier: 'ice' };

const fmt = (n) => Math.floor(n).toLocaleString('fr-FR');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bar(pct, invert = false) {
  const v = Math.max(0, Math.min(100, pct));
  const good = invert ? 100 - v : v;
  const cls = good < 25 ? 'bad' : good < 50 ? 'warn' : '';
  return `<div class="bar ${cls}"><div style="width:${v}%"></div></div>`;
}

export function createUI(world, opts = {}) {
  return new UI(world, opts);
}

class UI {
  constructor(world, { resumed = false } = {}) {
    this.world = world;
    this.resumed = resumed;
    this.confirmNewGameUntil = 0;
    this.scene = null;
    this.selection = null;
    this.lastRefresh = 0;
    this.imgCache = new Map();
    this.root = document.getElementById('ui');
    this.root.innerHTML = `
      <div id="hud" class="card"></div>
      <div id="objectives" class="card"></div>
      <div id="toasts"></div>
      <div id="panel" class="card"></div>
      <div id="habitats" class="card"></div>
      <div id="decors" class="card"></div>
      <div id="toolbar" class="card"></div>
      <div id="hint" class="card" style="display:none"></div>
      <div id="help" class="card">${esc(t('hud.help'))}</div>`;
    this.el = (id) => this.root.querySelector(`#${id}`);
    this.el('hud').addEventListener('pointerdown', (e) => this.onHud(e));
    this.el('panel').addEventListener('pointerdown', (e) => this.onPanel(e));
    this.el('toolbar').addEventListener('pointerdown', (e) => this.onToolbar(e));
    this.el('habitats').addEventListener('pointerdown', (e) => this.onHabitat(e));
    this.el('decors').addEventListener('pointerdown', (e) => this.onDecor(e));
    for (const id of ['hud', 'panel', 'toolbar', 'habitats', 'decors', 'objectives']) {
      this.el(id).addEventListener('wheel', (e) => e.stopPropagation());
    }
  }

  bindScene(scene) {
    this.scene = scene;
    this.renderToolbar();
    this.el('habitats').innerHTML = HABITATS.map((h) => `
      <button data-habitat="${h}"><img src="${this.img(`tile-${h}`)}" width="40"><small>${esc(t(`habitat.${h}`))}</small></button>`).join('');
    this.renderDecorPicker();
    this.setTool({ type: 'select' });
    this.refresh(true);
    if (this.resumed) this.toast(t('save.resumed'), 'good');
  }

  // Portrait of a visitor: its 3D character if rendered, else the flat drawing.
  visitorImg(v) {
    const look = visitorLook(v);
    return this.img(look ? look.replace(/^person-visitor/, 'visitor-') : `visitor-${v.variant}`);
  }

  img(rawKey) {
    // the flat people drawings have a 3D version: first frame of the character standing
    const person = rawKey === 'keeper' ? 'person-keeper' : rawKey.replace(/^visitor-(\d+)$/, 'person-visitor$1');
    const sheet = `anim-${person}-idle-d0`;
    if (person !== rawKey && this.scene.textures.exists(sheet)) {
      if (!this.imgCache.has(sheet)) {
        // crop the first frame around the character (frames are 128 px, the body is in the middle)
        const f = this.scene.textures.getFrame(sheet, 0);
        const c = document.createElement('canvas');
        c.width = 56; c.height = 96;
        c.getContext('2d').drawImage(f.source.image, f.cutX + 36, f.cutY + 16, 56, 96, 0, 0, 56, 96);
        this.imgCache.set(sheet, c.toDataURL());
      }
      return this.imgCache.get(sheet);
    }
    const key = realKey(this.scene, rawKey); // prefer the realistic Blender render
    if (!this.imgCache.has(key)) this.imgCache.set(key, this.scene.textures.getBase64(key));
    return this.imgCache.get(key);
  }

  // ---- tools -------------------------------------------------------------

  renderToolbar() {
    this.el('toolbar').innerHTML = TOOLS.map((tool) => `
      <button data-tool="${tool.type}">
        ${tool.icon ? `<img src="${this.img(tool.icon)}" height="22">` : '<span style="font-size:20px">✖</span>'}
        <div>${esc(t(tool.label))}</div>
        ${tool.price ? `<small>${esc(tool.price())}</small>` : ''}
      </button>`).join('');
  }

  setTool(tool) {
    this.tool = tool;
    if (this.scene) this.scene.setTool(tool);
    const DECOR_TOOLS = ['pickDecor', 'decor', 'decoration'];
    let active = tool.type === 'enclosure' || tool.type === 'pickHabitat' ? 'enclosure' : tool.type;
    if (DECOR_TOOLS.includes(tool.type)) active = 'decoration';
    // the picker closes once a decoration is chosen, so it does not hide the map while placing it
    this.el('decors').classList.toggle('open', tool.type === 'pickDecor');
    for (const b of this.el('decors').querySelectorAll('button')) {
      b.classList.toggle('active', tool.type === 'decor' ? b.dataset.decor === tool.decor : tool.type === 'decoration' && b.dataset.garden !== undefined);
    }
    for (const b of this.el('toolbar').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tool === active);
    this.el('habitats').classList.toggle('open', tool.type === 'pickHabitat' || tool.type === 'enclosure');
    for (const b of this.el('habitats').querySelectorAll('button')) b.classList.toggle('active', b.dataset.habitat === tool.habitat);
    let hint = null;
    if (tool.type === 'placeMonster') hint = t('hatchery.pickEnclosure', { habitat: t(`habitat.${tool.habitat}`).toLowerCase() });
    if (tool.type === 'decor') hint = t('decor.hint', { habitat: t(`habitat.${tool.habitat}`).toLowerCase(), name: t(`decor.${tool.decor}`) });
    this.hint(hint);
  }

  onToolbar(e) {
    const btn = e.target.closest('button[data-tool]');
    if (!btn) return;
    const type = btn.dataset.tool;
    if (type === 'keeper') {
      const r = this.world.hireKeeper();
      if (r.ok) this.toast(t('event.keeperHired', { n: BALANCE.keeperSalaryPerMin }), 'good');
      else this.error(r.reason);
      return;
    }
    if (type === 'enclosure') this.setTool({ type: 'pickHabitat' });
    else if (type === 'decoration') this.setTool({ type: 'pickDecor' });
    else this.setTool({ type });
  }

  // The decoration picker: the garden one (on the grass) and three per habitat (inside the enclosures).
  renderDecorPicker() {
    const item = (id) => `
      <button data-decor="${id}" title="${esc(t('decor.enclosureHelp'))}">
        <img src="${this.decorImg(id)}"><small>${esc(t(`decor.${id}`))}</small><small class="price">${esc(t('tool.price', { n: ENCLOSURE_DECOR[id].price }))}</small>
      </button>`;
    this.el('decors').innerHTML = `
      <div class="group"><h4>${esc(t('decor.garden'))}</h4>
        <button data-garden title="${esc(t('decor.gardenHelp'))}"><img src="${this.img('decoration')}"><small>${esc(t('decor.garden'))}</small><small class="price">${esc(t('tool.price', { n: BALANCE.decorationCost }))}</small></button>
      </div>
      ${HABITATS.map((h) => `<div class="group"><h4>${esc(t(`habitat.${h}`))}</h4>${decorForHabitat(h).map((d) => item(d.id)).join('')}</div>`).join('')}`;
  }

  // Icon of a decoration: its first image, cropped around the object.
  decorImg(id) {
    const key = `img-decor-${id}-0`;
    if (!this.scene.textures.exists(key)) return '';
    if (!this.imgCache.has(key)) {
      // crop a square around the visible pixels of the image
      const src = this.scene.textures.get(key).getSourceImage();
      const full = document.createElement('canvas');
      full.width = src.width; full.height = src.height;
      const g = full.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0);
      const a = g.getImageData(0, 0, full.width, full.height).data;
      let x0 = full.width, y0 = full.height, x1 = 0, y1 = 0;
      for (let y = 0; y < full.height; y++) {
        for (let x = 0; x < full.width; x++) {
          if (a[(y * full.width + x) * 4 + 3] < 24) continue;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
      const side = Math.max(x1 - x0, y1 - y0) + 6;
      const c = document.createElement('canvas');
      c.width = c.height = side;
      c.getContext('2d').drawImage(full, (x0 + x1 - side) / 2, (y0 + y1 - side) / 2, side, side, 0, 0, side, side);
      this.imgCache.set(key, c.toDataURL());
    }
    return this.imgCache.get(key);
  }

  onDecor(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.garden !== undefined) this.setTool({ type: 'decoration' });
    else this.setTool({ type: 'decor', decor: btn.dataset.decor, habitat: ENCLOSURE_DECOR[btn.dataset.decor].habitat });
  }

  onHabitat(e) {
    const btn = e.target.closest('button[data-habitat]');
    if (btn) this.setTool({ type: 'enclosure', habitat: btn.dataset.habitat });
  }

  // ---- hud ---------------------------------------------------------------

  onHud(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.speed !== undefined) this.world.setSpeed(Number(btn.dataset.speed));
    if (btn.dataset.ticket) this.world.setTicketPrice(this.world.ticketPrice + Number(btn.dataset.ticket));
    if (btn.dataset.mute !== undefined && this.scene?.sounds) this.scene.sounds.setMuted(!this.scene.sounds.muted);
    if (btn.dataset.newgame !== undefined) {
      // first click asks for confirmation, a second click within a few seconds starts over
      if (performance.now() < this.confirmNewGameUntil) {
        eraseGame();
        window.location.reload();
        return;
      }
      this.confirmNewGameUntil = performance.now() + NEW_GAME_CONFIRM_MS;
      setTimeout(() => this.refresh(true), NEW_GAME_CONFIRM_MS + 50);
    }
    this.refresh(true);
  }

  renderHud() {
    const w = this.world;
    const stars = Math.round(w.reputation * 2) / 2;
    const full = Math.floor(stars);
    const starText = '★'.repeat(full) + (stars > full ? '½' : '') + '<span style="opacity:.3">' + '★'.repeat(5 - Math.ceil(stars)) + '</span>';
    const speedBtn = (s, label) => `<button data-speed="${s}" class="${w.speed === s ? 'active' : ''}">${label}</button>`;
    const moneyColor = w.wallet.money < 0 ? 'color:var(--bad)' : '';
    return `
      <span class="stat" style="${moneyColor}">${esc(t('hud.money', { n: fmt(w.wallet.money) }))}</span>
      <span class="stat">${esc(t('hud.visitors', { n: w.visitors.length }))}</span>
      <span><span class="label">${esc(t('hud.reputation'))}</span><span class="stars">${starText}</span></span>
      <span class="group">${speedBtn(0, '❚❚')}${speedBtn(1, 'x1')}${speedBtn(2, 'x2')}${speedBtn(3, 'x3')}</span>
      <span class="group"><button data-ticket="-5">−</button><span class="stat">${esc(t('hud.ticket', { n: w.ticketPrice }))}</span><button data-ticket="5">+</button></span>
      <span class="group">${this.renderSaveButtons()}</span>`;
  }

  renderSaveButtons() {
    const confirming = performance.now() < this.confirmNewGameUntil;
    const saved = performance.now() - (this.savedAt ?? -1e9) < SAVED_BADGE_MS;
    const muted = this.scene?.sounds?.muted;
    return `<span class="saved ${saved ? 'show' : ''}" title="${esc(t('save.autosave'))}">✓ ${esc(t('save.saved'))}</span>
      <button data-mute title="${esc(t(muted ? 'sound.unmute' : 'sound.mute'))}">${muted ? '🔇' : '🔊'}</button>
      <button data-newgame class="${confirming ? 'danger' : ''}" title="${esc(t('save.newGameHelp'))}">${esc(t(confirming ? 'save.confirmNewGame' : 'save.newGame'))}</button>`;
  }

  // called by the autosave (src/save/storage.js)
  onSaved() {
    this.savedAt = performance.now();
    this.refresh(true);
    setTimeout(() => this.refresh(true), SAVED_BADGE_MS + 50);
  }

  renderObjectives() {
    const w = this.world;
    return `<h3>${esc(t('objective.title'))}</h3><ul>${OBJECTIVES.map((o) => `
      <li class="${w.completedObjectives.has(o.id) ? 'done' : ''}">${w.completedObjectives.has(o.id) ? '✔' : '○'} ${esc(t(`objective.${o.id}`))}</li>`).join('')}</ul>`;
  }

  // ---- panel -------------------------------------------------------------

  select(sel) {
    this.selection = sel;
    this.refresh(true);
  }

  monsterName(m) {
    const name = t(`species.${m.speciesId}`);
    return m.rare ? t('monster.rare', { name }) : name;
  }

  renderPanel() {
    const sel = this.selection;
    const w = this.world;
    if (!sel) return null;
    const close = '<button class="close" data-action="close">✕</button>';

    if (sel.kind === 'monster') {
      const m = w.monsters.get(sel.id);
      if (!m) return null;
      let body = '';
      if (m.state === 'stored') {
        body = `<div class="row">${esc(t('monster.inHatchery'))}</div>
          <button data-action="place" data-id="${m.id}">${esc(t('hatchery.place'))}</button>`;
      } else if (m.state === 'escaped') {
        body = `<div class="row" style="color:var(--bad)">${esc(t('monster.escaped'))}</div>
          <button data-action="catch" data-id="${m.id}">${esc(t('monster.catch'))}</button>`;
      }
      return `${close}<h3><img class="portrait" src="${this.img(resolveMonsterTexture(this.scene, m).key)}">${esc(this.monsterName(m))}</h3>
        <div class="row">${esc(t('monster.habitat', { h: t(`habitat.${SPECIES[m.speciesId].habitat}`) }))}</div>
        <div class="row">${esc(t('monster.happiness', { n: Math.round(m.happiness) }))}${bar(m.happiness)}</div>
        <div class="row">${esc(t('monster.hunger', { n: Math.round(m.hunger) }))}${bar(m.hunger, true)}</div>
        ${body}
        <div class="row"><button data-action="feed" data-id="${m.id}">${esc(t('monster.feed', { n: BALANCE.feedCost }))}</button></div>`;
    }

    if (sel.kind === 'visitor') {
      const v = w.visitors.find((x) => x.id === sel.id);
      if (!v) return null;
      return `${close}<h3><img class="portrait" src="${this.visitorImg(v)}">${esc(t('visitor.title'))}</h3>
        <div class="row">${esc(t(`visitor.mood.${v.mood}`))}</div>
        <div class="row">${esc(t('visitor.satisfaction', { n: Math.round(v.satisfaction * 100) }))}${bar(v.satisfaction * 100)}</div>`;
    }

    if (sel.kind === 'enclosure') {
      const e = w.builder.enclosures.get(sel.id);
      if (!e) return null;
      const head = `${close}<h3><img class="portrait" src="${this.img(`tile-${e.habitat}`)}">${esc(t('tool.enclosure'))} ${esc(t(`habitat.${e.habitat}`))}</h3>
        <div class="row">${esc(t('enclosure.size', { n: e.area }))}</div>`;
      if (!e.monsterIds.length) return `${head}<div class="row">${esc(t('enclosure.empty'))}</div>${this.decorRow(e)}`;
      const max = capacity(e, e.speciesId);
      const list = e.monsterIds.map((id) => w.monsters.get(id)).filter(Boolean).map((m) => `
        <button data-action="open" data-id="${m.id}"><img src="${this.img(resolveMonsterTexture(this.scene, m).key)}">
          <span>${esc(this.monsterName(m))} · ${Math.round(m.happiness)} %${m.state === 'escaped' ? ` · <span style="color:var(--bad)">${esc(t('monster.escapedShort'))}</span>` : ''}</span></button>`).join('');
      const pending = w.hatchery.eggs.filter((egg) => egg.parentEnclosureId === e.id).length;
      let nest;
      if (pending) nest = `<div class="row">${esc(t('enclosure.nestEgg'))}</div>`;
      else if (canBreed(e, w.monsters, 0)) {
        nest = `<div class="row">${esc(t('enclosure.nest', { s: Math.ceil(BALANCE.breedTimeSec - e.breedTimer) }))}${bar(100 * e.breedTimer / BALANCE.breedTimeSec)}</div>`;
      } else if (e.monsterIds.length >= max) nest = `<div class="row">${esc(t('enclosure.nestFull'))}</div>`;
      else nest = `<div class="row">${esc(t('enclosure.nestWaiting'))}</div>`;
      return `${head}<div class="row">${esc(t('enclosure.places', { n: e.monsterIds.length, max }))}</div>
        <div class="list">${list}</div>${nest}${this.decorRow(e)}`;
    }

    if (sel.kind === 'building' && sel.type === 'expeditionBase') {
      const a = w.expeditionBase.active;
      let body;
      if (a) {
        const pct = 100 * (1 - a.remainingSec / a.durationSec);
        body = `<div class="row">${esc(t('expedition.running', { place: t(`location.${a.locationId}`), s: Math.ceil(a.remainingSec) }))}${bar(pct)}</div>`;
      } else {
        body = `<div class="row">${esc(t('expedition.choose'))}</div><div class="list">${Object.values(LOCATIONS).map((l) => `
          <button data-action="expedition" data-loc="${l.id}">
            <img src="${this.img(`tile-${LOCATION_HABITAT[l.id]}`)}">
            <span>${esc(t('expedition.go', { place: t(`location.${l.id}`), s: l.durationSec, n: BALANCE.expeditionCost }))}</span>
          </button>`).join('')}</div>`;
      }
      return `${close}<h3><img class="portrait" src="${this.img('expeditionBase')}">${esc(t('building.expeditionBase'))}</h3>${body}`;
    }

    if (sel.kind === 'building' && sel.type === 'hatchery') {
      const h = w.hatchery;
      const eggs = h.eggs.map((egg) => `<div class="row"><img src="${this.img('egg')}" height="20"> ${
        egg.ready ? esc(t('hatchery.eggReady')) : esc(t('hatchery.egg', { place: t(`location.${egg.locationId}`), s: Math.ceil(egg.remainingSec) }))}</div>`).join('');
      const stored = h.stored.map((m) => `
        <button data-action="place" data-id="${m.id}"><img src="${this.img(resolveMonsterTexture(this.scene, m).key)}"><span>${esc(this.monsterName(m))} — ${esc(t('hatchery.place'))}</span></button>`).join('');
      return `${close}<h3><img class="portrait" src="${this.img('hatchery')}">${esc(t('building.hatchery'))}</h3>
        ${eggs || (h.stored.length ? '' : `<div class="row">${esc(t('hatchery.empty'))}</div>`)}
        <div class="row">${esc(t('hatchery.stored', { n: h.stored.length, max: BALANCE.hatcheryCapacity }))}</div>
        <div class="list">${stored}</div>`;
    }

    if (sel.kind === 'building') {
      return `${close}<h3><img class="portrait" src="${this.img(sel.type)}">${esc(t(`building.${sel.type}`))}</h3>`;
    }
    return null;
  }

  onPanel(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const w = this.world;
    if (action === 'close') this.selection = null;
    if (action === 'feed') {
      const r = w.feedMonster(id);
      if (!r.ok) this.error(r.reason);
    }
    if (action === 'catch') {
      const m = w.monsters.get(id);
      w.catchMonster(id);
      this.onEvent({ type: 'caught', speciesId: m.speciesId });
    }
    if (action === 'expedition') {
      const r = w.startExpedition(btn.dataset.loc);
      if (!r.ok) this.error(r.reason);
    }
    if (action === 'place') {
      const m = w.monsters.get(id);
      this.setTool({ type: 'placeMonster', monsterId: id, speciesId: m.speciesId, habitat: SPECIES[m.speciesId].habitat });
    }
    if (action === 'open') {
      this.selection = { kind: 'monster', id };
    }
    this.refresh(true);
  }

  // Decorations of an enclosure and what they bring (only the first BALANCE.decorMaxCount count).
  decorRow(e) {
    const n = (e.decor ?? []).length;
    if (!n) return `<div class="row muted">${esc(t('enclosure.decorNone'))}</div>`;
    const k = Math.min(n, BALANCE.decorMaxCount);
    return `<div class="row">${esc(t('enclosure.decor', { n, h: k * BALANCE.decorHappiness, a: Math.round(k * BALANCE.decorAppeal * 100) }))}</div>`;
  }

  // ---- messages ----------------------------------------------------------

  toast(text, kind = '') {
    const box = this.el('toasts');
    const div = document.createElement('div');
    div.className = `toast card ${kind}`;
    div.textContent = text;
    box.appendChild(div);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { div.style.opacity = '0'; }, 2600);
    setTimeout(() => div.remove(), 3100);
  }

  error(reason) {
    const now = performance.now();
    if (this.lastError === reason && now - this.lastErrorAt < 800) return;
    this.lastError = reason;
    this.lastErrorAt = now;
    this.toast(t(`error.${reason}`), 'error');
  }

  hint(text) {
    const el = this.el('hint');
    el.style.display = text ? 'block' : 'none';
    if (text) el.textContent = text;
  }

  onEvent(e) {
    const name = (speciesId, rare) => {
      const n = t(`species.${speciesId}`);
      return rare ? t('monster.rare', { name: n }) : n;
    };
    if (e.type === 'escape') this.toast(t('event.escape', { name: name(e.speciesId) }), 'error');
    if (e.type === 'eggReady') this.toast(t('event.eggReady'), 'good');
    if (e.type === 'hatched') this.toast(t('event.hatched', { name: name(e.speciesId, e.rare) }), 'good');
    if (e.type === 'objective') this.toast(t('event.objective', { name: t(`objective.${e.id}`) }), 'good');
    if (e.type === 'laid') this.toast(t('event.laid', { name: name(e.speciesId) }), 'good');
    if (e.type === 'caught') this.toast(t('event.caught', { name: name(e.speciesId) }), 'good');
  }

  // ---- refresh -----------------------------------------------------------

  update() {
    const now = performance.now();
    if (now - this.lastRefresh < 200) return;
    this.refresh();
  }

  refresh() {
    this.lastRefresh = performance.now();
    if (!this.scene) return;
    this.setHtml('hud', this.renderHud());
    this.setHtml('objectives', this.renderObjectives());
    const panel = this.renderPanel();
    this.el('panel').classList.toggle('open', !!panel);
    if (!panel) this.selection = null;
    this.setHtml('panel', panel || '');
  }

  setHtml(id, html) {
    const el = this.el(id);
    if (el._html !== html) {
      el._html = html;
      el.innerHTML = html;
    }
  }
}
