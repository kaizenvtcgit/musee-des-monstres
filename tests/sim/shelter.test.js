import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder } from '../../src/sim/build.js';
import { BALANCE } from '../../src/config/balance.js';
import { createMonster, targetHappiness, updateShelter } from '../../src/sim/monsters.js';
import { placeMonsterInEnclosure } from '../../src/sim/expeditions.js';
import { createInitialWorld } from '../../src/sim/world.js';
import { serializeWorld, deserializeWorld } from '../../src/sim/save.js';

function setup() {
  const b = new Builder(new Grid(20, 20), new Wallet(100000));
  const id = b.placeEnclosure(2, 2, 6, 6, 'forest').id; // 5 x 5
  return { b, e: b.enclosures.get(id) };
}

describe('shelters', () => {
  it('takes 3 x 3 tiles of an enclosure (big enough for the monsters), one per enclosure, and costs its price', () => {
    const { b, e } = setup();
    expect(BALANCE.shelterSize).toBe(3);
    const money = b.wallet.money;
    expect(b.placeShelter(3, 3).ok).toBe(true);
    expect(b.wallet.money).toBe(money - BALANCE.shelterCost);
    expect(e.shelter).toMatchObject({ tx: 3, ty: 3, size: 3, family: 'forest' });
    expect(b.placeShelter(2, 2).reason).toBe('hasShelter');
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) expect(b.shelterAt(x, y)).not.toBeNull();
    expect(b.shelterAt(6, 6)).toBeNull();
    expect(b.shelterAt(2, 3)).toBeNull();
  });

  it('is refused outside an enclosure, past its edge, in a small one, or on a decoration', () => {
    const { b } = setup();
    expect(b.placeShelter(10, 10).reason).toBe('notInEnclosure');
    expect(b.placeShelter(5, 3).reason).toBe('shelterOutside'); // would reach x = 7
    b.placeDecor(2, 2, 'fern');
    expect(b.placeShelter(2, 2).reason).toBe('occupied');
    const small = b.placeEnclosure(10, 10, 12, 13, 'lava').id; // 3 x 4 = 12 tiles: no room left around it
    expect(BALANCE.shelterMinArea).toBe(15);
    expect(b.placeShelter(10, 10).reason).toBe('enclosureTooSmall');
    expect(b.enclosures.get(small).shelter ?? null).toBeNull();
  });

  it('an old 2 x 2 shelter from a saved game keeps its size', () => {
    const { b, e } = setup();
    e.shelter = { id: 'she99', family: 'forest', tx: 3, ty: 3, price: BALANCE.shelterCost, occupant: null }; // no size
    expect(b.shelterAt(4, 4)).not.toBeNull();
    expect(b.shelterAt(5, 5)).toBeNull();
  });

  it('no decoration can go on it; demolishing it refunds half, without the enclosure', () => {
    const { b, e } = setup();
    b.placeShelter(3, 3);
    expect(b.placeDecor(4, 4, 'fern').reason).toBe('occupied');
    const money = b.wallet.money;
    expect(b.demolish(4, 4).ok).toBe(true);
    expect(e.shelter).toBeNull();
    expect(b.enclosures.has(e.id)).toBe(true);
    expect(b.wallet.money).toBe(money + BALANCE.shelterCost * BALANCE.demolishRefund);
  });

  it('makes the monsters happier', () => {
    const { b, e } = setup();
    const m = createMonster('golem');
    m.hunger = 60;
    const before = targetHappiness(m, e, 0);
    b.placeShelter(3, 3);
    expect(targetHappiness(m, e, 0)).toBe(before + BALANCE.shelterHappiness);
  });

  it('a monster takes refuge in it, alone, then comes out; more often hidden when stressed', () => {
    const { b, e } = setup();
    b.placeShelter(3, 3);
    const a = createMonster('golem'), c = createMonster('golem');
    const monsters = new Map([[a.id, a], [c.id, c]]);
    placeMonsterInEnclosure(a, e);
    placeMonsterInEnclosure(c, e);
    a.happiness = 30; // stressed
    a.shelterCooldown = 0;
    c.shelterCooldown = 0;
    updateShelter(a, e, 0, 1, () => 0, monsters); // rng 0: goes in, hidden
    expect(a.shelter).toBe('inside');
    expect(e.shelter.occupant).toBe(a.id);
    updateShelter(c, e, 0, 1, () => 0, monsters); // the shelter is taken
    expect(c.shelter ?? null).toBeNull();
    updateShelter(a, e, 0, BALANCE.shelterStay[1] + 1, () => 0, monsters); // time is up
    expect(a.shelter).toBeNull();
    expect(e.shelter.occupant).toBeNull();
  });

  it('demolishing the shelter brings its monster out', () => {
    const { b, e } = setup();
    b.placeShelter(3, 3);
    const m = createMonster('golem');
    placeMonsterInEnclosure(m, e);
    m.happiness = 80;
    m.shelter = 'inside';
    b.demolish(3, 3);
    updateShelter(m, e, 0, 0.1, () => 0.5, new Map([[m.id, m]]));
    expect(m.shelter).toBeNull();
  });

  it('is kept in a saved game', () => {
    const w = createInitialWorld(7);
    w.wallet.money = 10000;
    const id = w.builder.placeEnclosure(24, 26, 27, 29, 'forest').id; // 4 x 4 = 16 tiles
    const e = w.builder.enclosures.get(id);
    expect(w.builder.placeShelter(e.x0, e.y0).ok).toBe(true);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(loaded.builder.enclosures.get(id).shelter).toMatchObject({ tx: e.x0, ty: e.y0, size: 3 });
  });
});
