import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';

describe('Grid', () => {
  it('bounds', () => {
    const g = new Grid(40, 40);
    expect(g.inBounds(-1, 0)).toBe(false);
    expect(g.inBounds(39, 39)).toBe(true);
    expect(g.inBounds(40, 0)).toBe(false);
  });
  it('neighbors4 of a corner has 2 tiles', () => {
    expect(new Grid(40, 40).neighbors4(0, 0)).toHaveLength(2);
  });
  it('isFree false when occupied or path', () => {
    const g = new Grid(10, 10);
    expect(g.isFree(1, 1)).toBe(true);
    g.setOccupant(1, 1, 'x');
    expect(g.isFree(1, 1)).toBe(false);
    g.setGround(2, 2, 'path');
    expect(g.isFree(2, 2)).toBe(false);
    expect(g.getTile(2, 2)).toEqual({ ground: 'path', occupant: null, bridge: null, stair: null });
  });
});

describe('Grid bridges', () => {
  it('bridge tile is walkable but is not a ground path', () => {
    const g = new Grid(10, 10);
    g.setOccupant(3, 3, 'enc1');
    expect(g.isWalkable(3, 3)).toBe(false);
    const v = g.version;
    g.setBridge(3, 3, 'brg1');
    expect(g.version).toBe(v + 1);
    expect(g.isBridge(3, 3)).toBe(true);
    expect(g.isWalkable(3, 3)).toBe(true);
    expect(g.isPath(3, 3)).toBe(false); // not a ground path: stands and buildings do not count it
    expect(g.isFree(3, 3)).toBe(false);
    g.setBridge(3, 3, null);
    expect(g.isBridge(3, 3)).toBe(false);
  });
  it('a plain path is walkable, grass is not', () => {
    const g = new Grid(10, 10);
    g.setGround(1, 1, 'path');
    expect(g.isWalkable(1, 1)).toBe(true);
    expect(g.isWalkable(2, 2)).toBe(false);
  });
});

describe('canStep', () => {
  // deck of brg1 on (3,3) (4,3); its stair on (2,3); a side path on (3,4)
  function deck() {
    const g = new Grid(10, 10);
    for (const x of [3, 4]) { g.setOccupant(x, 3, 'enc1'); g.setBridge(x, 3, 'brg1'); }
    g.setGround(2, 3, 'path');
    g.setStair(2, 3, 'brg1');
    g.setGround(3, 4, 'path');
    g.setGround(1, 1, 'path');
    g.setGround(1, 2, 'path');
    return g;
  }
  it('onto the deck only from its stairs or the deck itself', () => {
    const g = deck();
    expect(g.canStep(2, 3, 3, 3)).toBe(true);
    expect(g.canStep(3, 3, 4, 3)).toBe(true);
    expect(g.canStep(3, 4, 3, 3)).toBe(false); // from a path alongside: through the railing
    expect(g.canStep(3, 3, 3, 4)).toBe(false);
  });
  it('from one bridge to another: no', () => {
    const g = deck();
    g.setOccupant(5, 3, 'enc1');
    g.setBridge(5, 3, 'brg2');
    expect(g.canStep(4, 3, 5, 3)).toBe(false);
  });
  it('anywhere else: yes', () => {
    expect(deck().canStep(1, 1, 1, 2)).toBe(true);
  });
});
