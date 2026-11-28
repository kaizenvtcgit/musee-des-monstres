import { BALANCE } from '../config/balance.js';
import { Grid } from './grid.js';
import { Wallet } from './wallet.js';
import { Builder } from './build.js';
import { createRng } from './rng.js';
import { createMonster, updateMonster, updateShelter, escapeChancePerSec, feed } from './monsters.js';
import { createVisitor, updateVisitor, spawnIntervalSec } from './visitors.js';
import { hireKeeper, escapeMonster, updateEscaped, updateKeeper, catchByClick } from './staff.js';
import { ExpeditionBase, Hatchery, placeMonsterInEnclosure, createEgg } from './expeditions.js';
import { canBreed, breedingParents, rollBabyRare } from './breeding.js';
import { computeReputation } from './reputation.js';
import { checkObjectives, speciesOwned } from './objectives.js';

const MAX_VISITORS = 150;
const MIN_SPAWN_INTERVAL = 0.5;
const SATISFACTION_MEMORY = 20;
const ESCAPE_MEMORY_SEC = 300;

export class World {
  constructor(seed = 1) {
    this.rng = createRng(seed);
    this.grid = new Grid(40, 40);
    this.wallet = new Wallet(BALANCE.startMoney);
    this.builder = new Builder(this.grid, this.wallet);
    this.monsters = new Map();
    this.visitors = [];
    this.keepers = [];
    this.expeditionBase = new ExpeditionBase();
    this.hatchery = new Hatchery();
    this.entrance = { tx: 20, ty: 39 };
    this.ticketPrice = BALANCE.ticketPriceDefault;
    this.speed = 1;
    this.time = 0;
    this.spawnTimer = 0;
    this.totalVisitors = 0;
    this.recentSatisfaction = [];
    this.escapeTimes = [];
    this.reputation = 0;
    this.completedObjectives = new Set();
    this.events = [];
    this.builder.onEnclosureEmptied = (monsterId) => this.#onEnclosureEmptied(monsterId);
    this.builder.onEnclosuresMerged = (fromId, toId) => {
      for (const m of this.monsters.values()) if (m.enclosureId === fromId) m.enclosureId = toId;
    };
    // who stands on a bridge taken down gets off at its nearest end
    this.builder.onBridgeRemoved = (b) => {
      for (const p of [...this.visitors, ...this.keepers]) {
        const tx = Math.round(p.pos.x), ty = Math.round(p.pos.y);
        if (!b.deck.some((c) => c.tx === tx && c.ty === ty)) continue;
        const s = [...b.stairs].sort((a, c) => Math.hypot(a.tx - tx, a.ty - ty) - Math.hypot(c.tx - tx, c.ty - ty))[0];
        p.pos = { x: s.tx, y: s.ty };
        p.tile = { tx: s.tx, ty: s.ty };
        p.path = null;
      }
    };
    this.builder.isBlocked = (x, y) => {
      for (const m of this.monsters.values()) {
        if (m.state !== 'escaped') continue;
        if (m.tile.tx === x && m.tile.ty === y) return true;
        if (m.wanderTarget && m.wanderTarget.tx === x && m.wanderTarget.ty === y) return true;
      }
      return false;
    };
    this.builder.protectedTiles.add(`${this.entrance.tx},${this.entrance.ty}`);
    this.ctx = {
      grid: this.grid,
      builder: this.builder,
      monsters: this.monsters,
      visitors: this.visitors,
      keepers: this.keepers,
      entrance: this.entrance,
      wallet: this.wallet,
      rng: this.rng,
      storeMonster: (m, opts) => this.hatchery.storeMonster(m, opts),
    };
  }

  setSpeed(s) {
    this.speed = s;
  }

  setTicketPrice(p) {
    this.ticketPrice = Math.max(0, Math.min(100, Math.round(p)));
  }

  tick(realDt) {
    const gameDt = realDt * this.speed;
    if (gameDt <= 0) return;
    const n = Math.max(1, Math.ceil(gameDt / BALANCE.maxSubstepSec - 1e-9));
    const dt = gameDt / n;
    for (let i = 0; i < n; i++) this.#step(dt);
  }

