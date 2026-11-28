// The car park, in front of the entrance, outside the park (on the lawn between the park and the road).
// Bought once and placed by the player: more visitors come (BALANCE.parkingVisitorBonus), by car. A car
// drives in along the road, parks, its passengers (1 to 3 visitors) walk to the entrance; when they have all
// left the park and walked back, it backs out and drives away. When it is full, visitors walk in as before.
//
// Layout (tiles, x0 / y0 = top-left corner, y0 = the row just outside the park):
//   column 0: the driveway, from the road up to the aisle;
//   columns 1..6: rows y0, y0 + 1: 6 places (nose toward the park); row y0 + 2: the aisle;
//                 rows y0 + 3, y0 + 4: 6 places (nose toward the road);
//   below it, the road (two lanes, half a tile lower), across the whole map: cars come from the left on the
//   far lane and leave to the left on the near one.
import { BALANCE } from '../config/balance.js';
import { WALK_SPEED } from './visitors.js';

export const PARKING_W = 7;
export const PARKING_H = 5;
export const PLACES = 12;
const CAR_SPEED = 2.4; // tiles / s (6 m/s, slow in a car park)
const RING = 7; // tiles of lawn and forest around the park (the edge of the map)
const OFF = 6; // tiles beyond the edge of the map where cars appear and vanish
// the car models (src/assets/3d/cars.glb.json); the police car is rare
export const CAR_MODELS = ['NormalCar1', 'NormalCar2', 'SUV', 'Taxi', 'SportsCar', 'SportsCar2', 'Cop'];
const MODEL_WEIGHTS = [3, 3, 2, 2, 1, 1, 0.3];

// The row a car park takes (always against the park), the middle of the road and its two lanes (tiles).
export function parkingRow(grid) {
  return grid.h;
}
export function roadRow(grid) {
  return grid.h + PARKING_H + 0.5;
}
export const LANE = 0.42; // tiles from the middle of the road to the middle of a lane
export const ROAD_HALF = 0.95; // half its width (tiles)

// Can a car park start at column x0? (y0 is always parkingRow): inside the map, clear of the entrance path.
export function canPlaceParking(world, x0) {
  if (world.parking) return { ok: false, reason: 'hasParking' };
  const { grid } = world;
  if (x0 < -RING + 1 || x0 + PARKING_W > grid.w + RING - 1) return { ok: false, reason: 'outOfBounds' };
  // the visitors' way from the entrance to the road stays free (the entrance column)
  if (world.entrance.tx >= x0 && world.entrance.tx < x0 + PARKING_W) return { ok: false, reason: 'blocksEntrance' };
  if (world.wallet.money < BALANCE.parkingCost) return { ok: false, reason: 'noMoney' };
  return { ok: true };
}

export function placeParking(world, x0) {
  const r = canPlaceParking(world, Math.round(x0));
  if (!r.ok) return r;
  world.wallet.spend(BALANCE.parkingCost);
  world.parking = { x0: Math.round(x0), y0: parkingRow(world.grid), price: BALANCE.parkingCost, cars: [], nextCarId: 1 };
  return { ok: true };
}

// Pulls it down (half its price back): the cars vanish, their passengers will walk out as before.
export function demolishParking(world) {
  const p = world.parking;
  if (!p) return { ok: false, reason: 'nothing' };
  world.wallet.earn(p.price * BALANCE.demolishRefund);
  for (const v of world.visitors) if (v.carId) { v.carId = null; if (v.state === 'toCar') v.state = 'gone'; }
  world.parking = null;
  return { ok: true };
}

// The tiles it covers (for the placement preview and the clicks).
export function parkingTiles(x0, y0) {
  const out = [];
  for (let y = y0; y < y0 + PARKING_H; y++) for (let x = x0; x < x0 + PARKING_W; x++) out.push({ tx: x, ty: y });
  return out;
}

export function isOnParking(p, tx, ty) {
  return !!p && tx >= p.x0 && tx < p.x0 + PARKING_W && ty >= p.y0 && ty < p.y0 + PARKING_H;
}

// Where place `i` is: its centre and the way the car faces once parked (+1: toward +y, the road).
export function placeOf(p, i) {
  const col = i % 6, top = i < 6;
  return { x: p.x0 + 1 + col, y: top ? p.y0 + 0.5 : p.y0 + 3.5, face: top ? -1 : 1 };
}

