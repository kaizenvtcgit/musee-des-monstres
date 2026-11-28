// Scenery of the 3D park, made of repeated models drawn with instancing (one draw per part of a model,
// whatever the number of copies): the decorations and shelters of the enclosures
// (src/assets/3d/decor.glb.json, made by scripts/render-model/decor.html), and the props from Poly Haven
// (src/assets/3d/props.glb.json, CC0): entrance gate, trees, benches, street lamps, bins, potted plants...
import * as THREE from 'three';

// ---------------------------------------------------------------- instancing

const _m = new THREE.Matrix4();

// One InstancedMesh per mesh of `template`, a copy for each matrix of `matrices` (the matrix places the
// template's base, i.e. what `base` is: by default the template's parent, so its own transform is kept).
// `ids` (optional): for each copy, the id given back by a click on it (userData.instanceIds).
export function instanceGroup(template, matrices, { base = template.parent, ids = null, shadow = true } = {}) {
  const group = new THREE.Group();
  if (!matrices.length) return group;
  template.updateWorldMatrix(true, true);
  const inv = base ? new THREE.Matrix4().copy(base.matrixWorld).invert() : new THREE.Matrix4();
  template.traverse((o) => {
    if (!o.isMesh || o.userData.noInstance) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    matrices.forEach((mx, i) => im.setMatrixAt(i, _m.multiplyMatrices(mx, rel)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = shadow && o.castShadow !== false && !o.userData.mouth;
    im.receiveShadow = true;
    im.renderOrder = o.renderOrder;
    if (ids) im.userData.instanceIds = ids;
    group.add(im);
  });
  return group;
}

// Copies split by area (`cell` metres), so the ones out of view are not drawn (forest, many decorations).
export function chunkedInstances(template, items, cell, opts = {}) {
  const chunks = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / cell)},${Math.floor(it.z / cell)}`;
    (chunks.get(k) ?? chunks.set(k, []).get(k)).push(it.matrix);
  }
  const group = new THREE.Group();
  for (const mats of chunks.values()) group.add(instanceGroup(template, mats, opts));
  return group;
}

// A placement matrix: at (x, y, z), turned by `rot` around the vertical, scaled by `s` (number or vector).
export function place(x, y, z, rot = 0, s = 1) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, sc);
}

// ---------------------------------------------------------------- material tweaks (same as the 2D renders)

// The world position of a vertex, instancing included (for shader tweaks).
const WORLD_POS = `
  vec4 sceneryWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sceneryWorld = instanceMatrix * sceneryWorld;
  #endif
  sceneryWorld = modelMatrix * sceneryWorld;`;

// Glowing lava in the dark creases of a rock texture, and a little at its foot (`foot`: metres).
export function lavaGlow(mat, strength, foot = 0.09) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.lavaStrength = { value: strength };
    sh.uniforms.lavaFoot = { value: foot };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace('#include <project_vertex>', `#include <project_vertex>${WORLD_POS}\nvHeight = sceneryWorld.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lavaStrength;\nuniform float lavaFoot;\nvarying float vHeight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_MAP
          float lum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float crease = smoothstep(0.16, 0.04, lum); // only the darkest cracks
        #else
          float crease = 0.0;
        #endif
        float foot = clamp(1.0 - vHeight / lavaFoot, 0.0, 1.0);
        totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * (crease + foot * 0.8) * lavaStrength;`);
  };
  mat.customProgramCacheKey = () => 'scenery-lava';
  mat.needsUpdate = true;
}

// Snow on every surface facing the sky.
export function snowCap(mat, amount) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.snowAmount = { value: amount };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 sceneryN = objectNormal;
        #ifdef USE_INSTANCING
          sceneryN = mat3(instanceMatrix) * sceneryN;
        #endif
        vUp = normalize(mat3(modelMatrix) * sceneryN).y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float snowAmount;\nvarying float vUp;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float snow = smoothstep(0.55 - snowAmount * 0.35, 0.8 - snowAmount * 0.3, vUp);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), snow);`);
  };
  mat.customProgramCacheKey = () => 'scenery-snow';
  mat.needsUpdate = true;
}

// the nearest `key` in the extras (userData) of `o` or its parents, up to `root`
function tag(o, key, root) {
  for (let p = o; p; p = p.parent) {
    if (p.userData[key] !== undefined) return p.userData[key];
    if (p === root) break;
  }
  return undefined;
}

// ---------------------------------------------------------------- enclosure decorations and shelters

// The decorations file once loaded: its nodes (one per decoration or shelter, in tile units, resting on
// y = 0, front toward +z) with their shader tweaks set up: lava, snow, brighter glowing parts (there is no
// glow halo in 3D), and the mouth of the shelters put on the face of the rock.
export function prepareDecor(scene) {
  const root = scene.children.length === 1 && !scene.children[0].isMesh ? scene.children[0] : scene;
  const nodes = new Map();
  for (const node of root.children) {
    nodes.set(node.name, node);
    const glow = node.userData.glow ?? 0;
    const mouths = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      if (tag(o, 'mouth', node)) {
        mouths.push(o);
        return;
      }
      const lava = tag(o, 'lava', node), snow = tag(o, 'snow', node);
      if (lava || snow || (glow && tag(o, 'glow', node))) o.material = o.material.clone();
      if (lava) lavaGlow(o.material, lava);
      else if (snow) snowCap(o.material, snow);
      if (glow && tag(o, 'glow', node) && o.material.emissive) {
        o.material.emissiveIntensity = Math.max(1, o.material.emissiveIntensity) * (1 + glow);
        o.castShadow = false;
      }
      // see-through parts (a lantern's glass) never hide what is behind them
      if (o.material.transparent) o.material.depthWrite = false;
    });
    if (mouths.length) putMouths(node, mouths);
  }
  return nodes;
}

