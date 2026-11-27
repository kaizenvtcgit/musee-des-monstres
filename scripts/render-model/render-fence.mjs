// Renders the enclosure barrier (scripts/render-model/fence.html) into
// src/assets/buildings/prop-fenceX.png and prop-fenceY.png.
//
// Usage: node scripts/render-model/render-fence.mjs
// Needs the same setup as render.mjs (npm install, then Playwright with Chromium).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('Page error:', e.message));
await page.route('http://render.local/**', (route) => {
  const url = new URL(route.request().url()).pathname;
  const file = url === '/fence.html'
    ? path.join(ROOT, 'scripts/render-model/fence.html')
    : url.startsWith('/three/') && path.join(ROOT, 'node_modules', url);
  if (!file) return route.fulfill({ status: 404 });
  return route.fulfill({ body: readFileSync(file), contentType: url.endsWith('.html') ? 'text/html' : 'text/javascript' });
});
await page.goto('http://render.local/fence.html');
await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
for (const axis of ['X', 'Y']) {
  const url = await page.evaluate((a) => window.renderFence(a), axis);
  writeFileSync(path.join(ROOT, `src/assets/buildings/prop-fence${axis}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`prop-fence${axis}.png done`);
}
await browser.close();
