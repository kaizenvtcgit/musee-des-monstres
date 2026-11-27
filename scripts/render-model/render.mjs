// Turns animated 3D models (.glb / .gltf) into the game's sprite sheets.
//
// Usage: node scripts/render-model/render.mjs <model name | people | all>
// Examples: node scripts/render-model/render.mjs dragonnet
//           node scripts/render-model/render.mjs people
//
// Writes src/assets/anims/<name>-<kind>-d<dir>.webp (and, for monsters, a still image per direction
// in src/assets/sprites/<name>-d<dir>.png, used for portraits).
// Needs `npm install`, then Playwright: `npm install --no-save playwright` and `npx playwright install chromium`.
//
// To add a model: put the file in models/, add an entry below (which animation of the model plays
// which role in the game), then set the playback speeds in ANIM_FPS (src/render/sprites.js).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Playwright is not a project dependency: install it once with `npm install --no-save playwright`.
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// kind: role in the game -> animation of the model.
// frames = duration of the clip x frames per second in ANIM_FPS (one sheet = exactly one loop).
// view: half-width of a frame in model units (smaller = bigger on screen).
const MODELS = {
  dragonnet: {
    file: 'models/dragonnet.glb',
    view: 1.4,
    still: true,
    anims: {
      walk: { clip: 'Walk', frames: 12 },            // 1.2 s at 10 fps
      idle: { clip: 'Idle', frames: 18 },            // 3 s at 6 fps
      fly: { clip: 'Fly', frames: 8 },               // 0.8 s at 10 fps (escaped and moving)
      flap: { clip: 'FlapWings', frames: 12 },       // 2.4 s at 5 fps
      stretch: { clip: 'StretchWings', frames: 18 }, // 3 s at 6 fps
      look: { clip: 'LookAround', frames: 24 },      // 4 s at 6 fps
      tail: { clip: 'TailWag', frames: 18 },         // 3 s at 6 fps
    },
  },
  // on land (escaped): crawls and threatens
  kraken: {
    file: 'models/kraken.glb',
    view: 1.85, // a "pocket" kraken: a bit smaller than the dragon
    feetY: 176, // the front tentacles reach far toward the viewer: keep room below (ORIGIN_Y in sprites.js)
    still: true,
    anims: {
      walk: { clip: 'Crawl', frames: 16 },     // 1.6 s at 10 fps
      idle: { clip: 'Idle', frames: 16 },      // 4 s at 4 fps
      threat: { clip: 'Threat', frames: 15 },  // 2.5 s at 6 fps (escaped and standing)
    },
  },
  // yeti: white fur grown on the model by shell fur at render time (scripts/render-model/render.html, addFur);
  // the skin glued between its hands and thighs is split when its arms rise (armpitFix). Its 8 directions of an
  // animation are stacked in one sheet; the moments of its steps, breaths, snores... go to yeti-events.json.
  yeti: {
    file: 'models/yeti.glb',
    view: 1.45,
    feetY: 216,
    still: true,
    layout: 'dirs',
    quality: 0.72,
    events: 'yeti',
    armpitFix: { arms: ['UpperArm.L', 'UpperArm.R', 'Forearm.L', 'Forearm.R', 'Hand.L', 'Hand.R'], belowY: 0.25, maxStretch: 2.5 },
    // fur settings: length (model units, the yeti is 2 tall), cell (spacing of the strands), thickness (of a strand,
    // 0..0.5 of a cell), density (share of cells with a strand), layers (quality), colors, colorMix (over the
    // texture), rootShade (darkness at the root), gravity; regions: length factor by bone (0 = no fur)
    fur: {
      mask: '/models/yeti/yeti_fur_mask_prepared.png',
      layers: 20, length: 0.07, cell: 0.014, thickness: 0.45, density: 0.85,
      colors: ['#ffffff', '#f2eee6', '#d8d8d6'], colorMix: 0.45, rootShade: 0.55, gravity: 0.35,
      regions: { Head: 1.2, Chest: 1.15, Spine: 1.0, UpperArm: 1.0, Pelvis: 0.85, Thigh: 0.7, Forearm: 0.5, Shin: 0.45, Hand: 0, Foot: 0, Root: 0.8 },
    },
    anims: {
      walk: { clip: 'Walk', frames: 16, furMove: { trail: 6 } },          // 1.6 s at 10 fps
      run: { clip: 'Run', frames: 10, furMove: { trail: 9 } },            // 0.95 s at 10.5 fps
      idle: { clip: 'Idle', frames: 12 },                                 // 4 s at 3 fps
      look: { clip: 'Look Around', frames: 12 },                          // 4 s
      scratch: { clip: 'ScratchHead', frames: 14, furMove: { trail: 4 } }, // 3.6 s
      chestbeat: { clip: 'ChestBeat', frames: 15, furMove: { trail: 5 } }, // 3 s at 5 fps
      stretch: { clip: 'Stretch', frames: 12 },                           // 3.5 s
      happy: { clip: 'Happy', frames: 14, furMove: { trail: 6 } },        // 2.8 s at 5 fps
      threat: { clip: 'Threat', frames: 14, furMove: { trail: 6 } },      // 2.8 s at 5 fps
      sleep: { clip: 'Sleep', frames: 8 },                                // 5 s at 1.6 fps
      wakeup: { clip: 'WakeUp', frames: 12 },                             // 3 s at 4 fps (backwards: falls asleep)
      shake: { clip: 'ShakeFur', frames: 16, furMove: { trail: 5, shake: 0.9, shakeHz: 2.3, shakeDur: 2.8 } }, // 2.8 s
    },
  },
  // heavy stone golem: bigger than the others; its glowing eyes and golden cracks are a separate light layer
  // (glow) the game brightens and dims; the 8 directions of an animation are stacked in one sheet (layout).
  golem: {
    file: 'models/golem.glb',
    view: 1.36, // about 100 px tall in the game: more imposing than the dragon and the kraken
    feetY: 216,
    still: true,
    layout: 'dirs',
    emissiveScale: 0.35, // the light layer adds the rest
    quality: 0.7, // many frames: a little more compression keeps it near the other monsters
    glow: { frame: 128, radius: 2 },
    events: true,
    anims: {
      walk: { clip: 'Walk', frames: 16, reverse: true }, // 2 s at 8 fps; authored backwards (see README)
      idle: { clip: 'Idle', frames: 12 },                // 4 s at 3 fps
      look: { clip: 'Look Around', frames: 12 },         // 4 s at 3 fps
      stretch: { clip: 'Stretch', frames: 12 },          // 3.5 s
      chestbeat: { clip: 'ChestBeat', frames: 15 },      // 3 s at 5 fps
      slam: { clip: 'GroundSlam', frames: 15 },          // 2.5 s at 6 fps
      threat: { clip: 'Threat', frames: 12 },            // 3 s at 4 fps
      sleep: { clip: 'Sleep', frames: 8 },               // 5 s at 1.6 fps
      wakeup: { clip: 'WakeUp', frames: 12 },            // 3 s at 4 fps (played backwards to fall asleep)
      shake: { clip: 'RockShake', frames: 15 },          // 3 s at 5 fps
    },
  },
  // floats above the ground; eyes glow, the bottom of the body dissolves into mist
  spectre: {
    file: 'models/spectre.glb',
    // same scale as the other monsters (view 1.75 in a 256 px frame) but cropped to 176 px around the body:
    // a third of the weight (FRAME_SIZE and ORIGIN_Y in sprites.js)
    frame: 176,
    view: 1.75 * (176 / 256),
    feetY: 176,
    hover: 0.12,
    bloom: { strength: 2.2, radius: 3, tint: [0.6, 0.88, 1] }, // icy blue halo around the eyes
    dissolve: { height: 0.3, edge: 0.55 },
    still: true,
    // wispy see-through mist compresses badly: few frames (slow ghostly moves), 16 transparency levels
    quality: 0.72,
    alphaLevels: 16,
    anims: {
      walk: { clip: 'Float', frames: 12 },        // 2 s at 6 fps (moving)
      idle: { clip: 'Idle', frames: 12 },         // 4 s at 3 fps
      threat: { clip: 'Threat', frames: 10 },     // 2.5 s at 4 fps (escaped and standing; also an idle action)
      look: { clip: 'Look Around', frames: 12 },  // 4 s at 3 fps
      haunt: { clip: 'Haunt', frames: 12 },       // 3 s at 4 fps
      sleep: { clip: 'Sleep', frames: 10 },       // 5 s at 2 fps
    },
  },
  // in a water enclosure ("<species>_<habitat>"): swims sunk to the eyes, tentacles under the surface
  kraken_water: {
    file: 'models/kraken.glb',
    view: 1.85,
    feetY: 150, // the water surface; room below for the tentacles (ORIGIN_Y in sprites.js)
    waterline: 0.3,
    anims: {
      walk: { clip: 'Crawl', frames: 16 },             // 1.6 s at 10 fps
      idle: { clip: 'Idle', frames: 16 },              // 4 s at 4 fps
      look: { clip: 'Look Around', frames: 18 },       // 3.6 s at 5 fps
      wiggle: { clip: 'Tentacle Wiggle', frames: 18 }, // 3 s at 6 fps
      sleep: { clip: 'Sleep', frames: 20 },            // 5 s at 4 fps
    },
  },
};

