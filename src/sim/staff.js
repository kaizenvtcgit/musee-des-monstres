import { BALANCE } from '../config/balance.js';
import { SPECIES } from '../config/species.js';
import { findPath, findNearest } from './pathfinding.js';
import { scare } from './visitors.js';

const MONSTER_SPEED = 1;
const KEEPER_SPEED = 2.5;
const SCARE_RADIUS = 2;
const CATCH_DIST = 0.8;

let nextKeeperId = 1;

// Saved games: new ids must not reuse the ones already in the loaded game.
export function reserveKeeperIds(n) {
  nextKeeperId = Math.max(nextKeeperId, n + 1);
}

export function hireKeeper(keepers, wallet, spawnTile) {
  if (!wallet.spend(BALANCE.keeperHireCost)) return { ok: false, reason: 'noMoney' };
  const k = {
    id: `kee${nextKeeperId++}`,
    pos: { x: spawnTile.tx, y: spawnTile.ty },
    tile: { ...spawnTile },
    state: 'patrol', // 'patrol' | 'chasing'
    targetMonsterId: null,
    path: null,
    goalKey: null,
  };
  keepers.push(k);
  return { ok: true, id: k.id };
}

export function enclosureCenter(e) {
  return { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 };
}

// Nearest free tile outside the enclosure, searching rings around it.
export function escapeMonster(monster, enclosure, grid) {
  for (let r = 1; r < Math.max(grid.w, grid.h); r++) {
    for (let y = enclosure.y0 - r; y <= enclosure.y1 + r; y++) {
      for (let x = enclosure.x0 - r; x <= enclosure.x1 + r; x++) {
        const onRing = x === enclosure.x0 - r || x === enclosure.x1 + r || y === enclosure.y0 - r || y === enclosure.y1 + r;
        if (!onRing) continue;
        const t = grid.getTile(x, y);
        if (t && t.occupant === null) {
          monster.state = 'escaped';
          monster.pos = { x, y };
          monster.tile = { tx: x, ty: y };
          monster.wanderTarget = null;
          monster.pause = 0;
          monster.shelter = null;
          return true;
        }
      }
    }
  }
  return false;
}

// After each step, an escaped monster sometimes stops for a moment (it shows its threat animation).
const ESCAPED_PAUSE_CHANCE = 0.25;
const ESCAPED_PAUSE_SEC = 2.5;

export function updateEscaped(monster, ctx, dt) {
  if (monster.state !== 'escaped') return;
  if (monster.pause > 0) {
    monster.pause -= dt; // stops for a moment to threaten the visitors
  } else if (!monster.wanderTarget) {
    const options = ctx.grid.neighbors4(monster.tile.tx, monster.tile.ty)
      .filter((n) => ctx.grid.getTile(n.tx, n.ty).occupant === null);
    if (options.length) monster.wanderTarget = options[Math.floor(ctx.rng() * options.length)];
  }
  const speed = MONSTER_SPEED * (SPECIES[monster.speciesId]?.speed ?? 1);
  if (monster.wanderTarget && step(monster, monster.wanderTarget, speed * dt)) {
    monster.tile = { ...monster.wanderTarget };
    monster.wanderTarget = null;
    if (ctx.rng() < ESCAPED_PAUSE_CHANCE) monster.pause = ESCAPED_PAUSE_SEC;
  }
  for (const v of ctx.visitors) {
    if (v.state === 'gone') continue;
    if (Math.hypot(v.pos.x - monster.pos.x, v.pos.y - monster.pos.y) <= SCARE_RADIUS) scare(v);
  }
}

// Moves entity.pos toward tile; returns true when it arrives.
function step(entity, tile, budget) {
  const dx = tile.tx - entity.pos.x, dy = tile.ty - entity.pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= budget) {
    entity.pos.x = tile.tx;
    entity.pos.y = tile.ty;
    return true;
  }
  entity.pos.x += (dx / d) * budget;
  entity.pos.y += (dy / d) * budget;
  return false;
}

export function returnMonster(monster, ctx) {
  const e = monster.enclosureId && ctx.builder.enclosures.get(monster.enclosureId);
  monster.happiness = Math.min(100, monster.happiness + 20);
  monster.wanderTarget = null;
  for (const k of ctx.keepers) {
    if (k.targetMonsterId === monster.id) {
      k.targetMonsterId = null;
      k.state = 'patrol';
      k.path = null;
    }
  }
  if (e && e.monsterIds.includes(monster.id)) {
    monster.state = 'enclosed';
    monster.pos = enclosureCenter(e);
    return;
  }
  monster.state = 'stored';
  monster.enclosureId = null;
  ctx.storeMonster(monster, { force: true });
}

export function catchByClick(monster, ctx) {
  if (monster.state === 'escaped') returnMonster(monster, ctx);
}

export function updateKeeper(k, ctx, dt) {
  if (k.state === 'chasing') {
    const m = ctx.monsters.get(k.targetMonsterId);
    if (!m || m.state !== 'escaped') {
      k.state = 'patrol';
      k.targetMonsterId = null;
      k.path = null;
    }
  }
  if (k.state === 'patrol') {
    const taken = new Set(ctx.keepers.map((o) => o.targetMonsterId).filter(Boolean));
    let best = null, bestD = Infinity;
    for (const m of ctx.monsters.values()) {
      if (m.state !== 'escaped' || taken.has(m.id)) continue;
      const d = Math.hypot(m.pos.x - k.pos.x, m.pos.y - k.pos.y);
      if (d < bestD) { best = m; bestD = d; }
    }
    if (best) {
      k.state = 'chasing';
      k.targetMonsterId = best.id;
      k.path = null;
    }
  }

  if (k.state === 'chasing') {
    const m = ctx.monsters.get(k.targetMonsterId);
    if (Math.hypot(m.pos.x - k.pos.x, m.pos.y - k.pos.y) <= CATCH_DIST) {
      returnMonster(m, ctx);
      return;
    }
    const goal = m.tile;
    const goalKey = `${goal.tx},${goal.ty}`;
    if (!k.path || k.goalKey !== goalKey) {
      k.path = findPath(ctx.grid, k.tile, goal, { allowGrass: true }) || [];
      k.goalKey = goalKey;
    }
    followPath(k, KEEPER_SPEED * dt);
    return;
  }

  // patrol: random walk on path tiles; if standing on grass, walk back to the nearest path
  if ((!k.path || k.path.length === 0) && !ctx.grid.isPath(k.tile.tx, k.tile.ty)) {
    k.path = findNearest(ctx.grid, k.tile, (x, y) => ctx.grid.isPath(x, y)) || [];
  }
  if (!k.path || k.path.length === 0) {
    const options = ctx.grid.neighbors4(k.tile.tx, k.tile.ty).filter((n) => ctx.grid.isPath(n.tx, n.ty));
    k.path = options.length ? [options[Math.floor(ctx.rng() * options.length)]] : [];
  }
  followPath(k, (KEEPER_SPEED / 2) * dt);
}

function followPath(k, budget) {
  while (budget > 0 && k.path.length) {
    const next = k.path[0];
    const before = { ...k.pos };
    if (step(k, next, budget)) {
      budget -= Math.hypot(next.tx - before.x, next.ty - before.y);
      k.tile = { ...next };
      k.path.shift();
    } else budget = 0;
  }
}
