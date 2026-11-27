// Renders the enclosure decorations (scripts/render-model/decor.html) into one image, src/assets/decor/decor-atlas.webp:
// VARIANTS images per decoration, turned differently, so that several copies do not look identical.
//
// Usage: node scripts/render-model/render-decor.mjs
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
// shelters: frame of 2 x 2 tiles (keep in sync with SHELTER_IMG in GameScene.js)
const SHELTER_FRAME = [288, 320, 230];
const SHELTER_LOOKS = {
  // a photo-scanned rock stretched into a cave (dome: [width, height] in tiles), its mouth and some boulders
  lava: { polyhaven: 'boulder_01', dome: [1.75, 0.95], tint: 0x3a3634, lava: 0.45, mouth: [0.6, 0.55, 'rgba(255,120,30,0.95)'], extra: 'lavaRing' },
  water: { polyhaven: 'namaqualand_boulder_05', dome: [1.75, 1.0], tint: 0x8c8c88, mouth: [0.64, 0.6, 'rgba(10,50,60,0.95)'], extra: 'seaRing', waterline: 0.12 },
  dark: { built: 'mausoleum', size: 1.75 },
  forest: { polyhaven: 'rock_moss_set_02', largest: 1, dome: [1.75, 0.9], tint: 0xa8b894, mouth: [0.56, 0.5, 'rgba(40,30,15,0.95)'], extra: 'mossRing' },
  ice: { polyhaven: 'namaqualand_boulder_04', dome: [1.75, 0.95], tint: 0xc8d8e8, snow: 1, mouth: [0.62, 0.56, 'rgba(30,70,110,0.95)'], extra: 'iceRing' },
};
const ATLAS_COLS = 10; // keep in sync with DECOR_ATLAS_COLS in GameScene.js

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
  charredStump: { polyhaven: 'tree_stump_01', size: 0.6, tint: 0x3c3532 },
  smokingRock: { polyhaven: 'namaqualand_boulder_06', size: 0.65, tint: 0x6a6662 },
  emberPile: { polyhaven: 'namaqualand_boulders_01', size: 0.55, tint: 0x3a3634, lava: 1.8 },
  basaltColumns: { built: 'basaltColumns', size: 0.62 },
  ochreRock: { polyhaven: 'rock_07', size: 0.7, tint: 0xc8925e },
  stoneStack: { polyhaven: 'namaqualand_boulders_01', size: 0.8, tint: 0xb07a52 },
  coral: { built: 'coral', size: 0.6, waterline: 0.12 },
  giantShell: { polyhaven: 'lambis_shell', size: 0.55, waterline: 0.03 },
  anemones: { built: 'anemones', size: 0.55, waterline: 0.1, glow: 0.3 },
  jellyfish: { built: 'jellyfish', size: 0.5, waterline: 0.45, glow: 1.0 },
  whaleStatue: { polyhaven: 'bronze_whale_statue', size: 0.85, waterline: 0.12 },
  vents: { built: 'vent', size: 0.5, waterline: 0.18, glow: 0.9 },
  rottenTrunk: { polyhaven: 'dead_tree_trunk_02', size: 0.95, tint: 0x8a9070, waterline: 0.04 },
  roots: { polyhaven: 'root_cluster_01', size: 0.8, tint: 0x9a9480, waterline: 0.03 },
  wisps: { built: 'wisps', size: 0.5, glow: 1.2 },
  tombstone: { built: 'tombstone', height: 0.45 },
  stoneCross: { built: 'stoneCross', height: 0.65 },
  deadTree: { polyhaven: 'dead_quiver_trunk', height: 1.15, tint: 0x8c8378 },
  brokenColumn: { built: 'brokenColumn', height: 0.7 },
  horseStatue: { polyhaven: 'horse_statue_01', height: 0.8, tint: 0xb8b2a2 },
  mossBlock: { polyhaven: 'rock_moss_set_02', largest: 1, size: 0.6 },
  amethyst: { built: 'amethyst', size: 0.6, glow: 0.8 },
  aquamarine: { built: 'aquamarine', size: 0.6, glow: 0.8 },
  stalagmites: { built: 'stalagmites', size: 0.6 },
  frozenShrub: { polyhaven: 'shrub_03', largest: 1, size: 0.6, tint: 0xa8b0a0, snow: 0.35 }, // the file holds 4 shrubs
  frozenStump: { polyhaven: 'tree_stump_02', size: 0.6, snow: 0.25 },
  cairn: { built: 'cairn', height: 0.6, snow: 0.3 },
  snowRock: { polyhaven: 'namaqualand_boulder_04', size: 0.75, snow: 1 },
  iceSpikes: { built: 'iceSpikes', size: 0.6 },
  expeditionFlag: { built: 'flag', height: 1.0 },
};

const wanted = Object.keys(ENCLOSURE_DECOR); // all of them: they share one image
// --3d: export them (and the shelters) as one 3D file for the 3D view instead of rendering images
const EXPORT_3D = process.argv.includes('--3d');
for (const id of wanted) if (!LOOKS[id]) throw new Error(`No look for the decoration ${id}`);

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

if (EXPORT_3D) {
  for (const look of Object.values(SHELTER_LOOKS)) if (look.polyhaven) await download(look.polyhaven);
  const model = (look) => (look.polyhaven ? `/models/${look.polyhaven}/${look.polyhaven}.gltf` : undefined);
  const items = [
    ...wanted.map((id) => ({ id, opts: { ...LOOKS[id], model: model(LOOKS[id]) } })),
    ...Object.entries(SHELTER_LOOKS).map(([family, look]) => ({ id: `shelter-${family}`, opts: { ...look, model: model(look) } })),
  ];
  const b64 = await page.evaluate((it) => window.exportDecor(it), items);
  const file = path.join(ROOT, 'models/decor-3d.glb');
  writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`${file}: ${(b64.length * 0.75 / 1024 / 1024).toFixed(1)} MB (then: README, "Visite 3D")`);
  await browser.close();
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
// one image for all: decoration i, variant v is cell i * VARIANTS + v (the order of ENCLOSURE_DECOR), ATLAS_COLS per row
const cells = [];
for (const id of Object.keys(ENCLOSURE_DECOR)) {
  const look = LOOKS[id];
  const opts = { ...look, model: look.polyhaven ? `/models/${look.polyhaven}/${look.polyhaven}.gltf` : undefined };
  for (const turn of VARIANTS) cells.push(await page.evaluate(([o, t]) => window.renderDecor(o, t), [opts, turn]));
  console.log(`${id} done`);
}
writeFileSync(path.join(OUT, 'decor-atlas.webp'), Buffer.from((await page.evaluate(([u, c]) => window.packAtlas(u, c), [cells, ATLAS_COLS])).split(',')[1], 'base64'));

// Shelters (one per monster family): 2 x 2 tiles, opening toward the viewer; src/assets/decor/shelter-<family>.png
for (const [family, look] of Object.entries(SHELTER_LOOKS)) {
  if (look.polyhaven) await download(look.polyhaven);
  const model = look.polyhaven ? `/models/${look.polyhaven}/${look.polyhaven}.gltf` : undefined;
  const url = await page.evaluate(([o]) => window.renderDecor(o, 0), [{ ...look, model, frame: SHELTER_FRAME }]);
  writeFileSync(path.join(OUT, `shelter-${family}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`shelter ${family} done`);
}
await browser.close();