  // ---- player actions -------------------------------------------------

  feedMonster(id) {
    const m = this.monsters.get(id);
    if (!m) return { ok: false, reason: 'nothing' };
    if (!this.wallet.spend(BALANCE.feedCost)) return { ok: false, reason: 'noMoney' };
    feed(m);
    return { ok: true };
  }

  hireKeeper() {
    return hireKeeper(this.keepers, this.wallet, this.entrance);
  }

  startExpedition(locationId) {
    return this.expeditionBase.start(locationId, this.wallet);
  }

  placeStoredMonster(monsterId, enclosureId) {
    const m = this.hatchery.stored.find((x) => x.id === monsterId);
    const e = this.builder.enclosures.get(enclosureId);
    if (!m || !e) return { ok: false, reason: 'nothing' };
    const r = placeMonsterInEnclosure(m, e);
    if (r.ok) this.hatchery.takeMonster(monsterId);
    return r;
  }

  catchMonster(id) {
    const m = this.monsters.get(id);
    if (m) catchByClick(m, this.ctx);
  }

  // Number of different habitats with at least one monster on show.
  habitatVariety() {
    const set = new Set();
    for (const e of this.builder.enclosures.values()) {
      if (e.monsterIds.some((id) => this.monsters.get(id)?.state === 'enclosed')) set.add(e.habitat);
    }
    return set.size;
  }

  speciesCount() {
    return speciesOwned(this);
  }

  // ---- simulation -----------------------------------------------------

