// Realistic monster images (prepared with scripts/prepare_sprite.py).
// Every PNG in src/assets/sprites is picked up: "<speciesId>.png" and "<speciesId>-rare.png".
const files = import.meta.glob('../assets/sprites/*.png', { eager: true, query: '?url', import: 'default' });

export const SPRITE_URLS = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split('/').pop().replace('.png', ''), url]),
);

// Display scale of a 256 px sprite, per species (how big the monster looks on the map).
export const SPRITE_SCALE = { dragonnet: 0.42, kraken: 0.4, spectre: 0.38, golem: 0.36, yeti: 0.38 };

// Tint used for a rare monster when only the normal image exists.
export const RARE_FALLBACK_TINT = 0xffd36b;

// Realistic ground tiles and buildings rendered in Blender (2x the in-game size).
// Their file name is the procedural texture key they replace: tile-grass.png, bld-snack.png...
// Enclosure decorations (scripts/render-model/render-decor.mjs): "decor-<id>-<variant>.png".
const decor = import.meta.glob(['../assets/tiles/*.{png,webp}', '../assets/buildings/*.{png,webp}', '../assets/decor/*.{png,webp}'], { eager: true, query: '?url', import: 'default' });
export const DECOR_URLS = Object.fromEntries(
  Object.entries(decor).map(([path, url]) => [path.split('/').pop().replace(/\.(png|webp)$/, ''), url]),
);

// Animated 3D models: sheets of 256 px frames (read left to right, then row by row, every cell used),
// "<speciesId>-<kind>-d<0..7>.png|webp". Kinds:
// - walk, idle: required, looping;
// - fly: optional, looping, replaces walk while the monster is escaped;
// - threat: optional, looping, replaces idle while the monster is escaped;
// - any other kind (flap, stretch, look, tail...): optional one-shot "idle action" played now and then at rest.
// "<speciesId>-<kind>-dirs.webp": the 8 directions of an animation stacked in one sheet (row = direction);
// "<speciesId>_glow-<kind>-dirs.webp": its light layer (glowing parts only, 128 px frames, see monsterfx.js);
// "<speciesId>-events.json": frames where effects happen (a foot landing...), made by render.mjs.
const animFiles = import.meta.glob('../assets/anims/*.{png,webp}', { eager: true, query: '?url', import: 'default' });
export const ANIM_URLS = Object.fromEntries(
  Object.entries(animFiles).map(([path, url]) => [path.split('/').pop().replace(/\.(png|webp)$/, ''), url]),
);
const LOOPING = new Set(['walk', 'idle', 'fly', 'run', 'wave', 'threat']);
// Playback speed of each animation (frames per second of the sampled sheet), per species.
const ANIM_FPS = {
  default: { walk: 8, idle: 3 },
  // dragonnet: rendered from dragon_animated_v2.glb with scripts/render-model (one loop = one clip)
  dragonnet: { walk: 12, idle: 6, fly: 10, flap: 5, stretch: 6, look: 6, tail: 6 },
  kraken: { walk: 10, idle: 4, threat: 6, look: 5, wiggle: 6, sleep: 4 },
  spectre: { walk: 6, idle: 3, threat: 4, look: 3, haunt: 4, sleep: 2 },
  yeti: {
    walk: 10, run: 10 / 0.95, idle: 3, look: 3, scratch: 14 / 3.6, chestbeat: 5, stretch: 12 / 3.5, happy: 5, threat: 5,
    sleep: 8 / 5, wakeup: 4, sitdown: 4, shake: 16 / 2.8,
  },
  golem: {
    walk: 8, idle: 3, look: 3, stretch: 12 / 3.5, chestbeat: 5, slam: 6, threat: 4, sleep: 8 / 5, wakeup: 4, sitdown: 4, shake: 5,
  },
  // every "person-..." sheet (Quaternius characters, see scripts/render-model/render.mjs)
  person: { walk: 7.2, run: 8, idle: 2.88, wave: 5.76 },
};

// People are rendered smaller (128 px frames, feet 108 px down) and only in the 4 path directions.
export const PERSON_FRAME = 128;
export const PERSON_ORIGIN_Y = 108 / 128;
const isPerson = (name) => name.startsWith('person-');

// Monsters whose sheets are cropped tighter than 256 px (same scale, less weight).
const FRAME_SIZE = { spectre: 176 };

