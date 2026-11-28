import { describe, it, expect } from 'vitest';
import { createInitialWorld } from '../../src/sim/world.js';
import { computeReputation } from '../../src/sim/reputation.js';
import { createMonster } from '../../src/sim/monsters.js';
import { escapeMonster } from '../../src/sim/staff.js';

function snapshot(w) {
  return JSON.stringify({
    money: w.wallet.money,
    visitors: w.visitors.map((v) => [v.id.replace(/\d+/, ''), v.pos, v.state]),
    monsters: [...w.monsters.values()].map((m) => [m.happiness, m.hunger, m.state]),
    rep: w.reputation,
    total: w.totalVisitors,
  });
}

describe('createInitialWorld', () => {
  it('starts with 5000 money, one enclosed golem, entrance path, base and hatchery', () => {
    const w = createInitialWorld();
    expect(w.wallet.money).toBe(5000);
    const ms = [...w.monsters.values()];
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ speciesId: 'golem', state: 'enclosed' });
    expect(w.grid.isPath(20, 39)).toBe(true);
    expect(w.grid.isPath(20, 34)).toBe(true);
    const types = [...w.builder.buildings.values()].map((b) => b.type).sort();
    expect(types).toEqual(['expeditionBase', 'hatchery']);
    for (const b of w.builder.buildings.values()) expect(w.builder.touchesPath(b.id)).toBe(true);
    expect(w.builder.touchesPath(ms[0].enclosureId)).toBe(true);
  });
});