// The dark mouth of a cave was drawn over everything in the 2D renders; here it is a plane tested
// against depth like the rest, so it goes on the front face of the rock, a little in front of it.
function putMouths(node, mouths) {
  node.updateWorldMatrix(true, true);
  const rock = [];
  node.traverse((o) => { if (o.isMesh && !mouths.includes(o)) rock.push(o); });
  const ray = new THREE.Raycaster();
  for (const m of mouths) {
    m.material = m.material.clone();
    m.material.depthTest = true;
    m.material.depthWrite = false;
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -4;
    m.renderOrder = 2;
    m.castShadow = false;
    const p = m.getWorldPosition(new THREE.Vector3());
    // from in front, toward the rock, at the height of the middle of the mouth
    ray.set(new THREE.Vector3(p.x, p.y, p.z + 50), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObjects(rock, false)[0];
    if (!hit) continue;
    const want = new THREE.Vector3(p.x, p.y, hit.point.z + 0.015);
    m.position.copy(m.parent.worldToLocal(want));
  }
}

// ---------------------------------------------------------------- props (Poly Haven)

// The props file once loaded: one template per scene (entranceGate, firTree, parkBench, pineTree,
// planterBox, pottedPlant, shrub, streetLamp, trashCan), each centred on its base, resting on y = 0,
// in metres; plus a few made of them (shrubClump, flowerBox) and the open entrance gate.
export function prepareProps(gltf) {
  const props = new Map();
  for (const sc of gltf.scenes) {
    const g = new THREE.Group();
    g.name = sc.name;
    g.add(sc);
    const box = new THREE.Box3().setFromObject(g);
    sc.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      // cut-out leaves and twigs: shadows with their holes, and a sharp edge
      if (o.material.alphaTest > 0 || o.material.alphaMap) o.material.alphaTest = Math.max(o.material.alphaTest, 0.5);
      if (o.material.transparent) {
        o.material.depthWrite = false; // the glass of a lamp
        o.castShadow = false;
      }
    });
    g.userData.size = box.getSize(new THREE.Vector3());
    props.set(sc.name, g);
    // the young firs and pines, seen from afar, look grey: their needles a little greener
    if (/Tree/.test(sc.name)) {
      g.traverse((o) => {
        if (o.isMesh && /twig/.test(o.material.name)) o.material.color.multiply(new THREE.Color(0.8, 1.05, 0.75));
      });
    }
  }
  // a round bush: sprigs of shrub turned around the same foot
  const shrub = props.get('shrub');
  if (shrub) {
    const clump = new THREE.Group();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      const s = shrub.clone();
      s.rotation.set((rnd() - 0.5) * 0.5, (i / 9) * Math.PI * 2 + rnd(), (rnd() - 0.5) * 0.5);
      s.scale.setScalar(0.8 + rnd() * 0.5);
      s.position.set((rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08);
      clump.add(s);
    }
    props.set('shrubClump', clump);
  }
  // a planter box in flowers
  const box = props.get('planterBox');
  if (box && shrub) {
    const fb = new THREE.Group();
    fb.add(box.clone());
    const { x: w, y: h } = box.userData.size;
    for (let i = 0; i < 6; i++) {
      const s = shrub.clone();
      s.scale.setScalar(0.9 + (i % 3) * 0.15);
      s.rotation.y = i * 2.1;
      s.position.set(-w * 0.36 + (i * w * 0.72) / 5, h * 0.75, (i % 2 ? 0.05 : -0.05));
      fb.add(s);
    }
    props.set('flowerBox', fb);
  }
  for (const name of ['shrubClump', 'flowerBox']) {
    const g = props.get(name);
    if (g) g.userData.size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  }
  // the entrance gate, its two doors swung open inward (toward -z), on their hinges
  const gate = props.get('entranceGate');
  if (gate) {
    gate.updateWorldMatrix(true, true);
    const hingeX = gate.userData.size.x / 2 - 0.06;
    for (const [name, side] of [['large_iron_gate_left_door', -1], ['large_iron_gate_right_door', 1]]) {
      const door = gate.getObjectByName(name);
      if (!door) continue;
      const pivot = new THREE.Group();
      door.parent.add(pivot);
      pivot.position.set(side * hingeX, 0, 0);
      pivot.position.applyMatrix4(new THREE.Matrix4().copy(door.parent.matrixWorld).invert().multiply(gate.matrixWorld));
      pivot.position.y = 0;
      pivot.attach(door);
      pivot.rotation.y = -side * THREE.MathUtils.degToRad(100);
    }
    gate.getObjectByName('large_iron_gate_bolt')?.removeFromParent();
  }
  return props;
}