// People: Quaternius "Ultimate Modular Men / Women" packs (CC0, https://quaternius.com).
// The .gltf files are not stored in the repository (about 3 MB each): download the glTF folder of
// "Individual Characters" of both packs into models/people/women/ and models/people/men/.
// They only walk along paths (4 directions), so only the even directions are rendered.
const PERSON = {
  view: 1.35, frame: 128, feetY: 108, dirs: [0, 2, 4, 6], groundY: 0,
  anims: {
    walk: { clip: 'Walk', frames: 12 },          // 1.67 s
    run: { clip: 'Run', frames: 8 },             // 1 s (fleeing, keepers chasing)
    idle: { clip: 'Idle_Neutral', frames: 6 },   // 2.08 s
  },
};
const VISITOR_ANIMS = { ...PERSON.anims, wave: { clip: 'Wave', frames: 12 } }; // 2.08 s, happy in front of a monster
const VISITORS = [
  'women/Casual', 'women/Formal', 'women/Suit', 'women/Punk', 'women/Worker',
  'men/Beach', 'men/Casual_2', 'men/Casual_Hoodie', 'men/Farmer', 'men/Suit',
];
VISITORS.forEach((file, i) => {
  MODELS[`person-visitor${i}`] = { ...PERSON, file: `models/people/${file}.gltf`, anims: VISITOR_ANIMS };
});
MODELS['person-keeper'] = { ...PERSON, file: 'models/people/women/Adventurer.gltf' };

