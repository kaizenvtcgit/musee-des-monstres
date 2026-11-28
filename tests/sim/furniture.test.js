import { describe, it, expect } from 'vitest';
import { createInitialWorld } from '../../src/sim/world.js';
import { serializeWorld, deserializeWorld } from '../../src/sim/save.js';

describe('furniture and snack menus', () => {
  it('a building keeps the look picked in its menu, through a save', () => {
    const w = createInitialWorld(1);
    w.wallet.money = 1e5;
    const bench = w.builder.placeBuilding('decoration', 18, 33, { look: 'parkBench' }).id;
    const grill = w.builder.placeBuilding('snack', 18, 34, { look: 'grill' }).id;
    const old = w.builder.placeBuilding('decoration', 18, 35).id; // as older games: no look
    expect(w.builder.buildings.get(bench).look).toBe('parkBench');
    expect(w.builder.buildings.get(grill).look).toBe('grill');
    expect('look' in w.builder.buildings.get(old)).toBe(false);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.builder.buildings.get(bench).look).toBe('parkBench');
    expect(back.builder.buildings.get(grill).look).toBe('grill');
  });
});
