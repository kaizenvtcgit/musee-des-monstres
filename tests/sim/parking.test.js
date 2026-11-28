import { describe, it, expect } from 'vitest';
import { createInitialWorld } from '../../src/sim/world.js';
import { serializeWorld, deserializeWorld } from '../../src/sim/save.js';
import { BALANCE } from '../../src/config/balance.js';
import {
  PARKING_W, PARKING_H, PLACES, placeOf, arrivalPath, departurePath, pointAlong, pathLength, isOnParking, sendCar,
} from '../../src/sim/parking.js';

const run = (w, sec, step = 0.25) => { for (let t = 0; t < sec; t += step) w.tick(step); };

describe('car park: placing', () => {
  it('costs its price, sits against the park on the lawn, only one', () => {
    const w = createInitialWorld(1);
    const money = w.wallet.money;
    expect(w.placeParking(5).ok).toBe(true);
    expect(w.wallet.money).toBe(money - BALANCE.parkingCost);
    expect(w.parking).toMatchObject({ x0: 5, y0: w.grid.h });
    // outside the park, touching it
    expect(w.grid.inBounds(5, w.parking.y0)).toBe(false);
    expect(isOnParking(w.parking, 5 + PARKING_W - 1, w.grid.h + PARKING_H - 1)).toBe(true);
    expect(w.placeParking(25)).toMatchObject({ ok: false, reason: 'hasParking' });
  });

  it('keeps the entrance free, stays on the map, needs the money', () => {
    const w = createInitialWorld(1);
    expect(w.placeParking(w.entrance.tx - 2)).toMatchObject({ ok: false, reason: 'blocksEntrance' });
    expect(w.placeParking(-20)).toMatchObject({ ok: false, reason: 'outOfBounds' });
    expect(w.placeParking(w.grid.w)).toMatchObject({ ok: false, reason: 'outOfBounds' });
    w.wallet.money = 10;
    expect(w.placeParking(5)).toMatchObject({ ok: false, reason: 'noMoney' });
  });

  it('pulled down: half the price back, the cars gone', () => {
    const w = createInitialWorld(1);
    w.placeParking(5);
    sendCar(w, 2);
    const money = w.wallet.money;
    expect(w.demolishParking().ok).toBe(true);
    expect(w.parking).toBe(null);
    expect(w.wallet.money).toBe(money + BALANCE.parkingCost * BALANCE.demolishRefund);
  });
});

describe('car park: the way of a car', () => {
  it('drives in along the road, up the driveway and the aisle, into its place', () => {
    const w = createInitialWorld(1);
    w.placeParking(5);
    const p = w.parking;
    for (let i = 0; i < PLACES; i++) {
      const path = arrivalPath(w, p, i), end = pointAlong(path, pathLength(path));
      const pl = placeOf(p, i);
      expect(end.x).toBeCloseTo(pl.x);
      expect(end.y).toBeCloseTo(pl.y);
      expect(isOnParking(p, Math.round(pl.x), Math.floor(pl.y))).toBe(true);
    }
    // it backs out of its place, then drives off along the road, out of the map
    const out = departurePath(w, p, 0);
    expect(pointAlong(out, 0.2).back).toBe(true);
    expect(pointAlong(out, pathLength(out)).x).toBeLessThan(-7);
  });
});

describe('car park: visitors by car', () => {
  it('a car comes, its visitors walk in, visit, walk back, and it drives away', () => {
    const w = createInitialWorld(3);
    w.placeParking(5);
    const car = sendCar(w, 2);
    expect(car.state).toBe('arriving');
    const before = w.totalVisitors;
    run(w, 30);
    expect(car.state).not.toBe('arriving');
    expect(w.totalVisitors).toBeGreaterThanOrEqual(before + 2);
    const mine = () => w.visitors.filter((v) => v.carId === car.id);
    // they got out beside the car, then walked to the entrance and into the park
    const seen = new Set();
    for (let t = 0; t < 600 && w.parking.cars.includes(car); t += 1) {
      run(w, 1);
      for (const v of mine()) seen.add(v.state);
    }
    expect(seen.has('walking')).toBe(true);
    expect(seen.has('toCar') || seen.has('leaving')).toBe(true);
    // all gone: the car has left
    expect(w.parking.cars.includes(car)).toBe(false);
    expect(mine().length).toBe(0);
  });

  it('more visitors come with a car park', () => {
    const count = (withParking) => {
      const w = createInitialWorld(7);
      if (withParking) w.placeParking(5);
      w.wallet.money = 1e6;
      run(w, 900, 0.5);
      return w.totalVisitors;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 1.1);
  });

  it('when it is full, visitors walk in from the entrance as before', () => {
    const w = createInitialWorld(1);
    w.placeParking(5);
    for (let i = 0; i < PLACES; i++) expect(sendCar(w, 1)).not.toBe(null);
    expect(sendCar(w, 1)).toBe(null);
  });

  it('is saved and loaded with its cars and their visitors', () => {
    const w = createInitialWorld(5);
    w.placeParking(5);
    sendCar(w, 3);
    run(w, 40);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.parking.x0).toBe(5);
    expect(back.parking.cars.length).toBe(w.parking.cars.length);
    expect(back.visitors.filter((v) => v.carId).length).toBe(w.visitors.filter((v) => v.carId).length);
    run(back, 5); // and the game goes on
  });
});
