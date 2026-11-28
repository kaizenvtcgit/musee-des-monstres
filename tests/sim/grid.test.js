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
    expect(g.getTile(2, 2)).toEqual({ ground: 'path', occupant: null, bridge: null });
  });
});

describe('Grid bridges', () => {
  it('bridge tile is walkable and counts as path', () => {
    const g = new Grid(10, 10);
    g.setOccupant(3, 3, 'enc1');
    expect(g.isWalkable(3, 3)).toBe(false);
    const v = g.version;
    g.setBridge(3, 3, 'brg1');
    expect(g.version).toBe(v + 1);
    expect(g.isBridge(3, 3)).toBe(true);
    expect(g.isWalkable(3, 3)).toBe(true);
    expect(g.isPath(3, 3)).toBe(true);
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
