// The grounds of the 3D park, made more natural:
// - antiTile(material): the texture never shows its repeat: it is blended with a turned, larger copy of itself
//   following a wide noise, and its colour shifts gently from place to place (normals blended the same way);
// - pathFringe(): the paths fade into the lawn over a few tens of centimetres instead of a hard cut;
// - wallShade(): a soft contact shadow on the ground at the foot of the enclosure walls;
// - groundDetails(): small things on the enclosure grounds, by habitat (tufts of grass, pebbles, embers,
//   patches of snow), drawn with instancing.
import * as THREE from 'three';
import { tilesOf, containsTile } from '../sim/enclosure.js';

const NOISE = `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// where the second copy of the texture shows (0..1), and the gentle colour shift (about 0.86..1.14)
float gMix(vec2 xz) { return smoothstep(0.32, 0.68, gNoise(xz * 0.085)); }
float gShade(vec2 xz) { return 0.86 + 0.28 * (gNoise(xz * 0.023) * 0.6 + gNoise(xz * 0.071) * 0.4); }
const mat2 G_ROT = mat2(0.866, -0.5, 0.5, 0.866);
const mat2 G_UNROT = mat2(0.866, 0.5, -0.5, 0.866);
vec2 gUv(vec2 uv) { return G_ROT * uv * 0.61 + vec2(0.37, 0.71); }
`;

