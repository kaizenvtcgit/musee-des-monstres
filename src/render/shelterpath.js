// A monster going into its shelter for real: it walks around the rock if needed, stops in front of
// the cave, walks straight in (back to the camera), rests at the mouth or deep inside, and later walks
// out (facing the camera). Positions in tile units; the mouth faces +y.
//
// The shelters are the Blender models of models/blender/musee-decors.blend (scene MuseeShelters), made for
// 3 x 3 tiles of 1 Blender unit; in the 3D view (src/render3d/park-scene.js) each one is scaled to its
// monster (SHELTER_MODEL_SCALE: the cave keeps the size it had next to that monster), so every distance
// below, measured on the models, is scaled the same way.

// Scale of each shelter model in the 3D view (tiles per model unit), so that its monster, as tall and wide
// as in the 3D view (src/render3d/park-scene.js, 2.5 m per tile), walks into the opening standing, with
// about 10 % to spare above it: the dragon (2.2 m tall), the kraken (swimming, 4.2 m across its tentacles),
// the golem (3.4 m), the yeti (2.9 m), the ghost (2.5 m, floating). The shelters then take 2.3 to 3.1 tiles.
export const SHELTER_MODEL_SCALE = { lava: 0.82, water: 0.88, forest: 0.9, ice: 0.72, dark: 0.82 };
const modelScale = (sh, n) => (SHELTER_MODEL_SCALE[sh?.family] ?? 0.55) * (n / 3);

// Where the rock face (the mouth's outline) stands, from the centre (model units).
export const SHELTER_FACE = 1.25;
// the big caves of the yeti (ice) and of the golem (forest) stand further out
export const SHELTER_FACE_BY_FAMILY = { ice: 1.65, forest: 1.7 };
const faceOf = (sh) => SHELTER_FACE_BY_FAMILY[sh?.family] ?? SHELTER_FACE;

import { turnOffset, unturnOffset } from '../sim/facing.js';

// Room the shelter takes for the monsters walking around (tile units, from its centre).
export const shelterRadius = (sh, n) => (faceOf(sh) - 0.05) * modelScale(sh, n);

// The spots are in the shelter's own frame (its mouth toward +y); `q` is its turn (src/sim/facing.js):
// stepShelterVisit turns the monster into that frame and back.
export function shelterSpots(sh, n) {
  const half = (n - 1) / 2;
  const cx = sh.tx + half, cy = sh.ty + half;
  const q = sh.rot ?? 0;
  const k = modelScale(sh, n);
  const face = faceOf(sh) * k;
  const mouthY = cy + Math.max(0.975, faceOf(sh) - 0.35) * k;
  const r = (faceOf(sh) + 0.25) * k; // half the size of the rock
  return {
    cx, cy, n, q,
    rect: { x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r },
    faceY: cy + face, // the rock face around the mouth
    mouth: { x: cx, y: mouthY }, // resting at the entrance, still in the light
    front: { x: cx, y: Math.max(mouthY + 0.8 * k, cy + face + 0.5) }, // just outside, facing the cave
    deep: { x: cx, y: mouthY - 0.9 * k }, // inside, in the dark
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
  const side = { x: s.cx + Math.sign(p.x - s.cx || 1) * (s.rect.x1 - s.cx + 0.3), y: s.front.y };
  if (!crosses(p, side, s.rect)) return [side, s.front];
  return [{ x: side.x, y: p.y }, side, s.front];
}

// v: { stage, x, y } kept between calls (stage null = not visiting). want: null, 'entrance' or 'inside'.
// Returns { atRest, dark, tunnel } where dark goes from 0 at the mouth to 1 deep inside and tunnel says
// it is on the line through the mouth (in front of it or in it).
export function stepShelterVisit(v, s, want, speed, dt) {
  if (!s.q) return stepLocal(v, s, want, speed, dt);
  // a turned shelter: the same walk, in its own frame
  const toLocal = (p) => { const o = unturnOffset(p.x - s.cx, p.y - s.cy, s.q); return { x: s.cx + o.dx, y: s.cy + o.dy }; };
  const toWorld = (p) => { const o = turnOffset(p.x - s.cx, p.y - s.cy, s.q); return { x: s.cx + o.dx, y: s.cy + o.dy }; };
  const local = { ...v, ...toLocal(v) }; // (its route stays in the shelter's frame)
  const r = stepLocal(local, s, want, speed, dt);
  Object.assign(v, local, toWorld(local));
  return r;
}

function stepLocal(v, s, want, speed, dt) {
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
  return { atRest: v.stage === 'rest', dark, tunnel: !!v.stage && tunnel };
}
