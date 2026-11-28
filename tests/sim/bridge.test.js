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
    expect(r.paths).toEqual([{ tx: 1, ty: 5 }, { tx: 8, ty: 5 }]); // the feet of the stairs
    expect(r.stairs).toEqual([{ tx: 2, ty: 5, dx: 1, dy: 0 }, { tx: 7, ty: 5, dx: -1, dy: 0 }]);
    expect(r.cost).toBe(4 * BALANCE.bridgeCostPerTile + 2 * BALANCE.pathCost);
    expect(BALANCE.bridgeCostPerTile).toBe(50);
  });
  it('a bridge with a turn', () => {
    const { grid, builder } = setup();
    const trace = [...row(2, 4, 5), { tx: 4, ty: 6 }, { tx: 4, ty: 7 }];
    const r = checkBridge(grid, builder, trace);
    expect(r.ok).toBe(true);
    expect(r.deck).toEqual([{ tx: 3, ty: 5 }, { tx: 4, ty: 5 }, { tx: 4, ty: 6 }]);
    expect(r.stairs[1]).toEqual({ tx: 4, ty: 7, dx: 0, dy: -1 });
    expect(r.paths).toEqual([{ tx: 4, ty: 7 }, { tx: 1, ty: 5 }, { tx: 4, ty: 8 }]); // grass at the end and the feet: paths
  });
  it('grass at both ends: paths are laid there and paid', () => {
    const { grid, builder } = setup();
    const r = checkBridge(grid, builder, [3, 4, 5, 6, 7].map((ty) => ({ tx: 4, ty })));
    expect(r.ok).toBe(true);
    expect(r.paths).toEqual([{ tx: 4, ty: 3 }, { tx: 4, ty: 7 }, { tx: 4, ty: 2 }, { tx: 4, ty: 8 }]);
    expect(r.cost).toBe(3 * 50 + 4 * BALANCE.pathCost);
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

describe('traceToward', () => {
  it('fills the tiles skipped by a fast pointer', async () => {
    const { traceToward } = await import('../../src/sim/bridge.js');
    expect(traceToward([{ tx: 1, ty: 1 }], { tx: 4, ty: 1 })).toEqual(row(1, 4, 1));
    const t = traceToward([{ tx: 1, ty: 1 }], { tx: 3, ty: 3 });
    expect(t).toHaveLength(5);
    expect(t.at(-1)).toEqual({ tx: 3, ty: 3 });
  });
  it('going back along the trace takes tiles off', async () => {
    const { traceToward } = await import('../../src/sim/bridge.js');
    expect(traceToward(row(1, 5, 1), { tx: 2, ty: 1 })).toEqual(row(1, 2, 1));
  });
  it('stops where the trace would cross itself', async () => {
    const { traceToward } = await import('../../src/sim/bridge.js');
    const t = [{ tx: 1, ty: 1 }, { tx: 2, ty: 1 }, { tx: 2, ty: 2 }, { tx: 1, ty: 2 }, { tx: 0, ty: 2 }];
    expect(traceToward(t, { tx: 2, ty: 2 })).toEqual(t.slice(0, 3)); // back onto an earlier tile: shortened to it
  });
});

describe('checkBridge: ends and crossings', () => {
  it('the foot of the stairs gets a path when it is grass', () => {
    const { grid, builder } = setup();
    const r = checkBridge(grid, builder, row(2, 7, 5));
    expect(r.feet).toEqual([{ tx: 1, ty: 5 }, { tx: 8, ty: 5 }]);
    expect(r.paths).toEqual([{ tx: 1, ty: 5 }, { tx: 8, ty: 5 }]);
    expect(r.cost).toBe(4 * 50 + 2 * BALANCE.pathCost);
  });
  it('the foot of the stairs must be free or a path', () => {
    const { grid, builder } = setup();
    grid.setOccupant(1, 5, 'bld1');
    const r = checkBridge(grid, builder, row(2, 7, 5));
    expect(r.reason).toBe('bridgeEnds');
    expect(r.bad).toEqual([{ tx: 1, ty: 5 }]);
  });
  it('an existing path between two enclosures cannot go under the deck', () => {
    const { grid, builder } = setup();
    builder.placeEnclosure(9, 4, 11, 6, 'lava');
    builder.placePath(8, 5);
    builder.placePath(13, 5);
    const r = checkBridge(grid, builder, row(2, 12, 5)); // (7,5) and (8,5) are paths, between the two enclosures
    expect(r.reason).toBe('bridgeBlocked');
    expect(r.bad).toEqual([{ tx: 7, ty: 5 }, { tx: 8, ty: 5 }]);
  });
  it('grass between two enclosures is fine (deck over it)', () => {
    const grid = new Grid(20, 20);
    const builder = new Builder(grid, new Wallet(100000));
    builder.placeEnclosure(3, 4, 6, 6, 'lava');
    builder.placeEnclosure(9, 4, 11, 6, 'lava');
    const r = checkBridge(grid, builder, row(2, 12, 5));
    expect(r.ok).toBe(true);
    expect(r.deck).toEqual(row(3, 11, 5));
  });
  it('the stairs of another bridge: blocked', () => {
    const { grid, builder } = setup();
    grid.setStair(2, 5, 'brg1');
    expect(checkBridge(grid, builder, row(2, 7, 5)).reason).toBe('bridgeBlocked');
  });
});

describe('personHeight', () => {
  const D = 3.9;
  // deck on row 5, x 3..6; west stairs on (2,5) going up toward +x; their foot on (1,5)
  const bridges = [{ id: 'brg1', deck: row(3, 6, 5), stairs: [{ tx: 2, ty: 5, dx: 1, dy: 0 }, { tx: 7, ty: 5, dx: -1, dy: 0 }] }];
  const at = (x, y, tile, path) => ({ pos: { x, y }, tile, path });
  it('on the deck', async () => {
    const { personHeight } = await import('../../src/sim/bridge.js');
    expect(personHeight(bridges, at(4, 5, { tx: 4, ty: 5 }, []), 0)).toBe(D);
  });
  it('walking past the stairs along a path stays on the ground', async () => {
    const { personHeight } = await import('../../src/sim/bridge.js');
    expect(personHeight(bridges, at(2, 5, { tx: 2, ty: 4 }, [{ tx: 2, ty: 5 }, { tx: 2, ty: 6 }]), 0)).toBe(0);
  });
  it('coming down from the deck', async () => {
    const { personHeight } = await import('../../src/sim/bridge.js');
    expect(personHeight(bridges, at(2.25, 5, { tx: 3, ty: 5 }, [{ tx: 2, ty: 5 }, { tx: 1, ty: 5 }]), D)).toBeCloseTo(D * 0.75);
    // on down to the foot: still on the steps
    expect(personHeight(bridges, at(1.8, 5, { tx: 2, ty: 5 }, [{ tx: 1, ty: 5 }, { tx: 2, ty: 5 }]), D * 0.5)).toBeCloseTo(D * 0.3);
  });
  it('back from the foot to walk along the path: on the ground', async () => {
    const { personHeight } = await import('../../src/sim/bridge.js');
    expect(personHeight(bridges, at(1.8, 5, { tx: 1, ty: 5 }, [{ tx: 2, ty: 5 }, { tx: 2, ty: 6 }]), 0)).toBe(0);
  });
  it('going up from the foot', async () => {
    const { personHeight } = await import('../../src/sim/bridge.js');
    expect(personHeight(bridges, at(1.8, 5, { tx: 1, ty: 5 }, [{ tx: 2, ty: 5 }, { tx: 3, ty: 5 }]), 0)).toBeCloseTo(D * 0.3);
  });
  it('standing still on the stairs, arrived from below', async () => {
    const { personHeight } = await import('../../src/sim/bridge.js');
    expect(personHeight(bridges, at(2, 5, { tx: 2, ty: 5 }, null), 0)).toBe(0);
  });
});

describe('pierTiles', () => {
  it('every other deck tile, not where a decoration stands', async () => {
    const { pierTiles } = await import('../../src/sim/bridge.js');
    const b = { deck: row(3, 6, 5) };
    expect(pierTiles(b)).toEqual([{ tx: 3, ty: 5 }, { tx: 5, ty: 5 }]);
    expect(pierTiles(b, (tx, ty) => tx === 5 && ty === 5)).toEqual([{ tx: 3, ty: 5 }]);
  });
});
