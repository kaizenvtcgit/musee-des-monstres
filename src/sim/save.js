// Saving and loading a whole game as plain JSON data (no browser code here: see src/save/ for storage).
import { World } from './world.js';
import { reserveMonsterIds } from './monsters.js';
import { reserveVisitorIds } from './visitors.js';
import { reserveKeeperIds } from './staff.js';
import { reserveEggIds } from './expeditions.js';

// Bump when the format changes in a way old saves cannot be read (and add a migration if possible).
export const SAVE_VERSION = 1;

const clone = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
const idNumber = (id) => Number(String(id).match(/(\d+)$/)?.[1] ?? 0);
const maxId = (items) => items.reduce((m, x) => Math.max(m, idNumber(x.id)), 0);

export function serializeWorld(w) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    rng: w.rng.getState(),
    time: w.time,
    speed: w.speed,
    ticketPrice: w.ticketPrice,
    spawnTimer: w.spawnTimer,
    totalVisitors: w.totalVisitors,
    reputation: w.reputation,
    recentSatisfaction: [...w.recentSatisfaction],
    escapeTimes: [...w.escapeTimes],
    completedObjectives: [...w.completedObjectives],
    wallet: { money: w.wallet.money, totalEarned: w.wallet.totalEarned },
    grid: { w: w.grid.w, h: w.grid.h, tiles: w.grid.tiles.map((t) => [t.ground, t.occupant, t.bridge ?? null]) },
    builder: {
      nextId: w.builder.nextId,
      enclosures: clone([...w.builder.enclosures.values()]),
      buildings: clone([...w.builder.buildings.values()]),
    },
    monsters: clone([...w.monsters.values()]),
    visitors: clone(w.visitors),
    keepers: clone(w.keepers),
    expedition: clone(w.expeditionBase.active),
    hatchery: { eggs: clone(w.hatchery.eggs), storedIds: w.hatchery.stored.map((m) => m.id) },
  };
}

// Returns a World ready to play, or throws if the data is not a valid save.
export function deserializeWorld(data) {
  if (!data || typeof data !== 'object') throw new Error('No save data');
  if (data.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${data.version}`);
  const w = new World(1);
  w.rng.setState(data.rng);
  Object.assign(w, {
    time: data.time,
    speed: data.speed ?? 1,
    ticketPrice: data.ticketPrice,
    spawnTimer: data.spawnTimer,
    totalVisitors: data.totalVisitors,
    reputation: data.reputation,
    recentSatisfaction: data.recentSatisfaction,
    escapeTimes: data.escapeTimes,
    completedObjectives: new Set(data.completedObjectives),
  });
  w.wallet.money = data.wallet.money;
  w.wallet.totalEarned = data.wallet.totalEarned;

  // the grid, the builder maps and the entity lists are shared with w.ctx: fill them in place
  if (data.grid.w !== w.grid.w || data.grid.h !== w.grid.h) throw new Error('Wrong map size');
  data.grid.tiles.forEach(([ground, occupant, bridge], i) => Object.assign(w.grid.tiles[i], { ground, occupant, bridge: bridge ?? null }));
  w.grid.version++;
  w.builder.nextId = data.builder.nextId;
  for (const e of data.builder.enclosures) w.builder.enclosures.set(e.id, e);
  for (const b of data.builder.buildings) w.builder.buildings.set(b.id, b);
  for (const m of data.monsters) w.monsters.set(m.id, m);
  w.visitors.push(...data.visitors);
  w.keepers.push(...data.keepers);
  w.expeditionBase.active = data.expedition;
  w.hatchery.eggs = data.hatchery.eggs;
  w.hatchery.stored = data.hatchery.storedIds.map((id) => w.monsters.get(id)).filter(Boolean);
  // buildings that are bigger now (the expedition base: 3 x 3)
  for (const b of w.builder.buildings.values()) if (b.fixed) w.builder.growBuilding(b);

  reserveMonsterIds(maxId(data.monsters));
  reserveVisitorIds(maxId(data.visitors));
  reserveKeeperIds(maxId(data.keepers));
  reserveEggIds(maxId(data.hatchery.eggs));
  return w;
}
