// A monster going into its shelter for real: it walks around the rock if needed, stops in front of
// the cave, walks straight in (back to the viewer), rests at the mouth or deep inside, and later walks
// out (facing the viewer). Positions in tile units; the mouth faces +y (down-left on screen).

// Where the monster rests "at the entrance", from the shelter's first tile (for a 2 x 2 one; scaled).
export const SHELTER_ENTRANCE = 1.15;

export function shelterSpots(sh, n) {
  const half = (n - 1) / 2;
  const cx = sh.tx + half, cy = sh.ty + half;
  const mouthY = cy + (SHELTER_ENTRANCE - 0.5) * (n / 2);
  return {
    cx, cy, n,
    rect: { x0: sh.tx - 0.5, x1: sh.tx + n - 0.5, y0: sh.ty - 0.5, y1: sh.ty + n - 0.5 },
    mouth: { x: cx, y: mouthY }, // resting at the entrance, still in the light
    front: { x: cx, y: mouthY + 0.8 }, // just outside, facing the cave
    deep: { x: cx, y: mouthY - 0.3 * n }, // inside, in the dark, still seen through the opening (its eyes)
  };
}

const inRect = (p, r) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
function crosses(a, b, r) {
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    if (inRect({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return true;
  }
  return false;
}

// Waypoints from p to the front of the cave that never cut through the rock.
function routeToFront(p, s) {
  if (!crosses(p, s.front, s.rect)) return [s.front];
  const side = { x: s.cx + Math.sign(p.x - s.cx || 1) * (s.n / 2 + 0.8), y: s.front.y };
  if (!crosses(p, side, s.rect)) return [side, s.front];
  return [{ x: side.x, y: p.y }, side, s.front];
}

// v: { stage, x, y } kept between calls (stage null = not visiting). want: null, 'entrance' or 'inside'.
// Returns { atRest, dark } where dark goes from 0 at the mouth to 1 deep inside.
export function stepShelterVisit(v, s, want, speed, dt) {
  let budget = speed * dt;
  const moveTo = (t) => {
    const dx = t.x - v.x, dy = t.y - v.y, d = Math.hypot(dx, dy);
    if (d <= budget) { v.x = t.x; v.y = t.y; budget -= d; return true; }
    v.x += (dx / d) * budget; v.y += (dy / d) * budget; budget = 0; return false;
  };
  const inTunnel = Math.abs(v.x - s.cx) < 1e-6 && v.y <= s.front.y + 1e-6 && v.y >= s.deep.y - 1e-6;

  if (want) {
    if (!v.stage || v.stage === 'exit') {
      if (v.stage === 'exit' && inTunnel) v.stage = 'enter';
      else { v.stage = 'approach'; v.route = routeToFront(v, s); }
    }
    while (budget > 0) {
      if (v.stage === 'approach') {
        if (moveTo(v.route[0])) {
          v.route.shift();
          if (!v.route.length) v.stage = 'enter';
        }
      } else if (v.stage === 'enter' || v.stage === 'rest') {
        const target = want === 'inside' ? s.deep : s.mouth;
        v.stage = moveTo(target) ? 'rest' : 'enter';
        if (v.stage === 'rest') break;
      } else break;
    }
  } else if (v.stage === 'approach') {
    v.stage = null; // called off on the way: just stops there
  } else if (v.stage) {
    v.stage = 'exit';
    if (moveTo(s.front)) v.stage = null;
  }

  const tunnel = Math.abs(v.x - s.cx) < 1e-6;
  const dark = tunnel ? Math.max(0, Math.min(1, (s.mouth.y - v.y) / (s.mouth.y - s.deep.y))) : 0;
  return { atRest: v.stage === 'rest', dark };
}
