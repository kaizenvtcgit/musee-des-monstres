import { BALANCE } from '../config/balance.js';
import { findPath } from './pathfinding.js';
import { appeal, decorCount } from './monsters.js';
import { HABITAT_APPEAL } from '../config/species.js';
import { walkStraight, doorOf } from './parking.js';

// tiles / s (2.5 m per tile in the 3D view): a brisk walk, 1.5 m/s, and a run, 3.4 m/s, matching the stride of
// their walk and run animations (ANIM_FPS.person, src/render/sprites.js), so their feet do not slide
export const WALK_SPEED = 0.6;
export const RUN_SPEED = 1.35;
const FLEE_SPEED = RUN_SPEED;
const WATCH_SEC = 5;
const SHOP_SEC = 2;
const MAX_TARGETS = 3;
// (the walks between two enclosures take that long: they used to walk 2.5 times faster)
const MAX_AGE_SEC = 300;
const HUNGRY_AFTER_SEC = 150;
const STUCK_GIVE_UP_SEC = 20;

let nextVisitorId = 1;

// Saved games: new ids must not reuse the ones already in the loaded game.
export function reserveVisitorIds(n) {
  nextVisitorId = Math.max(nextVisitorId, n + 1);
}

export function spawnIntervalSec(reputation, ticketPrice) {
  return (BALANCE.visitorBaseIntervalSec / (0.5 + reputation / 2)) * (ticketPrice / BALANCE.ticketPriceRef);
}

export function createVisitor(entrance, variant = 0) {
  return {
    id: `vis${nextVisitorId++}`,
    variant,
    pos: { x: entrance.tx, y: entrance.ty },
    tile: { tx: entrance.tx, ty: entrance.ty },
    state: 'walking', // 'walking' | 'watching' | 'shopping' | 'fleeing' | 'leaving' | 'gone'
    //                   (came by car: 'arriving' from the car park to the entrance, 'toCar' back to it)
    mood: 'happy', // 'happy' | 'bored' | 'hungry' | 'scared'
    satisfaction: 0.4,
    path: null,
    target: null, // { kind: 'enclosure'|'snack'|'souvenir'|'exit', id?, tile }
    grass: false, // true when walking over grass because no path exists
    timer: 0,
    age: 0,
    visited: 0,
    ate: false,
    boughtSouvenir: false,
    stuck: 0,
  };
}

// The car a visitor came in, if it is still in the car park.
function carOf(v, ctx) {
  return (v.carId && ctx.parking?.cars.find((c) => c.id === v.carId)) || null;
}

export function scare(visitor) {
  if (visitor.state === 'gone' || visitor.state === 'fleeing') return;
  visitor.state = 'fleeing';
  visitor.mood = 'scared';
  visitor.satisfaction = Math.max(0, visitor.satisfaction - 0.5);
  visitor.target = null;
  visitor.path = null;
}

export function updateVisitor(v, ctx, dt) {
  if (v.state === 'gone') return;
  // between the car park and the entrance, on the lawn outside the park
  if (v.state === 'arriving') {
    if (walkStraight(v, { x: ctx.entrance.tx, y: ctx.entrance.ty }, dt)) {
      v.state = 'walking';
      v.tile = { tx: ctx.entrance.tx, ty: ctx.entrance.ty };
    }
    return;
  }
  if (v.state === 'toCar') {
    const car = carOf(v, ctx);
    if (!car || walkStraight(v, doorOf(ctx.parking, car.place), dt)) v.state = 'gone';
    return;
  }
  v.age += dt;
  decorationBonus(v, ctx, dt);

  if (v.state === 'watching' || v.state === 'shopping') {
    v.timer -= dt;
    if (v.timer <= 0) {
      v.state = 'walking';
      v.target = null;
    }
    updateMood(v);
    return;
  }

  if (!v.target) chooseTarget(v, ctx);
  if (!v.path) planPath(v, ctx);
  if (v.path) move(v, ctx, dt);
  else {
    v.stuck += dt;
    if (v.stuck > STUCK_GIVE_UP_SEC) v.state = 'gone';
  }
  updateMood(v);
}

