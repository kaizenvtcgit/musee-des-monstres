// Renders the enclosure decorations (scripts/render-model/decor.html) into src/assets/decor/decor-<id>-<variant>.png:
// VARIANTS images per decoration, turned differently, so that several copies do not look identical.
//
// Usage: node scripts/render-model/render-decor.mjs [decoration id...]
// Needs the same setup as render.mjs (npm install, then Playwright with Chromium).
// Photo-scanned models come from Poly Haven (CC0, https://polyhaven.com): they are downloaded once into
// models/decor/ (not stored in the repository).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENCLOSURE_DECOR } from '../../src/config/decor.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODELS = path.join(ROOT, 'models/decor');
const OUT = path.join(ROOT, 'src/assets/decor');
const VARIANTS = [0, 140];

// How each decoration looks. polyhaven: model id; built: object made in decor.html.
// size: widest footprint (tiles) | height (tiles); tint; lava: glowing creases; snow: snow on top;
// glow: halo strength around glowing parts; waterline: how deep it sits in the water (tiles);
// largest: keep only the n biggest pieces of a model; light: glow colour of the parts whose material name
// contains lightOn (lit from inside).
const LOOKS = {
  lavaRock: { polyhaven: 'boulder_01', size: 0.7, tint: 0x3a3634, lava: 1.6 },
  fumarole: { polyhaven: 'namaqualand_boulder_05', size: 0.65, tint: 0x3a3634, lava: 1.2 }, // + smoke in the game
  obsidian: { built: 'crystals', size: 0.6, glow: 0.9 },
  mossRocks: { polyhaven: 'rock_moss_set_01', largest: 2, size: 0.9, waterline: 0.05 },
  reeds: { built: 'reeds', size: 0.7, waterline: 0.03 },
  sunkenChest: { polyhaven: 'treasure_chest', size: 0.55, waterline: 0.12 },
  gothicStatue: { polyhaven: 'gothic_statue', height: 1.0, tint: 0xb8b4c0 },
  lantern: { polyhaven: 'wooden_lantern_01', height: 0.55, light: 0xffa646, lightOn: 'glass', glow: 1.0 },
  glowMushrooms: { built: 'mushrooms', size: 0.55, glow: 1.2 },
  mossStump: { polyhaven: 'tree_stump_01', size: 0.65 },
  fern: { polyhaven: 'fern_02', size: 0.8 },
  deadTrunk: { polyhaven: 'dead_tree_trunk', size: 0.95 },
  iceBlock: { built: 'iceBlock', size: 0.6 },
  snowyFir: { built: 'fir', height: 1.15, snow: 0.05 },
  frostRock: { polyhaven: 'boulder_01', size: 0.7, snow: 1 },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ENCLOSURE_DECOR);
for (const id of wanted) if (!LOOKS[id]) throw new Error(`Unknown decoration ${id}`);

// download the Poly Haven models that are missing (glTF 1k: the .gltf, its .bin and textures)
async function download(model) {
  const dir = path.join(MODELS, model);
  if (existsSync(path.join(dir, `${model}.gltf`))) return;
  console.log(`Downloading ${model} from Poly Haven...`);
  const files = await (await fetch(`https://api.polyhaven.com/files/${model}`)).json();
  const g = files.gltf['1k'].gltf;
  const get = async (url, to) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  };
  for (const [rel, f] of Object.entries(g.include ?? {})) await get(f.url, path.join(dir, rel));
  await get(g.url, path.join(dir, `${model}.gltf`));
}
for (const id of wanted) if (LOOKS[id].polyhaven) await download(LOOKS[id].polyhaven);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('Page error:', e.message));
await page.route('http://render.local/**', (route) => {
  const url = decodeURIComponent(new URL(route.request().url()).pathname);
  let file = null;
  if (url === '/decor.html') file = path.join(ROOT, 'scripts/render-model/decor.html');
  else if (url.startsWith('/three/')) file = path.join(ROOT, 'node_modules', url);
  else if (url.startsWith('/models/')) file = path.join(MODELS, url.slice('/models/'.length));
  if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
  const type = url.endsWith('.js') ? 'text/javascript' : url.endsWith('.html') ? 'text/html'
    : url.endsWith('.gltf') ? 'model/gltf+json' : url.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
  return route.fulfill({ body: readFileSync(file), contentType: type });
});
await page.goto('http://render.local/decor.html');
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });

mkdirSync(OUT, { recursive: true });
for (const id of wanted) {
  const look = LOOKS[id];
  const opts = { ...look, model: look.polyhaven ? `/models/${look.polyhaven}/${look.polyhaven}.gltf` : undefined };
  for (const [v, turn] of VARIANTS.entries()) {
    const url = await page.evaluate(([o, t]) => window.renderDecor(o, t), [opts, turn]);
    writeFileSync(path.join(OUT, `decor-${id}-${v}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`${id} done`);
}
await browser.close();
