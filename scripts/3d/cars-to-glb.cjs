// Converts the cars of models/cars/*.fbx (Quaternius "Cars Pack", CC0) into src/assets/3d/cars.glb.json: one
// root node per car (NormalCar1, NormalCar2, SUV, Taxi, SportsCar, SportsCar2, Cop), in metres, Y up, front
// toward +Z, resting on y = 0; its parts "Body", "FrontLeftWheel", "FrontRightWheel", "BackWheels" (the wheels
// pivot on their axle: they turn around their X axis).
// Usage (with the dev server running, `npx vite --port 5180`):
//   node scripts/3d/cars-to-glb.cjs && npx @gltf-transform/cli optimize /tmp/cars.glb src/assets/3d/cars.glb \
//     --compress quantize --texture-compress false --simplify false --join false --flatten false --instance false --palette false \
//     && node scripts/3d/glb-to-json.mjs src/assets/3d/cars.glb
// Needs Playwright with Chromium (npm install --no-save playwright, npx playwright install chromium).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'models/cars');
const names = ['NormalCar1', 'NormalCar2', 'SUV', 'Taxi', 'SportsCar', 'SportsCar2', 'Cop'];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await b.newPage();
  page.on('console', (m) => console.log(m.text()));
  await page.route('**/car/*', (r) => r.fulfill({ body: fs.readFileSync(path.join(DIR, r.request().url().split('/car/')[1])), contentType: 'application/octet-stream' }));
  await page.goto('http://localhost:5180/index.html?x');
  await page.setContent(`<html><body><script type="importmap">{"imports":{"three":"http://localhost:5180/node_modules/three/build/three.module.js","three/addons/":"http://localhost:5180/node_modules/three/examples/jsm/"}}</script>
  <script type="module">
  import * as THREE from 'three'; import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'; import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
  const L = new FBXLoader();
  const scenes = [];
  for (const n of ${JSON.stringify(names)}) {
    const fbx = await L.loadAsync('car/' + n + '.fbx');
    // centimetres, Z up, front toward +Y  ->  metres, Y up, front toward +Z: bake it into the geometry
    const fix = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01));
    fbx.updateMatrixWorld(true);
    const scene = new THREE.Scene();
    scene.name = n;
    const meshes = [];
    fbx.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, m.matrixWorld));
      const mesh = new THREE.Mesh(g, [].concat(m.material).map((x) => new THREE.MeshStandardMaterial({ name: x.name, color: x.color, roughness: /Window/.test(x.name) ? 0.15 : 0.55, metalness: /Window/.test(x.name) ? 0.3 : 0.1, emissive: /Lights/.test(x.name) ? x.color : 0x000000, emissiveIntensity: /Lights/.test(x.name) ? 0.6 : 0 })));
      if (!Array.isArray(m.material)) mesh.material = mesh.material[0];
      const isWheel = /Wheel/.test(m.name);
      mesh.name = isWheel ? m.name.replace(n + '_', '') : 'Body';
      if (isWheel) {
        // pivot on the axle: the wheel turns around its own X axis
        g.computeBoundingBox();
        const c = g.boundingBox.getCenter(new THREE.Vector3());
        g.translate(-c.x, -c.y, -c.z);
        mesh.position.copy(c);
      }
      scene.add(mesh);
    }
    // resting on the ground, centred
    const box = new THREE.Box3().setFromObject(scene);
    const off = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    for (const c of scene.children) c.position.add(off);
    const s = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    console.log(n, 'size m', s.toArray().map((v) => v.toFixed(2)).join(' x '), scene.children.map((c) => c.name + '@' + c.position.toArray().map((v) => v.toFixed(2)).join(',')).join(' '));
    scenes.push(scene);
  }
  const glb = await new GLTFExporter().parseAsync(scenes, { binary: true });
  const bytes = new Uint8Array(glb); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  window.out = btoa(bin);
  </script></body></html>`);
  await page.waitForFunction(() => window.out, null, { timeout: 120000 });
  fs.writeFileSync('/tmp/cars.glb', Buffer.from(await page.evaluate(() => window.out), 'base64'));
  await b.close();
})();