  // All monsters of a demolished enclosure must fit in the hatchery, otherwise refuse.
  #onEnclosureEmptied(monsterIds) {
    const ms = monsterIds.map((id) => this.monsters.get(id)).filter(Boolean);
    const toStore = ms.filter((m) => m.state !== 'escaped');
    if (this.hatchery.stored.length + toStore.length > BALANCE.hatcheryCapacity) return false;
    for (const m of ms) {
      if (m.state === 'escaped') m.enclosureId = null; // goes to the hatchery when caught
      else this.hatchery.storeMonster(m);
    }
    return true;
  }

  // Is at least one monster on show in an enclosure that touches a path linked to the entrance?
  #hasSomethingToSee() {
    const { grid, builder } = this;
    const shown = [...builder.enclosures.values()]
      .filter((e) => e.monsterIds.some((id) => this.monsters.get(id)?.state === 'enclosed'));
    if (!shown.length) return false;
    // every path tile reachable on foot from the entrance (one breadth-first walk)
    const key = (x, y) => y * grid.w + x;
    const seen = new Set([key(this.entrance.tx, this.entrance.ty)]);
    const queue = [this.entrance];
    for (let i = 0; i < queue.length; i++) {
      for (const n of grid.neighbors4(queue[i].tx, queue[i].ty)) {
        const k = key(n.tx, n.ty);
        if (!seen.has(k) && grid.isPath(n.tx, n.ty)) { seen.add(k); queue.push(n); }
      }
    }
    return shown.some((e) => builder.accessTiles(e.id).some((a) => seen.has(key(a.tx, a.ty))));
  }

  #updateBreeding(dt) {
    for (const e of this.builder.enclosures.values()) {
      const pending = this.hatchery.eggs.filter((egg) => egg.parentEnclosureId === e.id).length;
      if (!canBreed(e, this.monsters, pending)) {
        // pause while conditions are not met; restart only when the pair is gone
        if (breedingParents(e, this.monsters).length < 2 && e.monsterIds.length < 2) e.breedTimer = 0;
        continue;
      }
      e.breedTimer += dt;
      if (e.breedTimer < BALANCE.breedTimeSec) continue;
      e.breedTimer = 0;
      const parents = breedingParents(e, this.monsters);
      this.hatchery.addEgg(createEgg({
        speciesId: e.speciesId, rare: rollBabyRare(parents, this.rng), parentEnclosureId: e.id,
      }));
      this.events.push({ type: 'laid', speciesId: e.speciesId, enclosureId: e.id });
    }
  }

  #step(dt) {
    this.time += dt;
    const watchers = new Map();
    for (const v of this.visitors) {
      if (v.state === 'watching' && v.target) watchers.set(v.target.id, (watchers.get(v.target.id) || 0) + 1);
    }

    for (const m of this.monsters.values()) {
      if (m.state === 'enclosed') {
        const e = this.builder.enclosures.get(m.enclosureId);
        updateMonster(m, e, watchers.get(e.id) || 0, dt);
        updateShelter(m, e, watchers.get(e.id) || 0, dt, this.rng, this.monsters);
        if (this.rng() < escapeChancePerSec(m) * dt && escapeMonster(m, e, this.grid)) {
          this.escapeTimes.push(this.time);
          this.events.push({ type: 'escape', monsterId: m.id, speciesId: m.speciesId });
        }
      } else if (m.state === 'escaped') {
        updateEscaped(m, this.ctx, dt);
      }
    }
    for (const k of this.keepers) updateKeeper(k, this.ctx, dt);

    for (const v of this.visitors) updateVisitor(v, this.ctx, dt);
    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i];
      if (v.state !== 'gone') continue;
      this.recentSatisfaction.push(v.satisfaction);
      if (this.recentSatisfaction.length > SATISFACTION_MEMORY) this.recentSatisfaction.shift();
      this.visitors.splice(i, 1);
    }

    this.spawnTimer += dt;
    const interval = Math.max(MIN_SPAWN_INTERVAL, spawnIntervalSec(this.reputation, this.ticketPrice));
    // nobody comes in (nor pays a ticket) while there is no monster to see from the paths:
    // the timer waits, so the next visitor arrives as soon as one is on show again
    if (this.spawnTimer >= interval && !this.#hasSomethingToSee()) this.spawnTimer = interval;
    else if (this.spawnTimer >= interval && this.visitors.length < MAX_VISITORS) {
      this.spawnTimer = 0;
      this.visitors.push(createVisitor(this.entrance, Math.floor(this.rng() * 4)));
      this.totalVisitors++;
      this.wallet.earn(this.ticketPrice);
    }

    const egg = this.expeditionBase.update(dt, this.rng);
    if (egg) {
      this.hatchery.addEgg(egg);
      this.events.push({ type: 'eggReady', egg });
    }
    this.#updateBreeding(dt);
    for (const m of this.hatchery.update(dt)) {
      this.monsters.set(m.id, m);
      const home = m.homeEnclosureId && this.builder.enclosures.get(m.homeEnclosureId);
      const placed = !!home && placeMonsterInEnclosure(m, home).ok;
      if (placed) this.hatchery.takeMonster(m.id);
      this.events.push({ type: 'hatched', monsterId: m.id, speciesId: m.speciesId, rare: m.rare, placed });
    }

    if (this.keepers.length) this.wallet.charge((BALANCE.keeperSalaryPerMin * this.keepers.length * dt) / 60);

    while (this.escapeTimes.length && this.escapeTimes[0] < this.time - ESCAPE_MEMORY_SEC) this.escapeTimes.shift();
    const sats = this.recentSatisfaction;
    this.reputation = computeReputation({
      avgSatisfaction: sats.length ? sats.reduce((a, b) => a + b, 0) / sats.length : 0.5,
      speciesCount: speciesOwned(this),
      escapesLast5Min: this.escapeTimes.length,
      habitatVariety: this.habitatVariety(),
    });

    for (const id of checkObjectives(this)) this.events.push({ type: 'objective', id });
  }
}

export function createInitialWorld(seed = 1) {
  const w = new World(seed);
  const b = w.builder;
  for (let y = 34; y <= 39; y++) b.placePath(20, y);
  b.placeBuilding('expeditionBase', 21, 37, { free: true, fixed: true });
  b.placeBuilding('hatchery', 18, 37, { free: true, fixed: true });
  const enc = b.placeEnclosure(21, 34, 23, 35, 'forest');
  const golem = createMonster('golem');
  w.monsters.set(golem.id, golem);
  placeMonsterInEnclosure(golem, b.enclosures.get(enc.id));
  w.wallet.money = BALANCE.startMoney;
  w.wallet.totalEarned = 0;
  return w;
}
