// Converts the cash machine of the car park, models/parking/ATM.fbx with its textures
// (models/parking/textures/ATM_*.webp: colour, normals, roughness, metal), into /tmp/atm.glb: in metres,
// resting on y = 0, centred, its screen toward +Z. Writes /tmp/atm-preview.png (seen from 4 sides) to check.
// Then: npx @gltf-transform/cli optimize /tmp/atm.glb src/assets/3d/atm.glb --texture-compress webp \
//   --texture-size 512 --compress quantize --simplify false && node scripts/3d/glb-to-json.mjs src/assets/3d/atm.glb
// Needs the dev server (`npx vite --port 5180`) and Playwright with Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '../../models/parking');
// turn (radians, around the vertical) that brings its screen toward +Z (0: it already faces +Z)
const TURN = Number(process.env.TURN ?? 0);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1200, height: 340 } });
  page.on('console', (m) => console.log(m.text()));
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.route('**/files/**', (r) => r.fulfill({ body: fs.readFileSync(path.join(DIR, decodeURIComponent(r.request().url().split('/files/')[1]))) }));
  await page.goto('http://localhost:5180/node_modules/three/package.json');
  await page.setContent(`<html><body style="margin:0;background:#8ab"><script type="importmap">{"imports":{"three":"http://localhost:5180/node_modules/three/build/three.module.js","three/addons/":"http://localhost:5180/node_modules/three/examples/jsm/"}}</script>
  <script type="module">
  import * as THREE from 'three'; import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'; import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
  const fbx = await new FBXLoader().loadAsync('files/ATM.fbx');
  const tl = new THREE.TextureLoader();
  const tex = async (n, srgb) => { const t = await tl.loadAsync('files/textures/ATM_' + n + '.webp'); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const mat = new THREE.MeshStandardMaterial({
    name: 'ATM', map: await tex('basecolor', true), normalMap: await tex('normal'), roughnessMap: await tex('roughness'),
    metalnessMap: await tex('metallic'), metalness: 1, roughness: 1,
  });
  fbx.updateMatrixWorld(true);
  const root = new THREE.Group(); root.name = 'ATM';
  fbx.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(${TURN}).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01)).multiply(o.matrixWorld));
    const m = new THREE.Mesh(g, mat); m.name = 'ATM'; root.add(m);
  });
  const box = new THREE.Box3().setFromObject(root);
  for (const c of root.children) c.geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  console.log('ATM size m', s.toArray().map((v) => v.toFixed(2)).join(' x '));
  // preview: from +Z, +X, -Z, -X
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(1200, 340); r.outputColorSpace = THREE.SRGBColorSpace; r.setScissorTest(true);
  document.body.appendChild(r.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x88aabb); scene.add(root, new THREE.HemisphereLight(0xffffff, 0x445544, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 4, 3); scene.add(d);
  ['+Z', '+X', '-Z', '-X'].forEach((side, i) => {
    const cam = new THREE.PerspectiveCamera(35, 300 / 340, 0.01, 50);
    const dir = { '+Z': [0, 0, 1], '+X': [1, 0, 0], '-Z': [0, 0, -1], '-X': [-1, 0, 0] }[side];
    cam.position.set(dir[0] * 3.2, 1.1, dir[2] * 3.2); cam.lookAt(0, 0.75, 0);
    r.setViewport(i * 300, 0, 300, 340); r.setScissor(i * 300, 0, 300, 340); r.render(scene, cam);
  });
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(glb); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  window.preview = r.domElement.toDataURL('image/png');
  window.out = btoa(bin);
  </script></body></html>`);
  await page.waitForFunction(() => window.out, null, { timeout: 180000 });
  fs.writeFileSync('/tmp/atm.glb', Buffer.from(await page.evaluate(() => window.out), 'base64'));
  fs.writeFileSync('/tmp/atm-preview.png', Buffer.from((await page.evaluate(() => window.preview)).split(',')[1], 'base64'));
  await b.close();
})();