function updateMood(v) {
  if (v.state === 'fleeing') v.mood = 'scared';
  else if (v.age > HUNGRY_AFTER_SEC && !v.ate) v.mood = 'hungry';
  else if (v.satisfaction < 0.3) v.mood = 'bored';
  else v.mood = 'happy';
}

function decorationBonus(v, ctx, dt) {
  const r = BALANCE.decorationRadius;
  for (const b of ctx.builder.buildings.values()) {
    if (b.type !== 'decoration') continue;
    if (Math.abs(b.x0 - v.pos.x) <= r && Math.abs(b.y0 - v.pos.y) <= r) {
      v.satisfaction = Math.min(1, v.satisfaction + 0.02 * dt);
      return;
    }
  }
}

function shopsOfType(ctx, type) {
  return [...ctx.builder.buildings.values()].filter((b) => b.type === type && ctx.builder.touchesPath(b.id));
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function targetFor(ctx, kind, id) {
  const tiles = ctx.builder.accessTiles(id);
  return tiles.length ? { kind, id, tile: pick(tiles, ctx.rng) } : null;
}

function exitTarget(ctx) {
  return { kind: 'exit', tile: { ...ctx.entrance } };
}

// Sum of the appeal of the monsters on show in the enclosure (more with decorations), or null if none is there.
function enclosureAppeal(e, ctx) {
  let total = null;
  for (const id of e.monsterIds) {
    const m = ctx.monsters.get(id);
    // hidden in its shelter it is not seen; resting at the entrance, a little less
    if (m && m.state === 'enclosed') {
      const seen = m.shelter === 'inside' ? 0 : m.shelter === 'entrance' ? BALANCE.shelterEntranceAppeal : 1;
      total = (total || 0) + appeal(m) * seen;
    }
  }
  return total === null ? null : total * (1 + decorCount(e) * BALANCE.decorAppeal) * (HABITAT_APPEAL[e.habitat] ?? 1);
}

function chooseTarget(v, ctx) {
  const { rng } = ctx;
  if (v.state === 'fleeing') {
    v.target = exitTarget(ctx);
    return;
  }
  const done = v.visited >= MAX_TARGETS || v.age > MAX_AGE_SEC;
  if (!done && v.age > HUNGRY_AFTER_SEC && !v.ate) {
    const snack = pick(shopsOfType(ctx, 'snack'), rng);
    if (snack) {
      v.target = targetFor(ctx, 'snack', snack.id);
      if (v.target) return;
    }
  }
  if (!done) {
    const options = [];
    for (const e of ctx.builder.enclosures.values()) {
      const total = enclosureAppeal(e, ctx);
      if (total === null || !ctx.builder.touchesPath(e.id)) continue;
      options.push({ e, w: total + 0.5 });
    }
    if (options.length) {
      let r = rng() * options.reduce((s, o) => s + o.w, 0);
      let chosen = options[options.length - 1].e;
      for (const o of options) {
        r -= o.w;
        if (r <= 0) { chosen = o.e; break; }
      }
      v.target = targetFor(ctx, 'enclosure', chosen.id);
      if (v.target) return;
    }
  }
  if (!v.boughtSouvenir && rng() < v.satisfaction) {
    const shop = pick(shopsOfType(ctx, 'souvenir'), rng);
    if (shop) {
      v.target = targetFor(ctx, 'souvenir', shop.id);
      if (v.target) return;
    }
  }
  v.state = 'leaving';
  v.target = exitTarget(ctx);
}

function planPath(v, ctx) {
  // the tile we were heading to may have been demolished or built over: pick again
  if (v.target.kind !== 'exit' && !ctx.grid.isPath(v.target.tile.tx, v.target.tile.ty)) {
    v.target = null;
    chooseTarget(v, ctx);
  }
  const from = v.tile;
  const to = v.target.tile;
  const grassAllowed = v.state === 'fleeing';
  let path = findPath(ctx.grid, from, to, { allowGrass: grassAllowed });
  v.grass = grassAllowed;
  if (!path && v.target.kind !== 'exit') {
    // target unreachable: give up on it and head out
    v.state = 'leaving';
    v.target = exitTarget(ctx);
    path = findPath(ctx.grid, from, v.target.tile);
  }
  if (!path) {
    path = findPath(ctx.grid, from, v.target.tile, { allowGrass: true });
    v.grass = true;
  }
  v.path = path;
  if (path) v.stuck = 0;
}

function canEnter(v, ctx, tile) {
  const t = ctx.grid.getTile(tile.tx, tile.ty);
  if (!t) return false;
  if (tile.tx === v.target.tile.tx && tile.ty === v.target.tile.ty && v.target.kind === 'exit') return t.occupant === null;
  if (t.occupant !== null) return false;
  return v.grass || t.ground === 'path';
}

// Walking past a cash machine (on a tile next to it), a visitor takes cash, once: it then spends more.
export function takeCash(v, ctx) {
  if (v.cash) return;
  const { grid, builder } = ctx;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = grid.inBounds(v.tile.tx + dx, v.tile.ty + dy) && grid.getTile(v.tile.tx + dx, v.tile.ty + dy);
    if (t && t.occupant && builder.buildings.get(t.occupant)?.type === 'atm') {
      v.cash = true;
      return;
    }
  }
}