// The way of a car: a list of points (tiles); `back` on a point: the car reaches it backing up.
export function arrivalPath(world, p, i) {
  const pl = placeOf(p, i), road = roadRow(world.grid), aisle = p.y0 + 2;
  return [
    { x: -RING - OFF, y: road + LANE }, { x: p.x0, y: road + LANE }, { x: p.x0, y: aisle }, { x: pl.x, y: aisle }, { x: pl.x, y: pl.y },
  ];
}

export function departurePath(world, p, i) {
  const pl = placeOf(p, i), road = roadRow(world.grid), aisle = p.y0 + 2;
  return [
    { x: pl.x, y: pl.y }, { x: pl.x, y: aisle, back: true }, { x: p.x0, y: aisle }, { x: p.x0, y: road - LANE },
    { x: -RING - OFF, y: road - LANE },
  ];
}

export function pathLength(path) {
  let d = 0;
  for (let k = 1; k < path.length; k++) d += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
  return d;
}

// The point at distance `s` along the way, the direction it goes (dx, dy), and whether it backs up.
export function pointAlong(path, s) {
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (s <= len || k === path.length - 1) {
      const t = len ? Math.min(1, s / len) : 1;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / (len || 1), dy: (b.y - a.y) / (len || 1), back: !!b.back };
    }
    s -= len;
  }
  const last = path[path.length - 1];
  return { x: last.x, y: last.y, dx: 0, dy: 1, back: false };
}

// Where the passengers get out and back in: beside the car, in the aisle.
export function doorOf(p, i) {
  const pl = placeOf(p, i);
  return { x: pl.x + 0.35, y: pl.y + (pl.face < 0 ? 0.7 : -0.7) };
}

function pickModel(rng) {
  const total = MODEL_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let k = 0; k < CAR_MODELS.length; k++) {
    r -= MODEL_WEIGHTS[k];
    if (r <= 0) return k;
  }
  return 0;
}

// A free place for a new car, or -1 (the first ones nearest the entrance are taken first).
export function freePlace(world) {
  const p = world.parking;
  if (!p) return -1;
  const taken = new Set(p.cars.map((c) => c.place));
  const order = [...Array(PLACES).keys()].sort((a, b) => Math.abs(placeOf(p, a).x - world.entrance.tx) - Math.abs(placeOf(p, b).x - world.entrance.tx) || a - b);
  return order.find((k) => !taken.has(k)) ?? -1;
}

// A car comes with `n` visitors; returns it (or null if the car park is full).
export function sendCar(world, n) {
  const p = world.parking;
  const place = freePlace(world);
  if (!p || place < 0) return null;
  const car = { id: `car${p.nextCarId++}`, model: pickModel(world.rng), place, state: 'arriving', s: 0, seats: n, passengers: [] };
  p.cars.push(car);
  return car;
}

// Moves the cars; a car that has just parked calls `unload(car, door)` to let its passengers out.
export function updateParking(world, dt, unload) {
  const p = world.parking;
  if (!p) return;
  for (const car of [...p.cars]) {
    if (car.state === 'arriving') {
      const path = arrivalPath(world, p, car.place);
      car.s += CAR_SPEED * dt;
      if (car.s >= pathLength(path)) {
        car.s = 0;
        car.state = 'parked';
        unload(car, doorOf(p, car.place));
      }
    } else if (car.state === 'parked') {
      // everyone it brought has left (back in the car, or gone another way): off it goes
      const alive = car.passengers.some((id) => world.visitors.some((v) => v.id === id && v.state !== 'gone'));
      if (!alive) {
        car.state = 'leaving';
        car.s = 0;
      }
    } else if (car.state === 'leaving') {
      car.s += CAR_SPEED * dt;
      if (car.s >= pathLength(departurePath(world, p, car.place))) p.cars.splice(p.cars.indexOf(car), 1);
    }
  }
}

// Visitors on the lawn, between their car and the entrance: walk straight there. Returns true when arrived.
export function walkStraight(v, goal, dt) {
  const dx = goal.x - v.pos.x, dy = goal.y - v.pos.y, d = Math.hypot(dx, dy), step = WALK_SPEED * dt;
  if (d <= step) {
    v.pos.x = goal.x;
    v.pos.y = goal.y;
    return true;
  }
  v.pos.x += (dx / d) * step;
  v.pos.y += (dy / d) * step;
  return false;
}
