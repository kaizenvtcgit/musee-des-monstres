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
  const id = b.placeEnclosure(2, 2, 5, 5, 'forest').id;
  return { b, e: b.enclosures.get(id) };
}

describe('shelters', () => {
  it('takes 2 x 2 tiles of an enclosure, one per enclosure, and costs its price', () => {
    const { b, e } = setup();
    const money = b.wallet.money;
    expect(b.placeShelter(3, 3).ok).toBe(true);
    expect(b.wallet.money).toBe(money - BALANCE.shelterCost);
    expect(e.shelter).toMatchObject({ tx: 3, ty: 3, family: 'forest' });
    expect(b.placeShelter(2, 2).reason).toBe('hasShelter');
    for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) expect(b.shelterAt(x, y)).not.toBeNull();
    expect(b.shelterAt(5, 5)).toBeNull();
  });

  it('is refused outside an enclosure, past its edge, in a small one, or on a decoration', () => {
    const { b } = setup();
    expect(b.placeShelter(10, 10).reason).toBe('notInEnclosure');
    expect(b.placeShelter(5, 3).reason).toBe('shelterOutside');
    b.placeDecor(2, 2, 'fern');
    expect(b.placeShelter(2, 2).reason).toBe('occupied');
    const small = b.placeEnclosure(10, 10, 11, 11, 'lava').id;
    expect(b.placeShelter(10, 10).reason).toBe('enclosureTooSmall');
    expect(b.enclosures.get(small).shelter ?? null).toBeNull();
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
    const e = [...w.builder.enclosures.values()][0];
    // the start enclosure is 3 x 2 = 6 tiles: just big enough
    expect(w.builder.placeShelter(e.x0, e.y0).ok).toBe(true);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect([...loaded.builder.enclosures.values()][0].shelter).toMatchObject({ tx: e.x0, ty: e.y0 });
  });
});
