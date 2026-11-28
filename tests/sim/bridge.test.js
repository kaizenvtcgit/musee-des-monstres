import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder } from '../../src/sim/build.js';
import { extendTrace, checkBridge, bridgeHeightAt } from '../../src/sim/bridge.js';
import { BALANCE } from '../../src/config/balance.js';

const row = (x0, x1, y) => Array.from({ length: x1 - x0 + 1 }, (_, i) => ({ tx: x0 + i, ty: y }));

// a lava enclosure on x 3..6, y 4..6, a path on each side of row 5
function setup(habitat = 'lava') {
  const grid = new Grid(20, 20);
  const builder = new Builder(grid, new Wallet(100000));
  builder.placeEnclosure(3, 4, 6, 6, habitat);
  builder.placePath(2, 5);
  builder.placePath(7, 5);
  return { grid, builder };
}

describe('extendTrace', () => {
  it('starts with the first tile and adds a neighbour', () => {
    expect(extendTrace([], { tx: 1, ty: 1 })).toEqual([{ tx: 1, ty: 1 }]);
    expect(extendTrace([{ tx: 1, ty: 1 }], { tx: 2, ty: 1 })).toEqual([{ tx: 1, ty: 1 }, { tx: 2, ty: 1 }]);
  });
  it('going back onto the previous tile removes the last one', () => {
    expect(extendTrace(row(1, 3, 1), { tx: 2, ty: 1 })).toEqual(row(1, 2, 1));
  });
  it('ignores a tile that is not a neighbour of the last one', () => {
    expect(extendTrace(row(1, 2, 1), { tx: 5, ty: 1 })).toEqual(row(1, 2, 1));
    expect(extendTrace(row(1, 2, 1), { tx: 3, ty: 2 })).toEqual(row(1, 2, 1));
  });
  it('ignores a tile already in the trace further back', () => {
    const t = [{ tx: 1, ty: 1 }, { tx: 2, ty: 1 }, { tx: 2, ty: 2 }, { tx: 1, ty: 2 }];
    expect(extendTrace(t, { tx: 1, ty: 1 })).toEqual(t);
  });
  it('the same tile again changes nothing', () => {
    expect(extendTrace(row(1, 2, 1), { tx: 2, ty: 1 })).toEqual(row(1, 2, 1));
  });
});

describe('checkBridge', () => {
  it('a straight bridge between two paths', () => {
    const { grid, builder } = setup();
    const r = checkBridge(grid, builder, row(2, 7, 5));
    expect(r.ok).toBe(true);
    expect(r.deck).toEqual(row(3, 6, 5));
    expect(r.paths).toEqual([]);
    expect(r.stairs).toEqual([{ tx: 2, ty: 5, dx: 1, dy: 0 }, { tx: 7, ty: 5, dx: -1, dy: 0 }]);
    expect(r.cost).toBe(4 * BALANCE.bridgeCostPerTile);
    expect(BALANCE.bridgeCostPerTile).toBe(50);
  });
  it('a bridge with a turn', () => {
    const { grid, builder } = setup();
    const trace = [...row(2, 4, 5), { tx: 4, ty: 6 }, { tx: 4, ty: 7 }];
    const r = checkBridge(grid, builder, trace);
    expect(r.ok).toBe(true);
    expect(r.deck).toEqual([{ tx: 3, ty: 5 }, { tx: 4, ty: 5 }, { tx: 4, ty: 6 }]);
    expect(r.stairs[1]).toEqual({ tx: 4, ty: 7, dx: 0, dy: -1 });
    expect(r.paths).toEqual([{ tx: 4, ty: 7 }]); // grass at the end: a path is laid
  });
  it('grass at both ends: paths are laid there and paid', () => {
    const { grid, builder } = setup();
    const r = checkBridge(grid, builder, [3, 4, 5, 6, 7].map((ty) => ({ tx: 4, ty })));
    expect(r.ok).toBe(true);
    expect(r.paths).toEqual([{ tx: 4, ty: 3 }, { tx: 4, ty: 7 }]);
    expect(r.cost).toBe(3 * 50 + 2 * BALANCE.pathCost);
  });
  it('too short', () => {
    const { grid, builder } = setup();
    expect(checkBridge(grid, builder, row(2, 3, 5)).reason).toBe('bridgeTooShort');
  });
  it('an end inside the enclosure', () => {
    const { grid, builder } = setup();
    const r = checkBridge(grid, builder, row(2, 5, 5));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bridgeEnds');
    expect(r.bad).toEqual([{ tx: 5, ty: 5 }]);
  });
  it('no enclosure crossed', () => {
    const { grid, builder } = setup();
    expect(checkBridge(grid, builder, row(8, 11, 5)).reason).toBe('bridgeNoEnclosure');
  });
  it('a tall decoration blocks it, a low one does not', () => {
    const { grid, builder } = setup();
    builder.placeDecor(4, 5, 'lavaRock');
    const r = checkBridge(grid, builder, row(2, 7, 5));
    expect(r.reason).toBe('bridgeBlocked');
    expect(r.bad).toEqual([{ tx: 4, ty: 5 }]);
    const w = setup('water');
    expect(w.builder.placeDecor(4, 5, 'reeds').ok).toBe(true);
    expect(checkBridge(w.grid, w.builder, row(2, 7, 5)).ok).toBe(true);
  });
  it('a shelter under it blocks it', () => {
    const grid = new Grid(20, 20);
    const builder = new Builder(grid, new Wallet(100000));
    builder.placeEnclosure(3, 3, 7, 7, 'lava');
    expect(builder.placeShelter(4, 4).ok).toBe(true);
    const r = checkBridge(grid, builder, row(2, 8, 5));
    expect(r.reason).toBe('bridgeBlocked');
    expect(r.bad).toEqual(row(4, 6, 5));
  });
  it('a building in the way blocks it', () => {
    const { grid, builder } = setup();
    grid.setOccupant(8, 5, 'bld1');
    expect(checkBridge(grid, builder, row(2, 9, 5)).reason).toBe('bridgeBlocked');
  });
  it('over an existing bridge: blocked', () => {
    const { grid, builder } = setup();
    grid.setBridge(4, 5, 'brg1');
    expect(checkBridge(grid, builder, row(2, 7, 5)).reason).toBe('bridgeBlocked');
  });
});

describe('bridgeHeightAt', () => {
  const D = 3.9;
  const bridges = [{ id: 'brg1', deck: row(3, 6, 5), stairs: [{ tx: 2, ty: 5, dx: 1, dy: 0 }, { tx: 7, ty: 5, dx: -1, dy: 0 }] }];
  it('on the deck', () => {
    expect(BALANCE.bridgeDeckHeight).toBe(D);
    expect(bridgeHeightAt(bridges, 4, 5)).toBe(D);
    expect(bridgeHeightAt(bridges, 4.3, 5.2)).toBe(D);
  });
  it('up the stairs', () => {
    expect(bridgeHeightAt(bridges, 1.5, 5)).toBeCloseTo(0);
    expect(bridgeHeightAt(bridges, 2, 5)).toBeCloseTo(D / 2);
    expect(bridgeHeightAt(bridges, 7.25, 5)).toBeCloseTo(D / 4);
  });
  it('elsewhere on the ground', () => {
    expect(bridgeHeightAt(bridges, 10, 10)).toBe(0);
    expect(bridgeHeightAt(bridges, 2, 4)).toBe(0); // next to the stairs, not on them
  });
});
