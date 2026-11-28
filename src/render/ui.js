import './ui.css';
import { t } from '../i18n/index.js';
import { BALANCE } from '../config/balance.js';
import { SPECIES, LOCATIONS, HABITAT_FAMILIES, offeredHabitatsOfFamily } from '../config/species.js';
import { ENCLOSURE_DECOR, decorForHabitat, SHELTERS } from '../config/decor.js';
import { OBJECTIVES } from '../sim/objectives.js';
import { realKey } from './sprites.js';
import { PLACES } from '../sim/parking.js';
import { monsterTextureKey } from './textures.js';
import { capacity, canBreed } from '../sim/breeding.js';
import { eraseGame } from '../save/storage.js';

const TOOLS = [
  { type: 'select', label: 'tool.select', icon: 'visitor-0' },
  { type: 'path', label: 'tool.path', icon: 'tile-path', price: () => t('tool.perTile', { n: BALANCE.pathCost }) },
  { type: 'enclosure', label: 'tool.enclosure', icon: 'tile-forest', price: () => t('tool.perTile', { n: BALANCE.enclosureCostPerTile }) },
  { type: 'decoration', label: 'tool.decoration', icon: 'decoration', price: () => t('tool.from', { n: 100 }) },
  { type: 'furniture', label: 'tool.furniture', icon: 'furniture', price: () => t('tool.from', { n: BALANCE.decorationCost }) },
  { type: 'snack', label: 'tool.snack', icon: 'snack', price: () => t('tool.price', { n: BALANCE.snackCost }) },
  { type: 'souvenir', label: 'tool.souvenir', icon: 'souvenir', price: () => t('tool.price', { n: BALANCE.souvenirCost }) },
  { type: 'parking', label: 'tool.parking', icon: 'parking', price: () => t('tool.price', { n: BALANCE.parkingCost }) },
  { type: 'keeper', label: 'tool.keeper', icon: 'keeper', price: () => t('tool.price', { n: BALANCE.keeperHireCost }), action: true },
  { type: 'demolish', label: 'tool.demolish', icon: null },
];

