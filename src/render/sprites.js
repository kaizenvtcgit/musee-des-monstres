// The animations of the monsters and people, as the game logic sees them (the 3D view plays the clip of
// the same name, at the same point: src/render3d/park-scene.js). They come from the sprite sheets rendered
// from the 3D models in the 2D days: what is left of them is their number of frames
// (src/config/anim-frames.json) and the moments of their effects (src/config/anim-events/*.json); Phaser
// still plays them, on empty textures, in the hidden scene (src/render/GameScene.js).
//
// Names: "<speciesId>-<kind>-d<0..7>" (one direction; people only have d0, d2, d4, d6) or
// "<speciesId>-<kind>-dirs" (the 8 directions, `frames` each). Kinds:
// - walk, idle: required, looping;
// - fly: optional, looping, replaces walk while the monster is escaped;
// - threat: optional, looping, replaces idle while the monster is escaped;
// - any other kind (flap, stretch, look, tail...): optional one-shot "idle action" played now and then at rest.
import ANIM_FRAMES from '../config/anim-frames.json';

// Icons of the menus (Blender renders): habitat grounds "tile-<habitat>.png", buildings "bld-<type>.png",
// the enclosure decorations "decor-atlas.webp" and the shelters "shelter-<family>.png"
// (scripts/render-model/render-decor.mjs).
const icons = import.meta.glob(['../assets/tiles/*.{png,webp}', '../assets/buildings/*.{png,webp}', '../assets/decor/*.{png,webp}'], { eager: true, query: '?url', import: 'default' });
export const ICON_URLS = Object.fromEntries(
  Object.entries(icons).map(([path, url]) => [path.split('/').pop().replace(/\.(png|webp)$/, ''), url]),
);

const LOOPING = new Set(['walk', 'idle', 'fly', 'run', 'wave', 'threat']);
// Playback speed of each animation (frames per second of the sampled sheet), per species.
const ANIM_FPS = {
  default: { walk: 8, idle: 3 },
  // dragonnet: one loop = one clip of its 3D model
  dragonnet: { walk: 10, idle: 6, fly: 10, flap: 5, stretch: 6, look: 6, tail: 6 },
  kraken: { walk: 10, idle: 4, threat: 6, look: 5, wiggle: 6, sleep: 4 },
  spectre: { walk: 6, idle: 3, threat: 4, look: 3, haunt: 4, sleep: 2 },
  yeti: {
    walk: 10, run: 10 / 0.95, idle: 3, look: 3, scratch: 14 / 3.6, chestbeat: 5, stretch: 12 / 3.5, happy: 5, threat: 5,
    sleep: 8 / 5, wakeup: 4, sitdown: 4, shake: 16 / 2.8,
  },
  golem: {
    walk: 8, idle: 3, look: 3, stretch: 12 / 3.5, chestbeat: 5, slam: 6, threat: 4, sleep: 8 / 5, wakeup: 4, sitdown: 4, shake: 5,
  },
  // every "person-..." animation (Quaternius characters)
  person: { walk: 7.2, run: 8, idle: 2.88, wave: 5.76 },
};

const isPerson = (name) => name.startsWith('person-');

