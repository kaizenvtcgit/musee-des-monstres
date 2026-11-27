import { describe, it, expect } from 'vitest';
import { straightLine, pathLineCost } from '../../src/render/pathline.js';

const keys = (cells) => cells.map((c) => `${c.tx},${c.ty}`);

describe('straightLine', () => {
  it('a single click gives the start tile only', () => {
    expect(keys(straightLine({ tx: 5, ty: 5 }, { tx: 5, ty: 5 }))).toEqual(['5,5']);
  });

  it('follows tx when the pointer moved more along tx, even if it drifted along ty', () => {
    expect(keys(straightLine({ tx: 2, ty: 3 }, { tx: 6, ty: 4 }))).toEqual(['2,3', '3,3', '4,3', '5,3', '6,3']);
  });

  it('follows ty when the pointer moved more along ty', () => {
    expect(keys(straightLine({ tx: 2, ty: 3 }, { tx: 1, ty: 0 }))).toEqual(['2,3', '2,2', '2,1', '2,0']);
  });

  it('works backwards too', () => {
    expect(keys(straightLine({ tx: 6, ty: 1 }, { tx: 3, ty: 1 }))).toEqual(['6,1', '5,1', '4,1', '3,1']);
  });

  it('pathLineCost counts only the tiles that are not paths yet', () => {
    const existing = new Set(['3,2', '4,2']);
    const isPath = (tx, ty) => existing.has(`${tx},${ty}`);
    const line = straightLine({ tx: 1, ty: 2 }, { tx: 6, ty: 2 }); // 6 tiles, 2 already paths
    expect(pathLineCost(line, isPath, 10)).toEqual({ tiles: 4, cost: 40 });
  });

  it('never leaves the starting row or column', () => {
    const cells = straightLine({ tx: 10, ty: 10 }, { tx: 18, ty: 15 });
    expect(cells.every((c) => c.ty === 10)).toBe(true);
    expect(cells).toHaveLength(9);
  });
});
