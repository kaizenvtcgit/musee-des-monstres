import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder } from '../../src/sim/build.js';
import { containsTile, tilesOf, centerOf } from '../../src/sim/enclosure.js';
import { World } from '../../src/sim/world.js';

function setup(money = 1e6) {
  const grid = new Grid(40, 40);
  const wallet = new Wallet(money);
  return { grid, wallet, builder: new Builder(grid, wallet) };
}

describe('enclosure merging', () => {
  it('two enclosures of the same habitat sharing a side become one', () => {
    const { grid, builder } = setup();
    const a = builder.placeEnclosure(2, 2, 4, 4, 'lava');
    const b = builder.placeEnclosure(5, 2, 6, 6, 'lava'); // right of a, taller: an L shape
    expect(b.merged).toBe(true);
    expect(b.id).toBe(a.id);
    expect(builder.enclosures.size).toBe(1);
    const e = builder.enclosures.get(a.id);
    expect(e.area).toBe(9 + 10);
    expect(tilesOf(e)).toHaveLength(19);
    expect(grid.getTile(6, 6).occupant).toBe(a.id);
    expect(containsTile(e, 3, 6)).toBe(false); // outside the L, inside the bounding box
    expect(grid.getTile(3, 6).occupant).toBe(null);
    expect([e.x0, e.y0, e.x1, e.y1]).toEqual([2, 2, 6, 6]);
    expect(containsTile(e, Math.round(centerOf(e).x), Math.round(centerOf(e).y))).toBe(true);
  });

  it('does not merge different habitats, nor enclosures touching only by a corner', () => {
    const { builder } = setup();
    builder.placeEnclosure(2, 2, 4, 4, 'lava');
    expect(builder.placeEnclosure(5, 2, 6, 4, 'water').merged).toBeUndefined();
    expect(builder.placeEnclosure(5, 5, 6, 6, 'lava').merged).toBeUndefined();
    expect(builder.enclosures.size).toBe(3);
  });

  it('a new enclosure between two of the same habitat joins all three', () => {
    const { builder } = setup();
    const a = builder.placeEnclosure(2, 2, 3, 3, 'ice');
    builder.placeEnclosure(6, 2, 7, 3, 'ice');
    const c = builder.placeEnclosure(4, 2, 5, 3, 'ice');
    expect(c.id).toBe(a.id);
    expect(builder.enclosures.size).toBe(1);
    expect(builder.enclosures.get(a.id).area).toBe(12);
  });

  it('demolishing a merged enclosure frees all its tiles and refunds the whole price', () => {
    const { grid, wallet, builder } = setup();
    const a = builder.placeEnclosure(2, 2, 3, 3, 'forest');
    builder.placeEnclosure(2, 4, 5, 5, 'forest');
    const before = wallet.money;
    expect(builder.demolish(5, 5).ok).toBe(true);
    expect(builder.enclosures.size).toBe(0);
    expect(grid.getTile(2, 2).occupant).toBe(null);
    expect(grid.getTile(5, 5).occupant).toBe(null);
    expect(wallet.money).toBeGreaterThan(before);
    expect(a.ok).toBe(true);
  });

  it('a shelter must stand fully inside the shape', () => {
    const { builder } = setup();
    const a = builder.placeEnclosure(2, 2, 4, 4, 'lava');
    builder.placeEnclosure(5, 2, 7, 7, 'lava');
    expect(builder.placeShelter(4, 4).reason).toBe('shelterOutside'); // 3 x 3: (4,5) is outside the L
    expect(builder.placeShelter(5, 5).ok).toBe(true);
    expect(a.ok).toBe(true);
  });

  it('path tiles along any side of the shape give access', () => {
    const { builder } = setup();
    const a = builder.placeEnclosure(2, 2, 4, 4, 'lava');
    builder.placeEnclosure(5, 2, 6, 6, 'lava');
    builder.placePath(3, 6); // in the notch of the L: touches no tile of it
    expect(builder.touchesPath(a.id)).toBe(false);
    builder.placePath(4, 6); // next to (5, 6), the foot of the L
    expect(builder.accessTiles(a.id)).toEqual([{ tx: 4, ty: 6 }]);
  });

  it('monsters of the merged enclosure follow it', () => {
    const w = new World(3);
    w.wallet.money = 1e6;
    const a = w.builder.placeEnclosure(2, 20, 4, 22, 'lava');
    const b = w.builder.placeEnclosure(2, 25, 4, 27, 'lava');
    const m = { id: 'mX', enclosureId: b.id };
    w.monsters.set(m.id, m);
    w.builder.enclosures.get(b.id).monsterIds.push(m.id);
    const before = w.builder.enclosures.size;
    w.builder.placeEnclosure(2, 23, 4, 24, 'lava'); // the strip in between joins them
    expect(w.builder.enclosures.size).toBe(before - 1);
    expect(m.enclosureId).toBe(a.id);
    expect(w.builder.enclosures.get(a.id).monsterIds).toContain('mX');
  });
});

describe('merging under a bridge', () => {
  it('bridge tiles keep their bridge after a merge', () => {
    const { grid, builder } = setup();
    builder.placeEnclosure(3, 4, 6, 6, 'lava');
    builder.placePath(2, 5);
    builder.placePath(7, 5);
    const r = builder.placeBridge([2, 3, 4, 5, 6, 7].map((tx) => ({ tx, ty: 5 })));
    expect(r.ok).toBe(true);
    expect(builder.placeEnclosure(3, 7, 6, 9, 'lava').merged).toBe(true);
    for (const tx of [3, 4, 5, 6]) expect(grid.getTile(tx, 5).bridge).toBe(r.id);
  });
});
