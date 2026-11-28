import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { findPath, findNearest } from '../../src/sim/pathfinding.js';

function line(g, x0, x1, y) {
  for (let x = x0; x <= x1; x++) g.setGround(x, y, 'path');
}

describe('findPath', () => {
  it('straight path with correct length, start excluded, goal included', () => {
    const g = new Grid(10, 10);
    line(g, 0, 5, 0);
    const p = findPath(g, { tx: 0, ty: 0 }, { tx: 5, ty: 0 });
    expect(p).toHaveLength(5);
    expect(p[4]).toEqual({ tx: 5, ty: 0 });
  });

  it('L-shaped path', () => {
    const g = new Grid(10, 10);
    line(g, 0, 3, 0);
    for (let y = 1; y <= 3; y++) g.setGround(3, y, 'path');
    expect(findPath(g, { tx: 0, ty: 0 }, { tx: 3, ty: 3 })).toHaveLength(6);
  });

  it('same tile returns []', () => {
    const g = new Grid(5, 5);
    g.setGround(1, 1, 'path');
    expect(findPath(g, { tx: 1, ty: 1 }, { tx: 1, ty: 1 })).toEqual([]);
  });

  it('null when the path is cut', () => {
    const g = new Grid(10, 10);
    line(g, 0, 5, 0);
    g.setGround(3, 0, 'grass');
    expect(findPath(g, { tx: 0, ty: 0 }, { tx: 5, ty: 0 })).toBeNull();
  });

  it('allowGrass crosses grass but not occupied tiles', () => {
    const g = new Grid(5, 3);
    for (let y = 0; y < 3; y++) if (y !== 2) g.setOccupant(2, y, 'wall');
    const p = findPath(g, { tx: 0, ty: 0 }, { tx: 4, ty: 0 }, { allowGrass: true });
    expect(p).not.toBeNull();
    expect(p.some((s) => s.tx === 2 && s.ty === 2)).toBe(true);
    g.setOccupant(2, 2, 'wall');
    expect(findPath(g, { tx: 0, ty: 0 }, { tx: 4, ty: 0 }, { allowGrass: true })).toBeNull();
  });

  it('allowGrass can always reach the goal even if the goal itself is occupied', () => {
    const g = new Grid(5, 5);
    g.setOccupant(4, 4, 'monster-home');
    expect(findPath(g, { tx: 0, ty: 0 }, { tx: 4, ty: 4 }, { allowGrass: true })).not.toBeNull();
  });
});

describe('bridges', () => {
  function crossing(withBridge) {
    const g = new Grid(10, 10);
    line(g, 0, 1, 0);
    for (let x = 2; x <= 4; x++) {
      g.setOccupant(x, 0, 'enc1');
      if (withBridge) g.setBridge(x, 0, 'brg1');
    }
    line(g, 5, 5, 0);
    g.setStair(1, 0, 'brg1');
    g.setStair(5, 0, 'brg1');
    for (let x = 0; x <= 5; x++) g.setOccupant(x, 1, 'wall'); // no way around
    return g;
  }
  it('findPath crosses a bridge over an enclosure', () => {
    const p = findPath(crossing(true), { tx: 0, ty: 0 }, { tx: 5, ty: 0 });
    expect(p).toHaveLength(5);
    expect(p.slice(1, 4).map((c) => c.tx)).toEqual([2, 3, 4]);
    expect(findPath(crossing(false), { tx: 0, ty: 0 }, { tx: 5, ty: 0 })).toBeNull();
  });
  it('findNearest reaches a bridge tile', () => {
    const g = new Grid(10, 10);
    g.setOccupant(3, 3, 'enc1');
    g.setBridge(3, 3, 'brg1');
    g.setStair(3, 2, 'brg1');
    g.setOccupant(4, 3, 'enc1');
    const p = findNearest(g, { tx: 5, ty: 3 }, (x, y) => g.isWalkable(x, y));
    expect(p.at(-1)).toEqual({ tx: 3, ty: 3 });
  });
});

describe('bridges: getting on and off', () => {
  // an enclosure on x 2..4, y 2..4 with a bridge deck on row 3; stairs on (1,3) and (5,3);
  // a path along the west side x = 1 (y 0..6) and the foot of the west stairs on (0,3)
  function park() {
    const g = new Grid(10, 10);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) g.setOccupant(x, y, 'enc1');
    for (const x of [2, 3, 4]) g.setBridge(x, 3, 'brg1');
    for (let y = 0; y <= 6; y++) g.setGround(1, y, 'path');
    g.setGround(0, 3, 'path');
    g.setGround(5, 3, 'path');
    g.setGround(6, 3, 'path');
    g.setStair(1, 3, 'brg1');
    g.setStair(5, 3, 'brg1');
    // a path along the north side, next to the deck's corner row... and one just above row 3 inside? no: outside
    return g;
  }
  it('walking along the path past the stairs does not go up', () => {
    const p = findPath(park(), { tx: 1, ty: 0 }, { tx: 1, ty: 6 });
    expect(p).toHaveLength(6);
    expect(p.every((c) => c.tx === 1)).toBe(true);
  });
  it('off the deck onto the side path: down the stairs to their foot, then back', () => {
    const p = findPath(park(), { tx: 2, ty: 3 }, { tx: 1, ty: 6 });
    expect(p.slice(0, 3)).toEqual([{ tx: 1, ty: 3 }, { tx: 0, ty: 3 }, { tx: 1, ty: 3 }]);
    expect(p.at(-1)).toEqual({ tx: 1, ty: 6 });
  });
  it('from the side path up onto the deck: by the foot of the stairs', () => {
    const p = findPath(park(), { tx: 1, ty: 0 }, { tx: 3, ty: 3 });
    const i = p.findIndex((c) => c.tx === 1 && c.ty === 3);
    expect(p.slice(i, i + 4)).toEqual([{ tx: 1, ty: 3 }, { tx: 0, ty: 3 }, { tx: 1, ty: 3 }, { tx: 2, ty: 3 }]);
  });
  it('ending on the stairs from the deck: ends at the bottom', () => {
    const p = findPath(park(), { tx: 3, ty: 3 }, { tx: 1, ty: 3 });
    expect(p).toEqual([{ tx: 2, ty: 3 }, { tx: 1, ty: 3 }, { tx: 0, ty: 3 }, { tx: 1, ty: 3 }]);
  });
  it('straight across the bridge needs no detour', () => {
    const p = findPath(park(), { tx: 0, ty: 3 }, { tx: 6, ty: 3 });
    expect(p.map((c) => c.tx)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