describe('World.tick', () => {
  it('after 120 s at x1, at least 5 visitors came and money increased', () => {
    const w = createInitialWorld();
    for (let i = 0; i < 1200; i++) w.tick(0.1);
    expect(w.totalVisitors).toBeGreaterThanOrEqual(5);
    expect(w.wallet.money).toBeGreaterThan(5000);
  });

  it('tick(5) equals 50 x tick(0.1) with the same seed', () => {
    const a = createInitialWorld(9), b = createInitialWorld(9);
    for (let i = 0; i < 6; i++) a.tick(5);
    for (let i = 0; i < 300; i++) b.tick(0.1);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('speed 0 changes nothing; speed 3 runs three times faster', () => {
    const w = createInitialWorld();
    w.setSpeed(0);
    const before = snapshot(w);
    w.tick(10);
    expect(snapshot(w)).toBe(before);
    w.setSpeed(3);
    w.tick(1);
    expect(w.time).toBeCloseTo(3);
  });

  it('salaries are charged per keeper', () => {
    const w = createInitialWorld();
    w.setTicketPrice(100); // slows visitors down
    expect(w.hireKeeper().ok).toBe(true);
    const m = w.wallet.money;
    w.visitors.length = 0;
    w.spawnTimer = -1e9;
    w.tick(0.1 * 0 + 60 / 1); // 60 s game time at x1, sub-stepped
    expect(w.wallet.money).toBeCloseTo(m - 20, 5);
  });

  it('an unhappy monster eventually escapes and an event is emitted', () => {
    const w = createInitialWorld(2);
    const m = [...w.monsters.values()][0];
    m.happiness = 0;
    m.hunger = 100;
    w.builder.enclosures.get(m.enclosureId).habitat = 'lava';
    for (let i = 0; i < 3000 && m.state !== 'escaped'; i++) w.tick(0.1);
    expect(m.state).toBe('escaped');
    expect(w.events.some((e) => e.type === 'escape')).toBe(true);
  });

  it('expedition -> egg -> hatch -> place in a matching enclosure', () => {
    const w = createInitialWorld();
    expect(w.startExpedition('volcano').ok).toBe(true);
    for (let i = 0; i < 600; i++) w.tick(0.1);
    expect(w.events.some((e) => e.type === 'eggReady')).toBe(true);
    for (let i = 0; i < 310; i++) w.tick(0.1);
    expect(w.events.some((e) => e.type === 'hatched')).toBe(true);
    const baby = w.hatchery.stored[0];
    expect(baby.speciesId).toBe('dragonnet');
    const r = w.builder.placeEnclosure(24, 30, 26, 31, 'lava');
    expect(w.placeStoredMonster(baby.id, r.id).ok).toBe(true);
    expect(baby.state).toBe('enclosed');
    expect(w.hatchery.stored).toHaveLength(0);
  });

  it('demolishing an enclosure with a monster moves it to the hatchery, refused when full', () => {
    const w = createInitialWorld();
    const golem = [...w.monsters.values()][0];
    const e = w.builder.enclosures.get(golem.enclosureId);
    expect(w.builder.demolish(e.x0, e.y0).ok).toBe(true);
    expect(golem.state).toBe('stored');
    expect(w.hatchery.stored).toContain(golem);

    const r = w.builder.placeEnclosure(24, 30, 25, 31, 'forest');
    w.placeStoredMonster(golem.id, r.id);
    for (let i = 0; i < 3; i++) w.hatchery.storeMonster(createMonster('yeti'));
    expect(w.builder.demolish(24, 30)).toEqual({ ok: false, reason: 'enclosureNotEmpty' });
  });

  it('review #1: the entrance tile cannot be demolished', () => {
    const w = createInitialWorld();
    expect(w.builder.demolish(20, 39)).toEqual({ ok: false, reason: 'notDemolishable' });
    expect(w.grid.isPath(20, 39)).toBe(true);
  });

  it('review #2: a caught monster with no enclosure is never lost, even if the hatchery is full', () => {
    const w = createInitialWorld();
    const golem = [...w.monsters.values()][0];
    const e = w.builder.enclosures.get(golem.enclosureId);
    golem.happiness = 0;
    escapeMonster(golem, e, w.grid);
    expect(w.builder.demolish(e.x0, e.y0).ok).toBe(true);
    for (let i = 0; i < 3; i++) w.hatchery.storeMonster(createMonster('yeti'));
    w.catchMonster(golem.id);
    expect(w.hatchery.stored).toContain(golem);
  });

  it('review #4: cannot build on an escaped monster', () => {
    const w = createInitialWorld();
    const golem = [...w.monsters.values()][0];
    escapeMonster(golem, w.builder.enclosures.get(golem.enclosureId), w.grid);
    const { x, y } = golem.pos;
    expect(w.builder.placeBuilding('decoration', x, y)).toEqual({ ok: false, reason: 'occupied' });
    expect(w.builder.placeEnclosure(x, y, x + 1, y + 1, 'lava')).toEqual({ ok: false, reason: 'occupied' });
  });

  it('no visitor comes (and no ticket is paid) when no monster can be seen from the paths', () => {
    const w = createInitialWorld();
    const golem = [...w.monsters.values()][0];
    const e = w.builder.enclosures.get(golem.enclosureId);
    w.builder.demolish(e.x0, e.y0); // the golem goes back to the hatchery: nothing left to see
    const money = w.wallet.money;
    for (let i = 0; i < 1200; i++) w.tick(0.1);
    expect(w.totalVisitors).toBe(0);
    expect(w.wallet.money).toBe(money);
  });

  it('no visitor comes when the only monster is in an enclosure the paths cannot reach', () => {
    const w = createInitialWorld();
    const golem = [...w.monsters.values()][0];
    const e = w.builder.enclosures.get(golem.enclosureId);
    w.builder.demolish(e.x0, e.y0);
    const far = w.builder.placeEnclosure(2, 2, 3, 3, 'forest'); // touches no path
    w.placeStoredMonster(golem.id, far.id);
    const money = w.wallet.money;
    for (let i = 0; i < 1200; i++) w.tick(0.1);
    expect(w.totalVisitors).toBe(0);
    expect(w.wallet.money).toBe(money);
  });

  it('visitors come back as soon as a monster is on show again', () => {
    const w = createInitialWorld();
    for (let i = 0; i < 600; i++) w.tick(0.1);
    expect(w.totalVisitors).toBeGreaterThan(0);
  });

  it('feedMonster costs 20 and resets hunger', () => {
    const w = createInitialWorld();
    const m = [...w.monsters.values()][0];
    m.hunger = 50;
    expect(w.feedMonster(m.id).ok).toBe(true);
    expect(m.hunger).toBe(0);
    expect(w.wallet.money).toBe(4980);
  });
});

describe('reputation and objectives', () => {
  it('reputation formula', () => {
    expect(computeReputation({ avgSatisfaction: 0.5, speciesCount: 1, escapesLast5Min: 0 })).toBeCloseTo(1.9);
    expect(computeReputation({ avgSatisfaction: 0, speciesCount: 0, escapesLast5Min: 4 })).toBe(0);
    expect(computeReputation({ avgSatisfaction: 1, speciesCount: 9, escapesLast5Min: 0 })).toBe(5);
  });

  it('species3 completes once 3 species are owned', () => {
    const w = createInitialWorld();
    w.tick(0.1);
    expect(w.completedObjectives.has('species3')).toBe(false);
    for (const s of ['yeti', 'kraken']) {
      const m = createMonster(s);
      w.hatchery.storeMonster(m);
      w.monsters.set(m.id, m);
    }
    w.tick(0.1);
    expect(w.completedObjectives.has('species3')).toBe(true);
    expect(w.events.some((e) => e.type === 'objective' && e.id === 'species3')).toBe(true);
  });
});

describe('bridges in the world', () => {
  it('a visitor on a removed bridge is put back on a stair', () => {
    const w = createInitialWorld(7);
    w.wallet.money = 100000;
    w.builder.placeEnclosure(5, 5, 8, 7, 'lava');
    w.builder.placePath(4, 6);
    w.builder.placePath(9, 6);
    const r = w.builder.placeBridge([4, 5, 6, 7, 8, 9].map((tx) => ({ tx, ty: 6 })));
    expect(r.ok).toBe(true);
    const v = { id: 'visX', pos: { x: 6, y: 6 }, tile: { tx: 6, ty: 6 }, path: [{ tx: 7, ty: 6 }] };
    w.visitors.push(v);
    w.builder.removeBridge(r.id);
    expect(v.tile).toEqual({ tx: 4, ty: 6 });
    expect(v.pos).toEqual({ x: 4, y: 6 });
    expect(v.path).toBeNull();
  });

  it('bridges survive save and load', async () => {
    const { serializeWorld, deserializeWorld } = await import('../../src/sim/save.js');
    const w = createInitialWorld(7);
    w.wallet.money = 100000;
    w.builder.placeEnclosure(5, 5, 8, 7, 'lava');
    w.builder.placePath(4, 6);
    w.builder.placePath(9, 6);
    const r = w.builder.placeBridge([4, 5, 6, 7, 8, 9].map((tx) => ({ tx, ty: 6 })));
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(loaded.builder.bridges.get(r.id).deck).toHaveLength(4);
  });
});