// Per-species behaviour of the animated sprite (only for the species listed; the others keep the defaults):
// - idleAlso: looping kinds also played now and then as idle actions (one loop);
// - actionLoops: idle actions played several times in a row;
// - actionGap: [min, max] game seconds of plain idling between two idle actions;
// - idleKinds: only these kinds are random idle actions (the others are played on purpose);
// - walkSpeed: tiles / s matching the stride of its walk animation (no sliding feet); restRange: [min, max]
//   seconds it stays put between two strolls in its enclosure;
// - statue: [min, max] seconds it may stand perfectly still (an idle action);
// - sleep: { chance, loops: [min, max] }: an idle action may be a nap: sit down, sleep, wake up;
// - angry: { below, kinds }: under this happiness, these actions join the idle ones;
// - escapedKinds: what it does when it stops while escaped (one of them, picked at each stop);
// - runSpeed, runChance: now and then a stroll is a run (tiles / s matching its run animation);
// - escapedMove: the animation it moves with when escaped ('run');
// - visitorKinds: when visitors watch it, it prefers these actions (it loves company);
// - sleep.stretchAfter: it stretches after its nap;
// - cold, heavy: its sounds on the moments of its events file (src/render/monsterfx.js).
export const MONSTER_FX = {
  spectre: {
    idleAlso: ['threat'], actionLoops: { sleep: 2 }, actionGap: [6, 15],
  },
  yeti: {
    idleKinds: ['look', 'scratch', 'stretch', 'shake', 'happy', 'chestbeat'],
    actionGap: [7, 18],
    walkSpeed: 0.25,
    runSpeed: 0.56,
    runChance: 0.12,
    restRange: [3, 9],
    sleep: { chance: 0.18, loops: [2, 4], stretchAfter: true },
    angry: { below: 35, kinds: ['threat'] },
    escapedMove: 'run',
    escapedKinds: ['threat', 'look'],
    visitorKinds: ['happy', 'look'],
    cold: true,
  },
  golem: {
    idleKinds: ['look', 'stretch', 'chestbeat', 'shake'],
    actionGap: [12, 28],
    walkSpeed: 0.45,
    restRange: [6, 16],
    statue: [10, 20],
    sleep: { chance: 0.25, loops: [3, 5] },
    angry: { below: 35, kinds: ['threat', 'slam'] },
    escapedKinds: ['threat', 'slam'],
    heavy: true,
  },
};
const baseSpecies = (species) => species.replace(/_[a-z]+$/, '');
export const monsterFx = (species) => MONSTER_FX[baseSpecies(species)] ?? {};

function parseAnimName(name) {
  const stacked = name.match(/^(.+)-([a-z]+)-dirs$/);
  if (stacked) return { species: stacked[1], kind: stacked[2], dir: 'all' };
  const m = name.match(/^(.+)-([a-z]+)-d(\d)$/);
  return m ? { species: m[1], kind: m[2], dir: Number(m[3]) } : null;
}

// Effect moments of the animations ({ golem: { walk: { frames, events: [{ f, type, at }] } } }).
const eventFiles = import.meta.glob('../config/anim-events/*-events.json', { eager: true, import: 'default' });
export const MONSTER_EVENTS = Object.fromEntries(
  Object.entries(eventFiles).map(([path, data]) => [path.split('/').pop().replace('-events.json', ''), data]),
);

function fpsOf(species, kind) {
  if (isPerson(species)) return ANIM_FPS.person[kind] ?? 6;
  const base = baseSpecies(species); // "kraken_water" plays at the speeds of "kraken"
  return ANIM_FPS[species]?.[kind] ?? ANIM_FPS[base]?.[kind] ?? ANIM_FPS.default[kind] ?? 6;
}

export function preloadSprites(scene) {
  for (const [name, url] of Object.entries(ICON_URLS)) {
    // all the enclosure decorations in one image (scripts/render-model/render-decor.mjs)
    if (name === 'decor-atlas') scene.load.spritesheet(`img-${name}`, url, { frameWidth: 128, frameHeight: 192 });
    else scene.load.image(`img-${name}`, url);
  }
}

