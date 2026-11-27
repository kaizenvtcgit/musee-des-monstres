// Visual stroll of monsters inside their enclosure: walk to a free spot, rest, repeat,
// without ever walking through another monster. Positions are in tile units.
// Each monster is a circle of radius r; two monsters keep their centres at least r1 + r2 apart.

export const WANDER_SPEED = 0.7; // tiles per second, matches the walk animation
const PAUSE = [2, 5]; // seconds of rest after reaching a spot
const BLOCKED_WAIT = [0.4, 1.0]; // seconds of hesitation when someone is in the way

// opts.speed (tiles / s) and opts.pause ([min, max] seconds of rest) for slower or calmer monsters.
export function createWanderer(pos, r, opts = {}) {
  return { x: pos.x, y: pos.y, r, goal: null, rest: 0, moving: false, speed: opts.speed ?? WANDER_SPEED, pause: opts.pause ?? PAUSE };
}

// How much room is left around p (negative = overlapping someone).
function clearance(p, r, others) {
  let c = Infinity;
  for (const o of others) c = Math.min(c, Math.hypot(p.x - o.x, p.y - o.y) - (r + o.r));
  return c;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A random point in bounds where a monster of radius r touches no one (best effort if crowded).
export function findFreeSpot(bounds, others, r, rng) {
  let best = null, bestC = -Infinity;
  for (let i = 0; i < 40; i++) {
    const p = {
      x: bounds.minX + rng() * (bounds.maxX - bounds.minX),
      y: bounds.minY + rng() * (bounds.maxY - bounds.minY),
    };
    const c = clearance(p, r, others);
    if (c >= 0) return p;
    if (c > bestC) { best = p; bestC = c; }
  }
  return best;
}

const restTime = (w, rng) => { const p = w.pause ?? PAUSE; return p[0] + rng() * (p[1] - p[0]); };

export function stepWander(w, others, bounds, dt, rng) {
  w.moving = false;
  const step = (w.speed ?? WANDER_SPEED) * dt;

  // started on top of someone (just placed, or the enclosure shrank): back away first
  if (clearance(w, w.r, others) < 0) {
    let near = null, nd = Infinity;
    for (const o of others) {
      const d = Math.hypot(w.x - o.x, w.y - o.y);
      if (d < nd) { nd = d; near = o; }
    }
    let ux = w.x - near.x, uy = w.y - near.y;
    const len = Math.hypot(ux, uy) || 1;
    if (Math.hypot(ux, uy) === 0) { ux = rng() - 0.5; uy = rng() - 0.5; }
    w.x = clamp(w.x + (ux / len) * step, bounds.minX, bounds.maxX);
    w.y = clamp(w.y + (uy / len) * step, bounds.minY, bounds.maxY);
    w.goal = null;
    w.moving = true;
    return;
  }

  if (w.rest > 0) {
    w.rest -= dt;
    if (w.rest <= 0) w.goal = findFreeSpot(bounds, others, w.r, rng);
    return;
  }
  if (!w.goal) {
    w.rest = restTime(w, rng);
    return;
  }

  const dx = w.goal.x - w.x, dy = w.goal.y - w.y;
  const d = Math.hypot(dx, dy);
  const move = Math.min(step, d);
  const next = d === 0 ? { x: w.x, y: w.y } : { x: w.x + (dx / d) * move, y: w.y + (dy / d) * move };
  if (clearance(next, w.r, others) < 0) {
    // someone is in the way: stop, hesitate, then choose another spot
    w.goal = null;
    w.rest = BLOCKED_WAIT[0] + rng() * (BLOCKED_WAIT[1] - BLOCKED_WAIT[0]);
    return;
  }
  w.x = next.x;
  w.y = next.y;
  w.moving = move > 0;
  if (d <= step) {
    w.goal = null;
    w.rest = restTime(w, rng);
  }
}