// The Furniture menu: the garden decorations (one look each: src/render3d/park-scene.js GARDEN) and the cash
// machine; the Snack menu: its two stands.
const FURNITURE = ['parkBench', 'trashCan', 'streetLamp', 'pottedPlant', 'shrubClump', 'flowerBox', 'mossRocks', 'atm'];
const SNACKS = ['waffles', 'grill'];

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
  constructor(world, { resumed = false, testMode = false } = {}) {
    this.world = world;
    this.resumed = resumed;
    this.testMode = testMode;
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
      <div id="shop" class="card"></div>
      <div id="toolbar" class="card"></div>
      <div id="hint" class="card" style="display:none"></div>
      <div id="help" class="card">${esc(t('hud.help'))}</div>
      ${testMode ? `<div id="testbadge" class="card" title="${esc(t('test.help'))}">${esc(t('test.badge'))}</div>` : ''}`;
    this.el = (id) => this.root.querySelector(`#${id}`);
    this.el('hud').addEventListener('pointerdown', (e) => this.onHud(e));
    this.el('panel').addEventListener('pointerdown', (e) => this.onPanel(e));
    this.el('toolbar').addEventListener('pointerdown', (e) => this.onToolbar(e));
    this.el('habitats').addEventListener('pointerdown', (e) => this.onHabitat(e));
    this.el('decors').addEventListener('pointerdown', (e) => this.onDecor(e));
    this.el('shop').addEventListener('pointerdown', (e) => this.onShop(e));
    for (const id of ['hud', 'panel', 'toolbar', 'habitats', 'decors', 'shop', 'objectives']) {
      this.el(id).addEventListener('wheel', (e) => e.stopPropagation());
    }
  }

  // the 3D view (src/render3d/park3d.js), which shows the park
  bindView3d(view) {
    this.view3d = view;
  }

  bindScene(scene) {
    this.scene = scene;
    this.view3d?.setScene(scene);
    this.renderToolbar();
    // habitats grouped by the monster that lives there
    this.el('habitats').innerHTML = HABITAT_FAMILIES.map((f) => `<div class="group"><h4>${esc(this.familySpecies(f))}</h4>
      ${offeredHabitatsOfFamily(f).map((h) => `<button data-habitat="${h}"><img src="${this.img(`tile-${h}`)}" width="40"><small>${esc(t(`habitat.${h}`))}</small></button>`).join('')}</div>`).join('');
    this.renderDecorPicker();
    this.setTool({ type: 'select' });
    this.refresh(true);
    if (this.resumed) this.toast(t('save.resumed'), 'good');
  }

  // the 3D view (src/render3d/park3d.js), which shows the park and draws the portraits
  // (portraits of the 3D models: monsters, visitors, keepers; a flat drawing until it is ready)
  monsterImg(m) {
    return this.view3d?.portrait({ kind: 'monster', id: m.id, speciesId: m.speciesId }) ?? this.img(monsterTextureKey(m));
  }

  visitorImg(v) {
    return this.view3d?.portrait({ kind: 'visitor', id: v.id }) ?? this.img(`visitor-${v.variant}`);
  }

  keeperImg(k) {
    return this.view3d?.portrait({ kind: 'keeper', id: k.id }) ?? this.img('keeper');
  }

  // The game cannot be shown (no 3D in this browser): a message instead.
  fatal(text) {
    this.root.insertAdjacentHTML('beforeend', `<div class="card fatal">${esc(text)}</div>`);
  }

  img(rawKey) {
    const key = realKey(this.scene, rawKey); // prefer the icon (Blender render)
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
    const DECOR_TOOLS = ['pickDecor', 'decor', 'shelter'];
    let active = tool.type === 'enclosure' || tool.type === 'pickHabitat' ? 'enclosure' : tool.type;
    if (DECOR_TOOLS.includes(tool.type)) active = 'decoration';
    if (['pickFurniture', 'decoration', 'atm'].includes(tool.type)) active = 'furniture';
    if (tool.type === 'pickSnack') active = 'snack';
    // the Furniture and Snack menus (they close once something is chosen, like the decorations)
    const shop = tool.type === 'pickFurniture' || tool.type === 'pickSnack';
    this.el('shop').classList.toggle('open', shop);
    if (shop) this.renderShop();
    // the picker closes once a decoration is chosen, so it does not hide the map while placing it
    this.el('decors').classList.toggle('open', tool.type === 'pickDecor');
    for (const b of this.el('decors').querySelectorAll('button')) {
      b.classList.toggle('active', tool.type === 'decor' ? b.dataset.decor === tool.decor : tool.type === 'decoration' && b.dataset.garden !== undefined);
    }
    for (const b of this.el('toolbar').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tool === active);
    this.el('habitats').classList.toggle('open', tool.type === 'pickHabitat' || tool.type === 'enclosure');
    for (const b of this.el('habitats').querySelectorAll('button')) b.classList.toggle('active', b.dataset.habitat === tool.habitat);
    let hint = null;
    if (tool.type === 'placeMonster') hint = t('hatchery.pickEnclosure', { habitat: this.habitatNames(tool.habitat).toLowerCase() });
    if (tool.type === 'shelter') hint = t('shelter.hint', { name: t(`shelter.${SHELTERS[tool.family]}`), habitat: this.habitatNames(tool.family).toLowerCase() });
    if (tool.type === 'parking') hint = t('parking.hint');
    if (tool.type === 'decoration' && tool.look) hint = t('furniture.hint', { name: t(`furniture.${tool.look}`) });
    if (tool.type === 'atm') hint = t('furniture.hint', { name: t('furniture.atm') });
    if (tool.type === 'snack' && tool.look) hint = t('furniture.hint', { name: t(`snack.${tool.look}`) });
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
    else if (type === 'furniture') this.setTool({ type: 'pickFurniture' });
    else if (type === 'snack') this.setTool({ type: 'pickSnack' });
    else this.setTool({ type });
  }

  // The Furniture or Snack menu: what can be placed, with a picture of its 3D model (a drawing until ready).
  renderShop() {
    const snack = this.tool.type === 'pickSnack';
    const keys = snack ? SNACKS : FURNITURE;
    this.shopMissing = false;
    const item = (k) => {
      const pic = this.view3d?.thingPortrait(k);
      if (!pic) this.shopMissing = true;
      const name = snack ? t(`snack.${k}`) : t(`furniture.${k}`);
      const price = snack ? BALANCE.snackCost : k === 'atm' ? BALANCE.atmCost : BALANCE.decorationCost;
      const help = snack ? t('snack.help') : k === 'atm' ? t('atm.effect', { n: Math.round((BALANCE.atmSpendBonus - 1) * 100) }) : t('decor.gardenHelp');
      return `<button data-thing="${k}" title="${esc(help)}"><img src="${pic ?? this.img(snack ? 'snack' : k === 'atm' ? 'atm' : 'decoration')}"><small>${esc(name)}</small><small class="price">${esc(t('tool.price', { n: price }))}</small></button>`;
    };
    const html = `<h4>${esc(t(snack ? 'snack.title' : 'furniture.title'))}</h4><div class="items">${keys.map(item).join('')}</div>`;
    if (this.el('shop').innerHTML !== html) this.el('shop').innerHTML = html;
  }

  onShop(e) {
    const btn = e.target.closest('button[data-thing]');
    if (!btn) return;
    const k = btn.dataset.thing;
    if (SNACKS.includes(k)) this.setTool({ type: 'snack', look: k });
    else if (k === 'atm') this.setTool({ type: 'atm' });
    else this.setTool({ type: 'decoration', look: k });
  }

  // The decoration picker: three per habitat (inside the enclosures) and the shelter.
  renderDecorPicker() {
    const item = (id) => `
      <button data-decor="${id}" title="${esc(t('decor.enclosureHelp'))}">
        <img src="${this.decorImg(id)}"><small>${esc(t(`decor.${id}`))}</small><small class="price">${esc(t('tool.price', { n: ENCLOSURE_DECOR[id].price }))}</small>
      </button>`;
    // a tab per monster family, then its three habitats with their decorations
    this.decorFamily ??= 'lava';
    const tabs = HABITAT_FAMILIES.map((f) => `<button data-family="${f}" class="${f === this.decorFamily ? 'active' : ''}">${esc(this.familySpecies(f))}</button>`).join('');
    this.el('decors').innerHTML = `
      <div class="tabs">${tabs}</div>
      <div class="cols">
        <div class="group"><h4>${esc(t('shelter.title'))}</h4>
          <button data-shelter="${this.decorFamily}" title="${esc(t('shelter.help'))}"><img src="${this.shelterImg(this.decorFamily)}"><small>${esc(t(`shelter.${SHELTERS[this.decorFamily]}`))}</small><small class="price">${esc(t('tool.price', { n: BALANCE.shelterCost }))}</small></button>
        </div>
        ${offeredHabitatsOfFamily(this.decorFamily).map((h) => `<div class="group"><h4>${esc(t(`habitat.${h}`))}</h4>${decorForHabitat(h).map((d) => item(d.id)).join('')}</div>`).join('')}
      </div>`;
  }

  // "Lave, Champ de cendres ou Canyon de basalte": the habitats of a family.
  habitatNames(family) {
    const names = offeredHabitatsOfFamily(family).map((h) => t(`habitat.${h}`));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('habitat.or')} ${names.at(-1)}` : names[0];
  }

  // Name of the monster living in a habitat family ("Dragonnet" for lava).
  familySpecies(family) {
    const sp = Object.values(SPECIES).find((s) => s.habitat === family);
    return sp ? t(`species.${sp.id}`) : t(`habitat.${family}`);
  }

  // Icon of a decoration: its first image, cropped around the object.
  decorImg(id) {
    const key = `decor-${id}`;
    const atlas = 'img-decor-atlas';
    if (!this.scene.textures.exists(atlas)) return '';
    if (!this.imgCache.has(key)) {
      // its first image in the atlas, cropped to a square around the visible pixels
      const f = this.scene.textures.getFrame(atlas, Object.keys(ENCLOSURE_DECOR).indexOf(id) * 2);
      const full = document.createElement('canvas');
      full.width = f.cutWidth; full.height = f.cutHeight;
      const g = full.getContext('2d', { willReadFrequently: true });
      g.drawImage(f.source.image, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
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

  // Icon of the shelter of a family, cropped around it.
  shelterImg(family) {
    const key = `img-shelter-${family}`;
    if (!this.scene.textures.exists(key)) return '';
    if (!this.imgCache.has(key)) {
      const src = this.scene.textures.get(key).getSourceImage();
      const c = document.createElement('canvas');
      c.width = 200; c.height = 170;
      const s = src.width / 288; // crop made for the 288 px images; the remodelled 3 x 3 ones are bigger
      c.getContext('2d').drawImage(src, 44 * s, 90 * s, 200 * s, 170 * s, 0, 0, 200, 170);
      this.imgCache.set(key, c.toDataURL());
    }
    return this.imgCache.get(key);
  }

  onDecor(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.shelter) {
      this.setTool({ type: 'shelter', family: btn.dataset.shelter });
      return;
    }
    if (btn.dataset.family) {
      this.decorFamily = btn.dataset.family;
      this.renderDecorPicker();
      return;
    }
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
    // walk <-> view from above
    if (btn.dataset.visit !== undefined) this.view3d?.toggleWalk();
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
      <span class="stat" style="${moneyColor}">${esc(t('hud.money', { n: w.wallet.unlimited ? '∞' : fmt(w.wallet.money) }))}</span>
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
    const walking = this.view3d?.mode === 'walk';
    return `<span class="saved ${saved ? 'show' : ''}" title="${esc(t('save.autosave'))}">✓ ${esc(t('save.saved'))}</span>
      <button data-visit title="${esc(t(walking ? 'view.top.help' : 'visit.button.help'))}">${esc(t(walking ? 'view.top' : 'visit.button'))}</button>
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
      return `${close}<h3><img class="portrait" src="${this.monsterImg(m)}">${esc(this.monsterName(m))}</h3>
        <div class="row">${esc(t('monster.habitat', { h: this.habitatNames(SPECIES[m.speciesId].habitat) }))}</div>
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

    if (sel.kind === 'parking') {
      const p = w.parking;
      if (!p) return null;
      const used = p.cars.filter((c) => c.state !== 'leaving').length;
      return `${close}<h3><img class="portrait" src="${this.img('parking')}">${esc(t('parking.title'))}</h3>
        <div class="row">${esc(t('parking.places', { n: used, max: PLACES }))}${bar((used / PLACES) * 100)}</div>
        <div class="row">${esc(t('parking.bonus', { n: Math.round((BALANCE.parkingVisitorBonus - 1) * 100) }))}</div>
        <div class="row"><button data-action="demolishParking">${esc(t('parking.demolish', { n: Math.round(p.price * BALANCE.demolishRefund) }))}</button></div>`;
    }

    if (sel.kind === 'keeper') {
      const k = w.keepers.find((x) => x.id === sel.id);
      if (!k) return null;
      const target = k.state === 'chasing' && w.monsters.get(k.targetMonsterId);
      return `${close}<h3><img class="portrait" src="${this.keeperImg(k)}">${esc(t('keeper.title'))}</h3>
        <div class="row">${esc(target ? t('keeper.chasing', { name: this.monsterName(target) }) : t('keeper.patrol'))}</div>
        <div class="row">${esc(t('keeper.salary', { n: BALANCE.keeperSalaryPerMin }))}</div>`;
    }

    if (sel.kind === 'enclosure') {
      const e = w.builder.enclosures.get(sel.id);
      if (!e) return null;
      const head = `${close}<h3><img class="portrait" src="${this.img(`tile-${e.habitat}`)}">${esc(t('tool.enclosure'))} ${esc(t(`habitat.${e.habitat}`))}</h3>
        <div class="row">${esc(t('enclosure.size', { n: e.area }))}</div>`;
      if (!e.monsterIds.length) return `${head}<div class="row">${esc(t('enclosure.empty'))}</div>${this.shelterRow(e)}${this.decorRow(e)}`;
      const max = capacity(e, e.speciesId);
      const list = e.monsterIds.map((id) => w.monsters.get(id)).filter(Boolean).map((m) => `
        <button data-action="open" data-id="${m.id}"><img src="${this.monsterImg(m)}">
          <span>${esc(this.monsterName(m))} · ${Math.round(m.happiness)} %${m.state === 'escaped' ? ` · <span style="color:var(--bad)">${esc(t('monster.escapedShort'))}</span>` : ''}</span></button>`).join('');
      const pending = w.hatchery.eggs.filter((egg) => egg.parentEnclosureId === e.id).length;
      let nest;
      if (pending) nest = `<div class="row">${esc(t('enclosure.nestEgg'))}</div>`;
      else if (canBreed(e, w.monsters, 0)) {
        nest = `<div class="row">${esc(t('enclosure.nest', { s: Math.ceil(BALANCE.breedTimeSec - e.breedTimer) }))}${bar(100 * e.breedTimer / BALANCE.breedTimeSec)}</div>`;
      } else if (e.monsterIds.length >= max) nest = `<div class="row">${esc(t('enclosure.nestFull'))}</div>`;
      else nest = `<div class="row">${esc(t('enclosure.nestWaiting'))}</div>`;
      return `${head}<div class="row">${esc(t('enclosure.places', { n: e.monsterIds.length, max }))}</div>
        <div class="list">${list}</div>${nest}${this.shelterRow(e)}${this.decorRow(e)}`;
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
        <button data-action="place" data-id="${m.id}"><img src="${this.monsterImg(m)}"><span>${esc(this.monsterName(m))} — ${esc(t('hatchery.place'))}</span></button>`).join('');
      return `${close}<h3><img class="portrait" src="${this.img('hatchery')}">${esc(t('building.hatchery'))}</h3>
        ${eggs || (h.stored.length ? '' : `<div class="row">${esc(t('hatchery.empty'))}</div>`)}
        <div class="row">${esc(t('hatchery.stored', { n: h.stored.length, max: BALANCE.hatcheryCapacity }))}</div>
        <div class="list">${stored}</div>`;
    }

    if (sel.kind === 'building' && sel.type === 'atm') {
      return `${close}<h3><img class="portrait" src="${this.img('atm')}">${esc(t('building.atm'))}</h3>
        <div class="row">${esc(t('atm.effect', { n: Math.round((BALANCE.atmSpendBonus - 1) * 100) }))}</div>`;
    }
    if (sel.kind === 'building') {
      // a garden decoration or a snack: the one picked in its menu
      const look = w.builder.buildings.get(sel.id)?.look;
      const name = look ? t(sel.type === 'snack' ? `snack.${look}` : `furniture.${look}`) : t(`building.${sel.type}`);
      const pic = (look && this.view3d?.thingPortrait(look)) || this.img(sel.type);
      return `${close}<h3><img class="portrait" src="${pic}">${esc(name)}</h3>`;
    }
    return null;
  }

  onPanel(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const w = this.world;
    if (action === 'close') this.selection = null;
    if (action === 'demolishParking') {
      w.demolishParking();
      this.selection = null;
    }
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

  // The shelter of an enclosure, and who is in it.
  shelterRow(e) {
    if (!e.shelter) return `<div class="row muted">${esc(t('enclosure.shelterNone'))}</div>`;
    const m = e.shelter.occupant && this.world.monsters.get(e.shelter.occupant);
    const who = m && m.shelter ? ` · ${esc(t(m.shelter === 'inside' ? 'shelter.inside' : 'shelter.entrance', { name: this.monsterName(m) }))}` : '';
    return `<div class="row">${esc(t(`shelter.${SHELTERS[e.shelter.family]}`))} · ${esc(t('enclosure.shelterBonus', { h: BALANCE.shelterHappiness }))}${who}</div>`;
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

  // `bad`: shown in red (a price the player cannot pay)
  hint(text, bad = false) {
    const el = this.el('hint');
    el.style.display = text ? 'block' : 'none';
    el.classList.toggle('bad', !!text && bad);
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
    if (this.shopMissing && this.el('shop').classList.contains('open')) this.renderShop();
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