// Called once at start: one Phaser animation per direction of each animation, on an empty texture with as
// many frames (nothing is drawn: only its timing counts). The wake-up also gives "sitdown": the same
// frames backwards (falling asleep).
export function createAnimations(scene) {
  for (const [name, n] of Object.entries(ANIM_FRAMES)) {
    const info = parseAnimName(name);
    if (!info) continue;
    const stacked = info.dir === 'all';
    const key = `anim-${name}`;
    if (!scene.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const tex = scene.textures.addCanvas(key, c);
      for (let i = 0; i < n * (stacked ? 8 : 1); i++) tex.add(i, 0, 0, 0, 1, 1);
    }
    const { species, kind } = info;
    const fx = monsterFx(species);
    const repeat = LOOPING.has(kind) || (kind === 'sleep' && fx.sleep) ? -1 : (fx.actionLoops?.[kind] ?? 1) - 1;
    for (const dir of stacked ? [0, 1, 2, 3, 4, 5, 6, 7] : [info.dir]) {
      const animKey = `${species}-${kind}-d${dir}`;
      if (scene.anims.exists(animKey)) continue;
      const first = stacked ? dir * n : 0;
      const frames = Array.from({ length: n }, (_, i) => ({ key, frame: first + i }));
      // a nap lasts several loops of the sleep animation (MONSTER_FX sleep)
      scene.anims.create({ key: animKey, frames, frameRate: fpsOf(species, kind), repeat });
      if (kind === 'wakeup') {
        scene.anims.create({ key: `${species}-sitdown-d${dir}`, frames: [...frames].reverse(), frameRate: fpsOf(species, 'sitdown'), repeat: 0 });
      }
    }
  }
}

// Idle actions available for a species (e.g. ['flap', 'look']), with their length in game seconds.
const actionCache = new Map();
export function idleActions(scene, speciesId) {
  if (!actionCache.has(speciesId)) {
    const list = [];
    const fx = monsterFx(speciesId);
    for (const name of Object.keys(ANIM_FRAMES)) {
      const info = parseAnimName(name);
      if (!info || info.species !== speciesId || (info.dir !== 0 && info.dir !== 'all')) continue;
      if (LOOPING.has(info.kind) && !fx.idleAlso?.includes(info.kind)) continue;
      if (fx.idleKinds && !fx.idleKinds.includes(info.kind)) continue; // the others are played on purpose
      const anim = scene.anims.get(`${speciesId}-${info.kind}-d0`);
      const loops = fx.actionLoops?.[info.kind] ?? 1;
      if (anim) list.push({ kind: info.kind, duration: (loops * anim.frames.length) / anim.frameRate });
    }
    actionCache.set(speciesId, list);
  }
  return actionCache.get(speciesId);
}

export function hasThreatAnimation(scene, speciesId) {
  return scene.anims.exists(`${speciesId}-threat-d0`);
}

export function hasFlyAnimation(scene, speciesId) {
  return scene.anims.exists(`${speciesId}-fly-d0`);
}

export function hasAnimation(scene, speciesId) {
  return scene.anims.exists(`${speciesId}-walk-d0`) && scene.anims.exists(`${speciesId}-idle-d0`);
}

// The icon (Blender render) for a procedural texture key if there is one, else the key itself.
// Buildings are looked up as "bld-<type>".
export function realKey(scene, key) {
  if (scene.textures.exists(`img-${key}`)) return `img-${key}`;
  if (scene.textures.exists(`img-bld-${key}`)) return `img-bld-${key}`;
  return key;
}

// Direction index 0..7 for a movement (dx, dy) in tile units.
export function directionIndex(dx, dy) {
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return ((Math.round(deg / 45) % 8) + 8) % 8;
}

// ---- people ----------------------------------------------------------------

const VISITOR_LOOKS = [...new Set(Object.keys(ANIM_FRAMES)
  .map((n) => n.match(/^(person-visitor\d+)-walk-d0$/)?.[1]).filter(Boolean))].sort();

// The 3D look of a visitor ("person-visitor3"), always the same for a given visitor; null if none rendered.
export function visitorLook(visitor) {
  if (!VISITOR_LOOKS.length) return null;
  let h = 0;
  for (const c of String(visitor.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VISITOR_LOOKS[h % VISITOR_LOOKS.length];
}

export function hasPerson(scene, look) {
  return !!look && scene.anims.exists(`${look}-walk-d0`) && scene.anims.exists(`${look}-idle-d0`);
}

// People only have the 4 path directions (even indices): snap any direction to one of them.
export function personDirection(dx, dy) {
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return ((Math.round(deg / 90) % 4) + 4) % 4 * 2;
}
