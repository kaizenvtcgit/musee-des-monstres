// Renders the lawn, the paths and the ground of the enclosure habitats (scripts/render-model/ground.html) into
// src/assets/tiles/tile-<habitat>-sheet.webp (4 x 4 tiles that fit together, in one image: row = y) and
// src/assets/tiles/tile-<habitat>.png (one tile, used for the toolbar icons and as a fallback).
//
// Usage: node scripts/render-model/render-ground.mjs [habitat...]
// Needs the same setup as render.mjs (npm install, then Playwright with Chromium).
// Photo textures come from ambientCG (CC0, https://ambientcg.com): they are downloaded once
// into models/textures/ (not stored in the repository).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEX = path.join(ROOT, 'models/textures');

// repeat: copies of the texture over a block of tiles (bigger = smaller details); block: tiles per side
// of the block (4 by default; 8 everywhere now, so the grounds repeat less);
// macro: big soft light / dark patches baked over the block; relief: height of the real bumps
// (from the texture's height map, in tiles), which cast shadows (see ground.html).
const HABITATS = {
  // the park itself: lawn and visitor paths
  grass: { id: 'Grass004', block: 8, repeat: 4, tint: 0xdcf0cc, normalScale: 1.2, macro: { amount: 0.2, warm: 0.14, seed: 7 } },
  path: { id: 'PavingStones070', block: 8, repeat: 8, tint: 0xe2dcd0, normalScale: 1.6, macro: { amount: 0.1, warm: 0.15, seed: 23 } },
  lava: { block: 8, relief: 0.12, id: 'Lava003', repeat: 2, emissive: 0xff5a10, emissiveIntensity: 1.8, normalScale: 1.6, tint: 0xb0a8a4, macro: { amount: 0.14, warm: 0, seed: 18 } },
  water: { block: 8, water: true },
  dark: { block: 8, relief: 0.06, id: 'Tiles093', repeat: 4, tint: 0xb6aec4, normalScale: 1.6, macro: { amount: 0.14, warm: 0.1, seed: 25 } },
  forest: { block: 8, relief: 0.2, id: 'Ground068', repeat: 4, tint: 0xd0d8c4, normalScale: 1.4, macro: { amount: 0.14, warm: 0.1, seed: 28 } },
  ice: { block: 8, relief: 0.08, id: 'Snow013', repeat: 2, tint: 0xe4eefa, normalScale: 1.6, envMapIntensity: 0.5, macro: { amount: 0.07, warm: 0, seed: 45 } },
  // the second and third habitat of each monster
  ash: { block: 8, relief: 0.1, id: 'Ground110', repeat: 4, tint: 0x8c8884, normalScale: 1.5, macro: { amount: 0.14, warm: 0.1, seed: 25 } },
  basalt: { block: 8, relief: 0.12, id: 'Ground111', repeat: 2, tint: 0xd8b48c, normalScale: 1.4, macro: { amount: 0.14, warm: 0.1, seed: 28 } },
  reef: { block: 8, water: { deep: [22, 104, 112], light: [62, 150, 148], waves: 5 } },
  abyss: { block: 8, water: { deep: [4, 12, 28], light: [12, 30, 52], waves: 4, sky: 0.3 } },
  swamp: { block: 8, water: { deep: [34, 42, 26], light: [70, 78, 46], waves: 3, sky: 0.5 } },
  graveyard: { block: 8, relief: 0.08, id: 'Ground071', repeat: 4, tint: 0x9e9a8a, normalScale: 1.4, macro: { amount: 0.14, warm: 0.1, seed: 31 } },
  ruins: { block: 8, relief: 0.07, id: 'PavingStones138', repeat: 4, tint: 0xc8c4b4, normalScale: 1.5, macro: { amount: 0.14, warm: 0.1, seed: 33 } },
  crystal: { block: 8, relief: 0.12, id: 'Rock012', repeat: 4, tint: 0x9088a8, normalScale: 1.6, macro: { amount: 0.14, warm: 0, seed: 27 } },
  tundra: { block: 8, relief: 0.06, id: 'Snow015', repeat: 4, normalScale: 1.4, macro: { amount: 0.07, warm: 0, seed: 10 } },
  summit: { block: 8, relief: 0.12, id: 'Snow008A', repeat: 2, tint: 0xd9e2ee, normalScale: 2.4, envMapIntensity: 0.3, macro: { amount: 0.07, warm: 0, seed: 49 } },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HABITATS);

// download the ambientCG textures that are missing
for (const h of wanted) {
  const { id } = HABITATS[h] ?? {};
  if (!id || existsSync(path.join(TEX, id, `${id}_1K-JPG_Color.jpg`))) continue;
  console.log(`Downloading ${id} from ambientCG...`);
  mkdirSync(path.join(TEX, id), { recursive: true });
  const res = await fetch(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`);
  if (!res.ok) throw new Error(`Download of ${id} failed (${res.status})`);
  const zip = path.join(TEX, id, `${id}.zip`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  try { execFileSync('tar', ['-xf', zip, '-C', path.join(TEX, id)]); } // Windows, macOS
  catch { execFileSync('unzip', ['-o', '-q', zip, '-d', path.join(TEX, id)]); } // Linux
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('Page error:', e.message));
await page.route('http://render.local/**', (route) => {
  const url = decodeURIComponent(new URL(route.request().url()).pathname);
  let file = null;
  if (url === '/ground.html') file = path.join(ROOT, 'scripts/render-model/ground.html');
  else if (url.startsWith('/three/')) file = path.join(ROOT, 'node_modules', url);
  else if (url.startsWith('/tex/')) file = path.join(TEX, url.slice(5));
  if (!file || !existsSync(file)) return route.fulfill({ status: 404 });
  const type = url.endsWith('.js') ? 'text/javascript' : url.endsWith('.html') ? 'text/html' : 'image/jpeg';
  return route.fulfill({ body: readFileSync(file), contentType: type });
});
await page.goto('http://render.local/ground.html');
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });

const save = (file, dataUrl) => writeFileSync(path.join(ROOT, 'src/assets/tiles', file), Buffer.from(dataUrl.split(',')[1], 'base64'));
for (const h of wanted) {
  save(`tile-${h}-sheet.webp`, await page.evaluate((o) => window.renderGround({ ...o, sheet: true }), HABITATS[h]));
  const [[still]] = await page.evaluate((o) => window.renderGround({ ...o, format: 'image/png' }), HABITATS[h]);
  save(`tile-${h}.png`, still);
  console.log(`${h} done`);
}
await browser.close();
