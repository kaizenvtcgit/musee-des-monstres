import { describe, it, expect } from 'vitest';
import { createInitialWorld } from '../../src/sim/world.js';
import { serializeWorld, deserializeWorld } from '../../src/sim/save.js';
import { standOf, SNACK_STANDS } from '../../src/config/stands.js';

describe('snack stands', () => {
  it('the stand chosen by the player is built, and kept in the saved game', () => {
    const w = createInitialWorld(5);
    w.wallet.money = 10000;
    const r = w.builder.placeBuilding('snack', 25, 30, { variant: 'krakenWaffles' });
    expect(r.ok).toBe(true);
    expect(standOf(w.builder.buildings.get(r.id))).toBe(SNACK_STANDS.krakenWaffles);
    const w2 = deserializeWorld(serializeWorld(w));
    expect(standOf(w2.builder.buildings.get(r.id))).toBe(SNACK_STANDS.krakenWaffles);
    const r2 = w.builder.placeBuilding('snack', 27, 30, { variant: 'dragonGrill' });
    expect(standOf(w.builder.buildings.get(r2.id))).toBe(SNACK_STANDS.dragonGrill);
  });

  it('a stand of an older saved game (no choice stored) keeps the look it had', () => {
    expect(standOf({ id: 'snack7', type: 'snack' })).toBe(SNACK_STANDS.krakenWaffles);
    expect(standOf({ id: 'snack8', type: 'snack' })).toBe(SNACK_STANDS.dragonGrill);
  });
});

describe('standOf with a look from the Snack menu', () => {
  it('waffles and grill are the two stands', () => {
    expect(standOf({ id: 'snack2', look: 'waffles' })).toBe(SNACK_STANDS.krakenWaffles);
    expect(standOf({ id: 'snack3', look: 'grill' })).toBe(SNACK_STANDS.dragonGrill);
    expect(standOf({ id: 'snack3', look: 'grill', variant: 'krakenWaffles' })).toBe(SNACK_STANDS.krakenWaffles);
  });
});
