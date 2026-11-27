// Turns an animated 3D model (.glb) into the game's sprite sheets, in the 8 directions.
//
// Usage: node scripts/render-model/render.mjs <species id>
// Example: node scripts/render-model/render.mjs dragonnet
//
// Reads models/<species>.glb, writes src/assets/anims/<species>-<kind>-d<0..7>.webp
// and src/assets/sprites/<species>-d<0..7>.png (still images for portraits).
// Needs `npm install`, then Playwright: `npm install --no-save playwright` and `npx playwright install chromium`.
//
// To add a model: put the .glb in models/, add an entry to MODELS below (which animation of the
// model plays which role in the game), then set the playback speeds in ANIM_FPS (src/render/sprites.js).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Playwright is not a project dependency: install it once with `npm install --no-save playwright`.
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// kind: role in the game (walk, idle, fly or a one-shot idle action) -> animation of the model.
// frames = duration of the clip x frames per second in ANIM_FPS (one sheet = exactly one loop).
// view: half-width of a frame in model units (smaller = bigger monster).
const MODELS = {
  dragonnet: {
    view: 1.4,
    anims: {
      walk: { clip: 'Walk', frames: 12 },          // 1.2 s at 10 fps
      idle: { clip: 'Idle', frames: 18 },          // 3 s at 6 fps
      fly: { clip: 'Fly', frames: 8 },             // 0.8 s at 10 fps (escaped and moving)
      flap: { clip: 'FlapWings', frames: 12 },     // 2.4 s at 5 fps
      stretch: { clip: 'StretchWings', frames: 18 }, // 3 s at 6 fps
      look: { clip: 'LookAround', frames: 24 },    // 4 s at 6 fps
      tail: { clip: 'TailWag', frames: 18 },       // 3 s at 6 fps
    },
  },
};

const species = process.argv[2];
const model = MODELS[species];
if (!model) {
  console.error(`Usage: node scripts/render-model/render.mjs <${Object.keys(MODELS).join('|')}>`);
  process.exit(1);
}

// Fill every cell of the sheet (8 or 6 columns), so the game can count frames from the image size.
const columns = (n) => [8, 6, 4, 3, 2].find((c) => n % c === 0 && n >= c) ?? n;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('Page error:', e.message));
const files = {
  '/render.html': path.join(ROOT, 'scripts/render-model/render.html'),
  '/model.glb': path.join(ROOT, 'models', `${species}.glb`),
};
await page.route('http://render.local/**', (route) => {
  const url = new URL(route.request().url()).pathname;
  const file = files[url] ?? (url.startsWith('/three/') && path.join(ROOT, 'node_modules', url));
  if (!file) return route.fulfill({ status: 404 });
  const type = url.endsWith('.js') ? 'text/javascript' : url.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  return route.fulfill({ body: readFileSync(file), contentType: type });
});
await page.goto('http://render.local/render.html');
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
console.log(`Animations in the model: ${(await page.evaluate(() => window.clips)).join(', ')}`);

const save = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
for (let dir = 0; dir < 8; dir++) {
  for (const [kind, a] of Object.entries(model.anims)) {
    const url = await page.evaluate((o) => window.renderSheet(o), { ...a, dir, cols: columns(a.frames), view: model.view });
    save(path.join(ROOT, 'src/assets/anims', `${species}-${kind}-d${dir}.webp`), url);
  }
  const still = await page.evaluate((o) => window.renderStill(o), { clip: model.anims.idle.clip, dir, view: model.view });
  save(path.join(ROOT, 'src/assets/sprites', `${species}-d${dir}.png`), still);
  console.log(`Direction ${dir} done`);
}
await browser.close();
