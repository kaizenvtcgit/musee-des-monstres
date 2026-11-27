// Renders the ground of the enclosure habitats (scripts/render-model/ground.html) into
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

// repeat: copies of the texture over a block of 4 x 4 tiles (bigger = smaller details).
const HABITATS = {
  lava: { id: 'Lava003', repeat: 1, emissive: 0xff5a10, emissiveIntensity: 1.8, normalScale: 1.6, tint: 0xb0a8a4 },
  water: { water: true },
  dark: { id: 'Tiles093', repeat: 2, tint: 0xb6aec4, normalScale: 1.6 },
  forest: { id: 'Ground037', repeat: 2, tint: 0xc8dcb0, normalScale: 1.4 },
  ice: { id: 'Snow013', repeat: 1, tint: 0xe4eefa, normalScale: 1.6, envMapIntensity: 0.5 },
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