// `minRough`: the least roughness kept from the roughness map (a lawn seen from afar must not shine).
export function antiTile(mat, minRough = 0) {
  const rough = minRough.toFixed(2);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vGroundXZ;\n${NOISE}`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  float gm = gMix(vGroundXZ);
  vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map, gUv(vMapUv)), gm);
  sampledDiffuseColor.rgb *= gShade(vGroundXZ);
  diffuseColor *= sampledDiffuseColor;
#endif`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= max(texture2D(roughnessMap, vRoughnessMapUv).g, ${rough});
#endif`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
  vec3 gnA = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec3 gnB = texture2D( normalMap, gUv( vNormalMapUv ) ).xyz * 2.0 - 1.0;
  gnB.xy = G_UNROT * gnB.xy;
  vec3 mapN = normalize( mix( gnA, gnB, gMix( vGroundXZ ) ) );`);
  };
  mat.customProgramCacheKey = () => `ground-antitile-${rough}`;
  mat.needsUpdate = true;
  return mat;
}

// A flat strip (x0, z0) -> (x1, z1) along one edge, `w` wide toward (nx, nz), opaque at the edge, fading out.
function strip(pos, uv, col, idx, ax, az, bx, bz, nx, nz, w, y, size, alpha) {
  const i = pos.length / 3;
  const pts = [[ax, az, alpha], [bx, bz, alpha], [bx + nx * w, bz + nz * w, 0], [ax + nx * w, az + nz * w, 0]];
  for (const [x, z, a] of pts) {
    pos.push(x, y, z);
    uv.push(x / size, -z / size);
    col.push(1, 1, 1, a);
  }
  idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
}

function stripsGeometry(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The edges of the paths that touch the lawn, fading into it (the path material, see-through at the end).
export function pathFringe(world, T, pathMat, size) {
  const { grid } = world;
  const isLawn = (x, y) => !grid.inBounds(x, y) || (!grid.getTile(x, y).occupant && grid.getTile(x, y).ground !== 'path');
  const pos = [], uv = [], col = [], idx = [];
  const W = 0.32;
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) {
      const t = grid.getTile(tx, ty);
      if (t.ground !== 'path' || t.occupant) continue;
      const x0 = (tx - 0.5) * T, x1 = (tx + 0.5) * T, z0 = (ty - 0.5) * T, z1 = (ty + 0.5) * T;
      if (isLawn(tx, ty - 1)) strip(pos, uv, col, idx, x0, z0, x1, z0, 0, -1, W, 0.012, size, 1);
      if (isLawn(tx, ty + 1)) strip(pos, uv, col, idx, x1, z1, x0, z1, 0, 1, W, 0.012, size, 1);
      if (isLawn(tx - 1, ty)) strip(pos, uv, col, idx, x0, z1, x0, z0, -1, 0, W, 0.012, size, 1);
      if (isLawn(tx + 1, ty)) strip(pos, uv, col, idx, x1, z0, x1, z1, 1, 0, W, 0.012, size, 1);
    }
  }
  if (!pos.length) return null;
  const mat = pathMat.clone();
  mat.vertexColors = true;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.onBeforeCompile = pathMat.onBeforeCompile;
  mat.customProgramCacheKey = pathMat.customProgramCacheKey;
  const mesh = new THREE.Mesh(stripsGeometry(pos, uv, col, idx), mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.ownMaterial = true;
  return mesh;
}

// A soft dark band on the ground inside each (dry) enclosure, along its walls: the shade at their foot.
export function wallShade(world, T, isWet) {
  const { builder } = world;
  const pos = [], uv = [], col = [], idx = [];
  const W = 0.55;
  for (const e of builder.enclosures.values()) {
    if (isWet(e)) continue;
    for (const { tx, ty } of tilesOf(e)) {
      const x0 = (tx - 0.5) * T, x1 = (tx + 0.5) * T, z0 = (ty - 0.5) * T, z1 = (ty + 0.5) * T;
      if (!containsTile(e, tx, ty - 1)) strip(pos, uv, col, idx, x0, z0, x1, z0, 0, 1, W, 0.03, 1, 0.38);
      if (!containsTile(e, tx, ty + 1)) strip(pos, uv, col, idx, x1, z1, x0, z1, 0, -1, W, 0.03, 1, 0.38);
      if (!containsTile(e, tx - 1, ty)) strip(pos, uv, col, idx, x0, z1, x0, z0, 1, 0, W, 0.03, 1, 0.38);
      if (!containsTile(e, tx + 1, ty)) strip(pos, uv, col, idx, x1, z0, x1, z1, -1, 0, W, 0.03, 1, 0.38);
    }
  }
  if (!pos.length) return null;
  const mesh = new THREE.Mesh(stripsGeometry(pos, uv, col, idx), new THREE.MeshBasicMaterial({
    color: 0x1a1612, vertexColors: true, transparent: true, depthWrite: false,
  }));
  mesh.renderOrder = 1;
  mesh.userData.ownMaterial = true;
  return mesh;
}

// ---------------------------------------------------------------- small things on the grounds

function tuftTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const x = 16 + rnd() * 96, h = 50 + rnd() * 70, lean = (rnd() - 0.5) * 40;
    const shade = 70 + rnd() * 70;
    g.strokeStyle = `rgb(${shade * 0.55}, ${shade}, ${shade * 0.35})`;
    g.lineWidth = 2 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

// two crossed vertical planes, 1 m wide and tall, standing on y = 0
function tuftGeometry() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const merge = (k) => new THREE.Float32BufferAttribute([...a.attributes[k].array, ...b.attributes[k].array], a.attributes[k].itemSize);
  g.setAttribute('position', merge('position'));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(a.attributes.position.count * 2).fill(0).flatMap(() => [0, 1, 0]), 3));
  g.setAttribute('uv', merge('uv'));
  g.setIndex([...a.index.array, ...b.index.array.map((i) => i + a.attributes.position.count)]);
  return g;
}

// What grows or lies on each habitat: [kind, how many per tile (average)].
const DETAILS = {
  forest: [['tuft', 3.2], ['pebble', 0.6]],
  graveyard: [['tuft', 1.8], ['pebble', 0.8]],
  dark: [['pebble', 1.2]],
  basalt: [['pebble', 2.2]],
  ruins: [['pebble', 1.6], ['tuft', 0.8]],
  crystal: [['pebble', 1.6]],
  ash: [['ember', 0.9], ['pebble', 1.0]],
  tundra: [['snow', 0.5], ['pebble', 0.7], ['tuft', 0.3]],
  summit: [['snow', 0.4], ['pebble', 1.4]],
};

// The small things of all the enclosures (rebuilt with the park): a Group of InstancedMeshes.
export function groundDetails(world, T) {
  const { builder } = world;
  const lists = { tuft: [], pebble: [], ember: [], snow: [] };
  for (const e of builder.enclosures.values()) {
    const kinds = DETAILS[e.habitat];
    if (!kinds) continue;
    const busy = new Set((e.decor ?? []).map((d) => `${d.tx},${d.ty}`));
    const sh = e.shelter;
    for (const { tx, ty } of tilesOf(e)) {
      if (busy.has(`${tx},${ty}`)) continue;
      if (sh && tx >= sh.tx && tx < sh.tx + (sh.size || 2) && ty >= sh.ty && ty < sh.ty + (sh.size || 2)) continue;
      // the same things on the same tile every time (seeded by the tile)
      let seed = (tx * 73856093) ^ (ty * 19349663) ^ 0x5bd1e995;
      const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
      for (const [kind, avg] of kinds) {
        const n = Math.floor(avg + rnd());
        for (let k = 0; k < n; k++) {
          lists[kind].push({ x: (tx - 0.42 + rnd() * 0.84) * T, z: (ty - 0.42 + rnd() * 0.84) * T, r: rnd() * 6.28, s: rnd() });
        }
      }
    }
  }
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const add = (list, geo, mat, scale, y = 0, shadow = true) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.r);
      const s = scale(it.s);
      im.setMatrixAt(i, m4.compose(p.set(it.x, y, it.z), q, sc.set(s[0], s[1], s[2])));
    });
    im.computeBoundingSphere();
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.userData.ownMaterial = true;
    group.add(im);
  };
  const tuftMap = lists.tuft.length ? tuftTexture() : null;
  add(lists.tuft, tuftGeometry(), new THREE.MeshStandardMaterial({ map: tuftMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
    (s) => { const k = 0.35 + s * 0.35; return [k, k, k]; });
  if (tuftMap) group.children[group.children.length - 1].userData.ownMap = tuftMap;
  const pebble = new THREE.IcosahedronGeometry(1, 0);
  add(lists.pebble, pebble, new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95, flatShading: true }),
    (s) => { const k = 0.06 + s * 0.12; return [k * 1.3, k * 0.6, k]; }, 0.01);
  add(lists.ember, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x2a1a12, emissive: 0xff5a10, emissiveIntensity: 0.9, roughness: 0.8, flatShading: true }),
    (s) => { const k = 0.03 + s * 0.04; return [k * 1.2, k * 0.6, k]; }, 0.01, false);
  add(lists.snow, new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.9 }),
    (s) => { const k = 0.18 + s * 0.3; return [k * 1.4, 1, k]; }, 0.025, false);
  return group;
}
