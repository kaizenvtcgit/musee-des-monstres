import { describe, it, expect } from 'vitest';
import { shelterSpots, stepShelterVisit } from '../../src/render/shelterpath.js';

// a 3 x 3 shelter on tiles 4..6 x 4..6: its mouth faces +y (down-left on screen)
const sh = { tx: 4, ty: 4 };
const spots = shelterSpots(sh, 3);
const inFootprint = (p) => p.x > 3.5 && p.x < 6.5 && p.y > 3.5 && p.y < 6.5;

function run(v, want, seconds, onStep) {
  for (let i = 0; i < seconds * 20; i++) {
    const r = stepShelterVisit(v, spots, want, 0.7, 0.05);
    if (onStep) onStep(r);
    if (r.atRest && want) return r;
    if (!want && v.stage === null) return r;
  }
  return null;
}

describe('shelterSpots', () => {
  it('the mouth is on the front side (+y), the deep spot inside the footprint, the front spot outside', () => {
    expect(spots.mouth.x).toBe(5);
    expect(spots.front.y).toBeGreaterThan(spots.mouth.y);
    expect(spots.deep.y).toBeLessThan(spots.mouth.y);
    expect(inFootprint(spots.deep)).toBe(true);
    expect(inFootprint(spots.front)).toBe(false);
  });
});

describe('stepShelterVisit', () => {
  it('to hide: goes in front of the cave, then walks straight into it, back to the viewer, and rests deep inside', () => {
    const v = { stage: null, x: 8, y: 9 };
    const xsInside = [];
    let movedBackward = false;
    let lastY = v.y;
    const r = run(v, 'inside', 30, (s) => {
      if (inFootprint(v)) xsInside.push(v.x);
      if (v.stage === 'enter' && v.y < lastY) movedBackward = true; // going away from the viewer (-y)
      lastY = v.y;
    });
    expect(r).not.toBeNull();
    expect(v.x).toBeCloseTo(spots.deep.x, 5);
    expect(v.y).toBeCloseTo(spots.deep.y, 5);
    expect(xsInside.every((x) => Math.abs(x - spots.mouth.x) < 1e-6)).toBe(true); // only through the tunnel
    expect(movedBackward).toBe(true);
    expect(r.dark).toBeCloseTo(1, 5);
  });

  it('to rest at the entrance: stops in the mouth, still in the light', () => {
    const v = { stage: null, x: 8, y: 9 };
    const r = run(v, 'entrance', 30);
    expect(v.y).toBeCloseTo(spots.mouth.y, 5);
    expect(r.dark).toBeCloseTo(0, 5);
  });

  it('coming from behind, it walks around the rock instead of through it', () => {
    const v = { stage: null, x: 5, y: 1.5 }; // behind the shelter
    run(v, 'inside', 40, () => {
      if (inFootprint(v)) expect(Math.abs(v.x - spots.mouth.x)).toBeLessThan(1e-6);
    });
    expect(v.y).toBeCloseTo(spots.deep.y, 5);
  });

  it('when it is time to come out, it walks out facing the viewer, then is free again', () => {
    const v = { stage: null, x: 8, y: 9 };
    run(v, 'inside', 30);
    let lastY = v.y;
    let alwaysForward = true;
    run(v, null, 30, () => {
      if (v.y < lastY - 1e-9) alwaysForward = false;
      lastY = v.y;
    });
    expect(v.stage).toBeNull();
    expect(alwaysForward).toBe(true);
    expect(v.y).toBeCloseTo(spots.front.y, 5);
  });

  it('called off on the way: it simply stops where it is', () => {
    const v = { stage: null, x: 9, y: 9 };
    stepShelterVisit(v, spots, 'inside', 0.7, 0.5);
    expect(v.stage).not.toBeNull();
    stepShelterVisit(v, spots, null, 0.7, 0.05);
    expect(v.stage).toBeNull();
  });
});