function move(v, ctx, dt) {
  let budget = (v.state === 'fleeing' ? FLEE_SPEED : WALK_SPEED) * dt;
  while (budget > 0) {
    if (v.path.length === 0) {
      arrive(v, ctx);
      return;
    }
    const next = v.path[0];
    const atTile = v.pos.x === v.tile.tx && v.pos.y === v.tile.ty;
    if (atTile && !canEnter(v, ctx, next)) {
      v.path = null; // re-plan next update
      return;
    }
    const dx = next.tx - v.pos.x, dy = next.ty - v.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      v.pos.x = next.tx;
      v.pos.y = next.ty;
      v.tile = { tx: next.tx, ty: next.ty };
      takeCash(v, ctx);
      v.path.shift();
      budget -= dist;
    } else {
      v.pos.x += (dx / dist) * budget;
      v.pos.y += (dy / dist) * budget;
      budget = 0;
    }
  }
}

function arrive(v, ctx) {
  const target = v.target;
  v.path = null;
  if (target.kind === 'exit') {
    // came by car: back to it (it leaves once all its passengers are in)
    v.state = carOf(v, ctx) ? 'toCar' : 'gone';
    return;
  }
  if (target.kind === 'enclosure') {
    const e = ctx.builder.enclosures.get(target.id);
    const total = e ? enclosureAppeal(e, ctx) : null;
    if (total !== null) {
      v.satisfaction = Math.min(1, v.satisfaction + total / 50);
      v.state = 'watching';
      v.timer = WATCH_SEC * (1 + decorCount(e) * BALANCE.decorWatch);
    } else {
      v.target = null;
    }
    v.visited++;
    return;
  }
  if (target.kind === 'snack' && ctx.builder.buildings.has(target.id)) {
    ctx.wallet.earn(BALANCE.snackPrice * (v.cash ? BALANCE.atmSpendBonus : 1));
    v.ate = true;
    v.state = 'shopping';
    v.timer = SHOP_SEC;
    return;
  }
  if (target.kind === 'souvenir' && ctx.builder.buildings.has(target.id)) {
    ctx.wallet.earn(BALANCE.souvenirPrice * (v.cash ? BALANCE.atmSpendBonus : 1));
    v.boughtSouvenir = true;
    v.state = 'shopping';
    v.timer = SHOP_SEC;
    return;
  }
  v.target = null;
}
