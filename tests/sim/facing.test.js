import { describe, it, expect } from 'vitest';
import { turnOffset, unturnOffset, quarterAngle, faceToPath } from '../../src/sim/facing.js';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder } from '../../src/sim/build.js';
import { shelterSpots, stepShelterVisit } from '../../src/render/shelterpath.js';

describe('facing', () => {
  it('a quarter turn brings the front from +y to -x, -y, +x, and back', () => {
    expect(turnOffset(0, 1, 1)).toEqual({ dx: -1, dy: 0 });
    expect(turnOffset(0, 1, 2)).toEqual({ dx: 0, dy: -1 });
    expect(turnOffset(0, 1, 3)).toEqual({ dx: 1, dy: 0 });
    expect(unturnOffset(-1, 0, 1)).toEqual({ dx: 0, dy: 1 });
    // the 3D view: +z is +y, its turn sends +z the same way
    for (let q = 0; q < 4; q++) {
      const a = quarterAngle(q), o = turnOffset(0, 1, q);
      expect(Math.sin(a)).toBeCloseTo(o.dx, 9);
      expect(Math.cos(a)).toBeCloseTo(o.dy, 9);
    }
  });

  it('a stand faces the path next to it', () => {
    const grid = new Grid(10, 10);
    grid.getTile(4, 5).ground = 'path'; // left of (5, 5)
    expect(faceToPath(grid, 5, 5, 5, 5)).toBe(1);
    expect(turnOffset(0, 1, faceToPath(grid, 5, 5, 5, 5))).toEqual({ dx: -1, dy: 0 });
  });

  it('what is placed keeps the turn chosen', () => {
    const b = new Builder(new Grid(40, 40), new Wallet(1e6));
    const s = b.placeBuilding('snack', 3, 3, { rot: 2 });
    expect(b.buildings.get(s.id).rot).toBe(2);
    const e = b.placeEnclosure(10, 10, 15, 15, 'lava');
    const d = b.placeDecor(11, 11, 'lavaRock', 3);
    expect(b.enclosures.get(e.id).decor.find((x) => x.id === d.id).rot).toBe(3);
    b.placeShelter(12, 12, 1);
    expect(b.enclosures.get(e.id).shelter.rot).toBe(1);
  });

  it('a monster goes into a turned shelter through its mouth (here toward -x), and rests inside', () => {
    const sh = { tx: 10, ty: 10, family: 'lava', rot: 1 };
    const s = shelterSpots(sh, 3);
    const v = { stage: null, x: 5, y: 11 }; // on the side of the mouth
    let r;
    for (let i = 0; i < 2000; i++) {
      r = stepShelterVisit(v, s, 'inside', 0.7, 0.05);
      if (r.atRest) break;
    }
    expect(r.atRest).toBe(true);
    // resting inside: on the axis of the mouth (y = centre), between the centre and the mouth (x < centre)
    expect(v.y).toBeCloseTo(s.cy, 5);
    expect(v.x).toBeLessThan(s.cx + 0.2);
    expect(v.x).toBeGreaterThan(s.cx - 1.5);
  });
});