const arg = process.argv[2];
const names = arg === 'all' ? Object.keys(MODELS)
  : arg === 'people' ? Object.keys(MODELS).filter((n) => n.startsWith('person-'))
    : MODELS[arg] ? [arg] : null;
if (!names) {
  console.error(`Usage: node scripts/render-model/render.mjs <${Object.keys(MODELS).filter((n) => !n.startsWith('person-')).join('|')}|people|all>`);
  process.exit(1);
}

// Fill every cell of the sheet, so the game can count frames from the image size.
const columns = (n) => [8, 6, 4, 3, 2].find((c) => n % c === 0 && n >= c) ?? n;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('Page error:', e.message));
await page.route('http://render.local/**', (route) => {
  const url = decodeURIComponent(new URL(route.request().url()).pathname);
  let file = null;
  if (url === '/render.html') file = path.join(ROOT, 'scripts/render-model/render.html');
  else if (url.startsWith('/three/')) file = path.join(ROOT, 'node_modules', url);
  else if (url.startsWith('/models/')) file = path.join(ROOT, url);
  if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
  const type = url.endsWith('.js') ? 'text/javascript' : url.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  return route.fulfill({ body: readFileSync(file), contentType: type });
});
await page.goto('http://render.local/render.html');
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });

const save = (file, dataUrl) => writeFileSync(path.join(ROOT, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
for (const name of names) {
  const m = MODELS[name];
  if (!existsSync(path.join(ROOT, m.file))) {
    console.error(`${name}: missing ${m.file} (see the comments at the top of this script)`);
    continue;
  }
  await page.evaluate(([u, o]) => window.loadModel(u, o), [`/${m.file}`, { fur: m.fur, armpitFix: m.armpitFix }]);
  const opts = {
    view: m.view, frame: m.frame ?? 256, feetY: m.feetY ?? 216, groundY: m.groundY, waterline: m.waterline ?? null,
    hover: m.hover ?? 0, bloom: m.bloom ?? null, dissolve: m.dissolve ?? null, quality: m.quality ?? 0.82, alphaLevels: m.alphaLevels ?? 0,
    emissiveScale: m.emissiveScale ?? 1,
  };
  if (m.layout === 'dirs') {
    await renderStacked(name, m, opts);
    console.log(`${name} done`);
    continue;
  }
  for (const dir of m.dirs ?? [0, 1, 2, 3, 4, 5, 6, 7]) {
    for (const [kind, a] of Object.entries(m.anims)) {
      const url = await page.evaluate((o) => window.renderSheet(o), { ...opts, ...a, dir, cols: columns(a.frames) });
      save(`src/assets/anims/${name}-${kind}-d${dir}.webp`, url);
    }
    if (m.still) {
      const url = await page.evaluate((o) => window.renderSheet(o),
        { ...opts, clip: m.anims.idle.clip, frames: 1, cols: 1, dir, format: 'image/png' });
      save(`src/assets/sprites/${name}-d${dir}.png`, url);
    }
  }
  console.log(`${name} done`);
}
await browser.close();

// One sheet per animation with the 8 directions stacked (row = direction, one loop per row), plus the light
// layer (<name>_glow-...) and the event file (<name>-events.json) the game uses for dust, pebbles and sounds.
async function renderStacked(name, m, opts) {
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7];
  const events = {};
  for (const [kind, a] of Object.entries(m.anims)) {
    const one = (o) => page.evaluate((x) => window.renderSheet(x), { ...opts, ...a, cols: a.frames, ...o });
    const main = [];
    const glow = [];
    for (const dir of dirs) {
      main.push(await one({ dir }));
      if (m.glow) {
        const k = m.glow.frame / opts.frame;
        glow.push(await one({ dir, frame: m.glow.frame, feetY: opts.feetY * k, glowOnly: true, glowRadius: m.glow.radius, emissiveScale: 1 }));
      }
    }
    save(`src/assets/anims/${name}-${kind}-dirs.webp`, await page.evaluate((u) => window.stackSheets(u), main));
    if (m.glow) save(`src/assets/anims/${name}_glow-${kind}-dirs.webp`, await page.evaluate((u) => window.stackSheets(u), glow));
    if (m.events) events[kind] = await (m.events === 'yeti' ? yetiEvents : animEvents)(kind, a, opts);
  }
  if (m.still) {
    for (const dir of dirs) {
      const url = await page.evaluate((o) => window.renderSheet(o), { ...opts, clip: m.anims.idle.clip, frames: 1, cols: 1, dir, format: 'image/png' });
      save(`src/assets/sprites/${name}-d${dir}.png`, url);
    }
  }
  if (m.events) writeFileSync(path.join(ROOT, `src/assets/anims/${name}-events.json`), `${JSON.stringify(events)}\n`);
}

// Moments to play an effect in an animation, found from the bones: a foot landing, fists hitting the ground,
// fists raised against the chest... Each event: { f: frame, type, at: [[dx, dy] per direction] } where (dx, dy)
// is the spot on screen, in frame px from the ground point of the monster.
// The yeti's moments: soft steps (snow when the ground is snowy), its breath in the cold, snores, a roar...
// Same format as animEvents. The mouth is a point fixed to the head.
const MOUTH = 'Head@0,-0.01,0.22';
async function yetiEvents(kind, a, opts) {
  const bones = ['Foot.L', 'Foot.R', 'Hand.L', 'Hand.R', 'Chest', MOUTH];
  const probe = [];
  for (let dir = 0; dir < 8; dir++) probe.push(await page.evaluate((o) => window.probeBones(o), { ...opts, ...a, dir, bones }));
  const n = a.frames;
  const at = (f, bone, ground = false) => probe.map((rows) => {
    const b = rows[f][bone];
    return ground ? [b.gx - opts.frame / 2, b.gy - opts.feetY] : [b.x - opts.frame / 2, b.y - opts.feetY];
  });
  const h = (f, bone) => probe[0][(f + n) % n][bone].h;
  const out = [];
  if (kind === 'walk' || kind === 'run') {
    for (const foot of ['Foot.L', 'Foot.R']) {
      const low = Math.min(...probe[0].map((r) => r[foot].h));
      for (let f = 0; f < n; f++) {
        if (h(f, foot) <= low + 0.008 && h(f - 1, foot) > low + 0.008) out.push({ f, type: kind === 'run' ? 'padRun' : 'pad', at: at(f, foot, true) });
      }
    }
    out.push({ f: 0, type: 'breath', at: at(0, MOUTH) });
  }
  const breaths = { idle: [0, n / 2], look: [0, n / 2], stretch: [n - 2], scratch: [0], wakeup: [n - 2] };
  for (const f of breaths[kind] ?? []) out.push({ f: Math.floor(f), type: 'breath', at: at(Math.floor(f), MOUTH) });
  if (kind === 'sleep') for (const f of [0, n / 2]) out.push({ f, type: 'snore', at: at(f, MOUTH) });
  if (kind === 'threat') out.push({ f: Math.floor(n * 0.3), type: 'roar', at: at(Math.floor(n * 0.3), MOUTH) });
  if (kind === 'happy') out.push({ f: 1, type: 'happy', at: at(1, MOUTH) });
  if (kind === 'wakeup') out.push({ f: Math.floor(n / 2), type: 'grunt', at: at(Math.floor(n / 2), MOUTH) });
  if (kind === 'stretch') out.push({ f: Math.floor(n * 0.4), type: 'grunt', at: at(Math.floor(n * 0.4), MOUTH) });
  if (kind === 'scratch') for (let f = 3; f < n - 2; f += 3) out.push({ f, type: 'furRub', at: at(f, 'Chest') });
  if (kind === 'shake') for (let f = 2; f < n - 1; f += 3) out.push({ f, type: 'furShake', at: at(f, 'Chest') });
  if (kind === 'chestbeat') {
    for (const hand of ['Hand.L', 'Hand.R']) {
      for (let f = 0; f < n; f++) {
        if (h(f, hand) > h(f - 1, hand) && h(f, hand) >= h(f + 1, hand) && h(f, hand) > h(0, hand) + 0.15) out.push({ f, type: 'beat', at: at(f, 'Chest') });
      }
    }
  }
  out.sort((x, y) => x.f - y.f);
  return { frames: n, events: out };
}

async function animEvents(kind, a, opts) {
  const bones = ['Foot.L', 'Foot.R', 'Hand.L', 'Hand.R', 'Chest'];
  const probe = [];
  for (let dir = 0; dir < 8; dir++) {
    probe.push(await page.evaluate((o) => window.probeBones(o), { ...opts, ...a, dir, bones }));
  }
  const f0 = probe[0];
  const n = a.frames;
  const at = (f, bone, ground = true) => probe.map((rows) => {
    const b = rows[f][bone];
    return ground ? [b.gx - opts.frame / 2, b.gy - opts.feetY] : [b.x - opts.frame / 2, b.y - opts.feetY];
  });
  const out = [];
  const h = (f, bone) => f0[(f + n) % n][bone].h;
  if (kind === 'walk') {
    // a foot lands: it comes down to its lowest height after being lifted
    for (const foot of ['Foot.L', 'Foot.R']) {
      const low = Math.min(...f0.map((r) => r[foot].h));
      for (let f = 0; f < n; f++) {
        if (h(f, foot) <= low + 0.006 && h(f - 1, foot) > low + 0.006) out.push({ f, type: 'step', at: at(f, foot) });
      }
    }
  }
  if (kind === 'slam') {
    // impact: the fists at their lowest
    let best = 0;
    for (let f = 0; f < n; f++) if (h(f, 'Hand.L') + h(f, 'Hand.R') < h(best, 'Hand.L') + h(best, 'Hand.R')) best = f;
    out.push({ f: 0, type: 'grind', at: at(0, 'Chest') });
    out.push({ f: best, type: 'slam', at: probe.map((rows) => {
      const l = rows[best]['Hand.L'], r = rows[best]['Hand.R'];
      return [(l.gx + r.gx) / 2 - opts.frame / 2, (l.gy + r.gy) / 2 - opts.feetY];
    }) });
  }
  if (kind === 'chestbeat') {
    // each fist at its highest, against the chest
    for (const hand of ['Hand.L', 'Hand.R']) {
      for (let f = 0; f < n; f++) {
        if (h(f, hand) > h(f - 1, hand) && h(f, hand) >= h(f + 1, hand) && h(f, hand) > h(0, hand) + 0.15) {
          out.push({ f, type: 'beat', at: at(f, 'Chest', false) });
        }
      }
    }
  }
  if (kind === 'shake') for (let f = 1; f < n - 1; f += 3) out.push({ f, type: 'debris', at: at(f, 'Chest', false) });
  if (kind === 'threat') out.push({ f: 0, type: 'rumble', at: at(0, 'Chest', false) });
  if (kind === 'wakeup') for (const f of [0, Math.floor(n / 2)]) out.push({ f, type: 'pebbles', at: at(f, 'Chest', false) });
  if (kind === 'stretch') out.push({ f: 0, type: 'grind', at: at(0, 'Chest', false) });
  out.sort((x, y) => x.f - y.f);
  return { frames: n, events: out };
}
