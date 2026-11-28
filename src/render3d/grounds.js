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

// ---------------------------------------------------------------- lava in channels

// Where the lava runs (shared by the vertex shader, for the relief, and the fragment shader, for the look).
const LAVA_FN = `
float lavaFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * gNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// x: distance (in noise) to the middle of the nearest channel, y: the pools' noise (a pool above 0.68)
vec2 lavaField(vec2 xz) {
  vec2 p = xz * 0.09;
  p += 1.1 * vec2(lavaFbm(p + 3.1), lavaFbm(p + 7.7));
  float f = lavaFbm(p);
  return vec2(min(abs(f - 0.5), abs(f - 0.36) * 2.2), lavaFbm(xz * 0.05 + 11.0)); // a main river, thinner branches
}
// x: lava (1 in the channels), y: the thin glowing rim around them, z: the hot middle of the channels
vec3 lavaMask(vec2 xz) {
  vec2 f = lavaField(xz);
  float m = max(1.0 - smoothstep(0.03, 0.04, f.x), smoothstep(0.67, 0.69, f.y));
  float rim = max(1.0 - smoothstep(0.04, 0.052, f.x), smoothstep(0.655, 0.67, f.y)) - m;
  float hot = max(1.0 - smoothstep(0.0, 0.03, f.x), smoothstep(0.69, 0.74, f.y));
  return vec3(m, max(rim, 0.0), hot);
}
// the height of the ground (m): the lava at the bottom of its channels, banks sloping up to bumpy rock
float lavaHeight(vec2 xz) {
  vec2 f = lavaField(xz);
  float bank = min(smoothstep(0.034, 0.085, f.x), 1.0 - smoothstep(0.62, 0.68, f.y));
  float rock = -0.04 + 0.2 * lavaFbm(xz * 0.42 + 5.0) + 0.05 * gNoise(xz * 2.3); // about the monsters' feet
  return mix(-0.42, rock, bank);
}
`;

// The lava ground's geometry: each tile cut in small squares (so it can take the relief), and on each corner how
// far it is from the enclosure's edge (`aEdge`, 0 at the walls, 1 from 1 m in: the relief fades out at the walls).
export function lavaGeometry(world, T, tiles, size, y = 0.015) {
  const { grid } = world;
  const N = 10, step = T / N;
  const same = (tx, ty, occ) => grid.inBounds(tx, ty) && grid.getTile(tx, ty).occupant === occ;
  const pos = [], uv = [], edge = [], idx = [];
  for (const { tx, ty } of tiles) {
    const occ = grid.getTile(tx, ty).occupant;
    const open = { l: same(tx - 1, ty, occ), r: same(tx + 1, ty, occ), u: same(tx, ty - 1, occ), d: same(tx, ty + 1, occ) };
    const x0 = (tx - 0.5) * T, z0 = (ty - 0.5) * T, base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const lx = i * step, lz = j * step, x = x0 + lx, z = z0 + lz;
        let dist = 9;
        if (!open.l) dist = Math.min(dist, lx);
        if (!open.r) dist = Math.min(dist, T - lx);
        if (!open.u) dist = Math.min(dist, lz);
        if (!open.d) dist = Math.min(dist, T - lz);
        pos.push(x, y, z);
        uv.push(x / size, -z / size);
        edge.push(Math.min(1, Math.max(0, (dist - 0.15) / 0.9)));
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius += 1;
  return g;
}

// The lava ground: dark volcanic rock (`rock`, `rockN`), the molten lava only in winding channels and a few pools
// (where a wide warped noise crosses its middle value), sunk below the rock, slowly flowing (`time`: the shared
// clock, in seconds), with a glowing rim at the edge of the rock. The material's map / normalMap / emissiveMap are
// the lava's. Its mesh is a lavaGeometry (the relief is made in the vertex shader).
export function lavaChannels(mat, time, rock, rockN) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlowTime = time;
    sh.uniforms.uRockMap = { value: rock };
    sh.uniforms.uRockN = { value: rockN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aEdge;
varying vec2 vGroundXZ;
${NOISE}
${LAVA_FN}`)
      .replace('#include <beginnormal_vertex>', `
  vGroundXZ = (modelMatrix * vec4(position, 1.0)).xz;
  float lavaH = lavaHeight(vGroundXZ) * aEdge;
  float lavaHx = lavaHeight(vGroundXZ + vec2(0.12, 0.0)) * aEdge;
  float lavaHz = lavaHeight(vGroundXZ + vec2(0.0, 0.12)) * aEdge;
  vec3 objectNormal = normalize(vec3(-(lavaHx - lavaH) / 0.12, 1.0, -(lavaHz - lavaH) / 0.12));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += lavaH;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vGroundXZ;
uniform float uFlowTime;
uniform sampler2D uRockMap;
uniform sampler2D uRockN;
${NOISE}
${LAVA_FN}
vec2 flowUv(vec2 uv) {
  float t = uFlowTime;
  return uv + vec2(t * 0.018, t * 0.011)
    + 0.035 * vec2(sin(uv.y * 5.3 + t * 0.55), cos(uv.x * 4.7 + t * 0.47))
    + 0.012 * vec2(sin(uv.y * 13.0 - t * 0.9), sin(uv.x * 11.0 + t * 0.8));
}
vec3 lavaMk;`)
      .replace('#include <map_fragment>', `
  lavaMk = lavaMask(vGroundXZ);
  vec4 lavaC = texture2D(map, flowUv(vMapUv));
  vec2 rockUv = G_ROT * vMapUv * 1.4;
  vec4 rockC = mix(texture2D(uRockMap, rockUv), texture2D(uRockMap, gUv(rockUv)), gMix(vGroundXZ));
  rockC.rgb *= vec3(0.42, 0.38, 0.37) * gShade(vGroundXZ) * (1.0 - 0.5 * lavaMk.y); // scorched near the lava
  diffuseColor *= mix(rockC, lavaC, lavaMk.x);`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = mix(0.92, roughness * texture2D(roughnessMap, vRoughnessMapUv).g, lavaMk.x);`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
  vec3 lavaN = texture2D( normalMap, flowUv( vNormalMapUv ) ).xyz * 2.0 - 1.0;
  vec3 rockNr = texture2D( uRockN, G_ROT * vNormalMapUv * 1.4 ).xyz * 2.0 - 1.0;
  rockNr.xy = G_UNROT * rockNr.xy;
  vec3 mapN = normalize( mix( rockNr, lavaN, lavaMk.x ) );`)
      .replace('#include <emissivemap_fragment>', `
  vec3 lavaE = texture2D( emissiveMap, flowUv( vEmissiveMapUv ) ).rgb;
  totalEmissiveRadiance *= (lavaE + vec3(1.0, 0.32, 0.05) * 0.22 * lavaMk.z) * lavaMk.x + vec3(1.0, 0.3, 0.05) * lavaMk.y * 0.06;`);
  };
  mat.customProgramCacheKey = () => 'ground-lava-channels';
  mat.needsUpdate = true;
  return mat;
}
