import { describe, it, expect } from 'vitest';
import { createInitialWorld } from '../../src/sim/world.js';
import { serializeWorld, deserializeWorld, SAVE_VERSION } from '../../src/sim/save.js';
import { createMonster } from '../../src/sim/monsters.js';

// a museum with some history: paths, a second enclosure, a keeper, an expedition, visitors
function playedWorld() {
  const w = createInitialWorld(42);
  w.wallet.money = 50000;
  for (let x = 21; x <= 30; x++) w.builder.placePath(x, 33);
  w.builder.placeEnclosure(25, 29, 28, 32, 'lava');
  w.hireKeeper();
  w.startExpedition('volcano');
  w.setTicketPrice(25);
  for (let i = 0; i < 120; i++) w.tick(0.5);
  return w;
}

// what must survive a save, without the ids (the id counters are shared by every world in a test run)
function summary(w) {
  return {
    money: Math.round(w.wallet.money * 1000),
    time: w.time,
    visitors: w.visitors.map((v) => [v.state, v.pos.x.toFixed(3), v.pos.y.toFixed(3)]),
    totalVisitors: w.totalVisitors,
    monsters: [...w.monsters.values()].map((m) => [m.speciesId, m.state, m.happiness.toFixed(3)]),
    keepers: w.keepers.map((k) => [k.state, k.pos.x.toFixed(3), k.pos.y.toFixed(3)]),
    enclosures: [...w.builder.enclosures.values()].map((e) => [e.habitat, e.x0, e.y0, e.x1, e.y1, e.monsterIds.length]),
    expedition: w.expeditionBase.active && w.expeditionBase.active.remainingSec.toFixed(3),
    reputation: w.reputation,
    objectives: [...w.completedObjectives],
  };
}

describe('save / load', () => {
  it('a loaded game is identical to the saved one', () => {
    const w = playedWorld();
    const data = JSON.parse(JSON.stringify(serializeWorld(w))); // as stored in the browser
    expect(data.version).toBe(SAVE_VERSION);
    const loaded = deserializeWorld(data);
    expect(summary(loaded)).toEqual(summary(w));
    expect(loaded.grid.tiles).toEqual(w.grid.tiles);
    expect(loaded.ticketPrice).toBe(25);
  });

  it('the game goes on exactly as if it had never been saved', () => {
    const w = playedWorld();
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    for (let i = 0; i < 200; i++) {
      w.tick(0.5);
      loaded.tick(0.5);
    }
    expect(summary(loaded)).toEqual(summary(w));
  });

  it('keeps the monsters waiting in the hatchery and the eggs', () => {
    const w = playedWorld();
    const m = createMonster('kraken');
    w.monsters.set(m.id, m);
    w.hatchery.storeMonster(m);
    w.expeditionBase.finishNow();
    w.tick(0.1);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(loaded.hatchery.stored.map((x) => x.speciesId)).toContain('kraken');
    // the hatchery holds the same objects as the monster list
    for (const s of loaded.hatchery.stored) expect(loaded.monsters.get(s.id)).toBe(s);
    expect(loaded.hatchery.eggs.length).toBe(w.hatchery.eggs.length);
  });

  it('new monsters after loading never reuse an id of the loaded game', () => {
    const w = playedWorld();
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    const fresh = createMonster('golem');
    expect(loaded.monsters.has(fresh.id)).toBe(false);
  });

  it('refuses data that is not a save of this version', () => {
    expect(() => deserializeWorld(null)).toThrow();
    expect(() => deserializeWorld({ version: 999 })).toThrow();
  });
});