// Per-species behaviour of the animated sprite (only for the species listed; the others keep the defaults):
// - idleAlso: looping kinds also played now and then as idle actions (one loop);
// - actionLoops: idle actions played several times in a row;
// - actionGap: [min, max] game seconds of plain idling between two idle actions;
// - crossfadeMs: blend the old pose into the new one when the animation changes (only for see-through
//   monsters: on a solid body the two poses show at once, like a blur);
// - spectral: see-through floating ghost (src/render/monsterfx.js): no shadow, mist, glow, fade in/out.
// - idleKinds: only these kinds are random idle actions (the others are played on purpose);
// - walkSpeed: tiles / s matching the stride of its walk animation (no sliding feet); restRange: [min, max]
//   seconds it stays put between two strolls in its enclosure; walkPulse: speed factor for each frame of
//   its walk (a gait whose speed changes during a step), average 1;
// - statue: [min, max] seconds it may stand perfectly still (an idle action);
// - sleep: { chance, loops: [min, max] }: an idle action may be a nap: sit down, sleep, wake up;
// - angry: { below, kinds }: under this happiness, these actions join the idle ones;
// - escapedKinds: what it does when it stops while escaped (one of them, picked at each stop);
// - runSpeed, runChance: now and then a stroll is a run (tiles / s matching its run animation);
// - escapedMove: the animation it moves with when escaped ('run');
// - visitorKinds: when visitors watch it, it prefers these actions (it loves company);
// - sleep.stretchAfter: it stretches after its nap;
// - cold: breath vapour, snow under its steps and from its fur on snowy ground, its own sounds (monsterfx.js);
// - glow: its light layer (eyes, cracks): { base } brightness at rest (0..1);
// - heavy: dust, pebbles, tremors and sounds on the moments of its events file.
export const MONSTER_FX = {
  // its feet push back at 0.19 tile/s with the Walk clip at 10 fps: played a little faster (12 fps), 0.23
  dragonnet: { walkSpeed: 0.23 },
  spectre: {
    idleAlso: ['threat'], actionLoops: { sleep: 2 }, actionGap: [6, 15], crossfadeMs: 260, spectral: true,
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
    // its planted foot pushes back at 0.375 tile/s on average (measured on the Walk clip, all directions),
    // but unevenly: almost stopped when its weight passes from one foot to the other, then a heavy lunge
    walkSpeed: 0.375,
    walkPulse: [0.26, 0.25, 1.3, 1.62, 1.68, 1.49, 1.05, 0.46, 0.26, 0.25, 1.3, 1.62, 1.68, 1.49, 1.05, 0.46],
    restRange: [6, 16],
    statue: [10, 20],
    sleep: { chance: 0.25, loops: [3, 5] },
    angry: { below: 35, kinds: ['threat', 'slam'] },
    escapedKinds: ['threat', 'slam'],
    glow: { base: 0.5 },
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

// Light layers ("golem_glow") are rendered at half size.
export const GLOW_FRAME = 128;
const isGlow = (species) => species.endsWith('_glow');

// Effect moments of the animations ({ golem: { walk: { frames, events: [{ f, type, at }] } } }).
const eventFiles = import.meta.glob('../assets/anims/*-events.json', { eager: true, import: 'default' });
export const MONSTER_EVENTS = Object.fromEntries(
  Object.entries(eventFiles).map(([path, data]) => [path.split('/').pop().replace('-events.json', ''), data]),
);

function fpsOf(species, kind) {
  if (isPerson(species)) return ANIM_FPS.person[kind] ?? 6;
  const base = baseSpecies(species); // "kraken_water" plays at the speeds of "kraken"
  return ANIM_FPS[species]?.[kind] ?? ANIM_FPS[base]?.[kind] ?? ANIM_FPS.default[kind] ?? 6;
}

export function preloadSprites(scene) {
  for (const [name, url] of Object.entries(SPRITE_URLS)) scene.load.image(`real-${name}`, url);
  for (const [name, url] of Object.entries(DECOR_URLS)) {
    // photo grounds (lawn, paths, habitats): one sheet of n x n tiles (128 x 64 px each) per ground;
    // '-anim': the frames of a looping animated ground (lava, water), 4 blocks of n x n tiles per row
    if (name.endsWith('-sheet') || name.endsWith('-anim')) scene.load.spritesheet(`img-${name}`, url, { frameWidth: 128, frameHeight: 64 });
    // all the enclosure decorations in one image (scripts/render-model/render-decor.mjs)
    else if (name === 'decor-atlas') scene.load.spritesheet(`img-${name}`, url, { frameWidth: 128, frameHeight: 192 });
    else scene.load.image(`img-${name}`, url);
  }
  for (const [name, url] of Object.entries(ANIM_URLS)) {
    const species = parseAnimName(name)?.species ?? '';
    const size = isPerson(name) ? PERSON_FRAME : isGlow(species) ? GLOW_FRAME : FRAME_SIZE[baseSpecies(species)] ?? 256;
    scene.load.spritesheet(`anim-${name}`, url, { frameWidth: size, frameHeight: size });
  }
}

// Called once after loading: one Phaser animation per sheet (same key as the sheet).
export function createAnimations(scene) {
  for (const name of Object.keys(ANIM_URLS)) {
    const info = parseAnimName(name);
    if (!info || scene.anims.exists(name)) continue;
    if (info.dir === 'all') {
      if (!isGlow(info.species)) createStackedAnimations(scene, name, info);
      continue;
    }
    scene.anims.create({
      key: name,
      frames: scene.anims.generateFrameNumbers(`anim-${name}`),
      frameRate: fpsOf(info.species, info.kind),
      repeat: LOOPING.has(info.kind) ? -1 : (monsterFx(info.species).actionLoops?.[info.kind] ?? 1) - 1,
    });
  }
}

// One animation per direction from a stacked sheet ("golem-walk-d3" = row 3 of "golem-walk-dirs"). The wake-up
// sheet also gives "sitdown": the same frames backwards (falling asleep).
function createStackedAnimations(scene, name, { species, kind }) {
  const tex = scene.textures.get(`anim-${name}`);
  const frameW = FRAME_SIZE[baseSpecies(species)] ?? 256;
  const cols = tex.getSourceImage().width / frameW;
  const fx = monsterFx(species);
  for (let dir = 0; dir < 8; dir++) {
    const frames = scene.anims.generateFrameNumbers(`anim-${name}`, { start: dir * cols, end: dir * cols + cols - 1 });
    scene.anims.create({
      key: `${species}-${kind}-d${dir}`,
      frames,
      frameRate: fpsOf(species, kind),
      // a nap lasts several loops of the sleep animation (MONSTER_FX sleep)
      repeat: LOOPING.has(kind) || (kind === 'sleep' && fx.sleep) ? -1 : (fx.actionLoops?.[kind] ?? 1) - 1,
    });
    if (kind === 'wakeup') {
      scene.anims.create({ key: `${species}-sitdown-d${dir}`, frames: [...frames].reverse(), frameRate: fpsOf(species, 'sitdown'), repeat: 0 });
    }
  }
}

// Idle actions available for a species (e.g. ['flap', 'look']), with their length in game seconds.
const actionCache = new Map();
export function idleActions(scene, speciesId) {
  if (!actionCache.has(speciesId)) {
    const list = [];
    const fx = monsterFx(speciesId);
    for (const name of Object.keys(ANIM_URLS)) {
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

// The realistic version of a procedural texture key if one was loaded, else the key itself.
// Buildings are looked up as "bld-<type>".
export function realKey(scene, key) {
  if (scene.textures.exists(`img-${key}`)) return `img-${key}`;
  if (scene.textures.exists(`img-bld-${key}`)) return `img-bld-${key}`;
  return key;
}

// 3D models rendered in Blender in 8 directions: "<speciesId>-d0.png" ... "-d7.png" (256 px, 2x scale,
// feet centre 40 px above the bottom). d0 faces +ty (screen bottom-left), each next one turns 45 deg.
export const DIRECTIONAL_SCALE = 0.5;
export const DIRECTIONAL_ORIGIN_Y = 216 / 256;
// Species rendered with their feet higher in the frame (room for long front tentacles).
const ORIGIN_Y = { kraken: 176 / 256, kraken_water: 150 / 256, spectre: 1 };
export const directionalOriginY = (speciesId) => ORIGIN_Y[speciesId] ?? DIRECTIONAL_ORIGIN_Y;

// Direction index 0..7 for a movement (dx, dy) in tile units.
export function directionIndex(dx, dy) {
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return ((Math.round(deg / 45) % 8) + 8) % 8;
}

// Which texture to draw a monster with: { key, tint, real, scale, directional }.
export function resolveMonsterTexture(scene, monster, dir = 0) {
  const base = monster.speciesId;
  const has = (k) => scene.textures.exists(`real-${k}`);
  if (has(`${base}-d0`)) {
    const rareDir = monster.rare && has(`${base}-rare-d0`);
    return {
      key: `real-${base}${rareDir ? '-rare' : ''}-d${dir}`,
      tint: monster.rare && !rareDir ? RARE_FALLBACK_TINT : null,
      real: true,
      directional: true,
      scale: DIRECTIONAL_SCALE,
    };
  }
  if (monster.rare && has(`${base}-rare`)) return { key: `real-${base}-rare`, tint: null, real: true, scale: SPRITE_SCALE[base] };
  if (has(base)) {
    return { key: `real-${base}`, tint: monster.rare ? RARE_FALLBACK_TINT : null, real: true, scale: SPRITE_SCALE[base] };
  }
  return { key: `monster-${base}${monster.rare ? '-rare' : ''}`, tint: null, real: false, scale: 1 };
}

// ---- people ----------------------------------------------------------------

const VISITOR_LOOKS = [...new Set(Object.keys(ANIM_URLS)
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
