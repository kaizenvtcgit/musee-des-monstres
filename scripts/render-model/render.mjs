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
  kraken: {
    file: 'models/kraken.glb',
    view: 1.85, // a "pocket" kraken: a bit smaller than the dragon
    feetY: 176, // the front tentacles reach far toward the viewer: keep room below (KRAKEN origin in sprites.js)
    still: true,
    anims: {
      walk: { clip: 'Crawl', frames: 16 },            // 1.6 s at 10 fps
      idle: { clip: 'Idle', frames: 16 },             // 4 s at 4 fps
      threat: { clip: 'Threat', frames: 15 },         // 2.5 s at 6 fps (escaped and standing)
      look: { clip: 'Look Around', frames: 18 },      // 3.6 s at 5 fps
      wiggle: { clip: 'Tentacle Wiggle', frames: 18 }, // 3 s at 6 fps
      sleep: { clip: 'Sleep', frames: 20 },           // 5 s at 4 fps
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
  await page.evaluate((u) => window.loadModel(u), `/${m.file}`);
  const opts = { view: m.view, frame: m.frame ?? 256, feetY: m.feetY ?? 216, groundY: m.groundY };
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
