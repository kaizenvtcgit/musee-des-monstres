// The relief and character of each enclosure ground (the dry ones; the lava has its own, see lavaChannels):
// the ground is cut in small squares (reliefGeometry) that the vertex shader lifts or digs following the
// habitat's height (RELIEF[habitat].height, GLSL), fading out against the walls; the fragment shader mixes
// in a second ground (moss, dead grass, bare earth, rock...), shiny patches (puddles, ice) or glowing veins,
// all drawn from the same noise as the relief, so they follow it.
import * as THREE from 'three';

// value noise in GLSL, and what is built on it (shared by every ground shader)
export const NOISE = `
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
float tFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * gNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// the centre of the hexagon (side about 0.58 units) around p: basalt columns
vec2 tHex(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
  vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
  return p - (dot(a, a) < dot(b, b) ? a : b);
}
`;

// By habitat:
// - mask: GLSL, 0..1, where the second look shows (`second`: a ground texture with its tint, or `slick`: a smooth
//   shiny surface of that colour: puddles, ice; or `crack`: darker, not shiny);
// - height: GLSL, metres (about -0.1..+0.3: the monsters walk at 0), may use tMask(xz);
// - veins: GLSL, 0..1, glowing lines of the colour `glow`.
export const RELIEF = {
  forest: {
    mask: 'return smoothstep(0.5, 0.6, tFbm(xz * 0.17 + 4.0));',
    height: 'return 0.28 * tFbm(xz * 0.22) + 0.06 * gNoise(xz * 1.3) - 0.13 + 0.03 * tMask(xz);',
    second: 'grass', secondTint: 0x8fa868,
  },
  graveyard: {
    mask: 'return smoothstep(0.5, 0.62, tFbm(xz * 0.21 + 8.0));',
    height: 'return 0.14 * tFbm(xz * 0.3) + 0.04 * gNoise(xz * 1.6) - 0.06;',
    second: 'grass', secondTint: 0xa89a6a,
  },
  dark: {
    mask: 'return smoothstep(0.54, 0.58, tFbm(xz * 0.16 + 2.0));',
    height: 'return mix(0.12 * tFbm(xz * 0.33) + 0.03 * gNoise(xz * 2.0) - 0.03, -0.035, tMask(xz));',
    slick: [0.28, 0.26, 0.32],
  },
  ice: {
    mask: 'return 1.0 - smoothstep(0.34, 0.39, tFbm(xz * 0.15 + 6.0));',
    height: 'return mix(0.45 * tFbm(xz * 0.2) - 0.1 + 0.05 * gNoise(xz * 1.1), -0.04, tMask(xz));',
    slick: [0.45, 0.66, 0.86],
  },
  tundra: {
    mask: 'return smoothstep(0.6, 0.67, tFbm(xz * 0.19 + 3.0));',
    height: 'return 0.26 * tFbm(xz * 0.2) - 0.05 - 0.06 * tMask(xz);',
    second: 'forest', secondTint: 0x8c8474,
  },
  summit: {
    mask: 'float r = 1.0 - abs(2.0 * tFbm(xz * 0.16 + 1.0) - 1.0); return smoothstep(0.86, 0.92, r);',
    height: 'float r = 1.0 - abs(2.0 * tFbm(xz * 0.16 + 1.0) - 1.0); return 0.36 * r * r * r + 0.08 * tFbm(xz * 0.5) - 0.08;',
    second: 'basalt', secondTint: 0x7c7c86,
  },
  ash: {
    height: 'float f = tFbm(xz * 0.15); return 0.34 * (0.5 + 0.5 * sin(xz.x * 0.8 + xz.y * 0.35 + 6.0 * f)) * (0.4 + f) - 0.12;',
  },
  basalt: {
    // columns of about 0.9 m, of uneven heights, with dark cracks between them
    mask: 'vec2 p = xz / 0.9; vec2 c = tHex(p); return smoothstep(0.4, 0.47, length(p - c));',
    height: 'vec2 c = tHex(xz / 0.9); return 0.02 + 0.2 * gHash(c * 1.37) * smoothstep(0.3, 0.6, tFbm(c * 0.21)) - 0.05 * tMask(xz);',
    crack: [0.3, 0.27, 0.25],
  },
  ruins: {
    mask: 'return smoothstep(0.53, 0.62, tFbm(xz * 0.24 + 1.0));',
    height: 'return 0.07 * tFbm(xz * 0.5) - 0.03 - 0.04 * smoothstep(0.66, 0.72, tFbm(xz * 0.13 + 5.0)) + 0.03 * tMask(xz);',
    second: 'grass', secondTint: 0xa4bc7c,
  },
  crystal: {
    height: 'return 0.22 * tFbm(xz * 0.28) + 0.05 * gNoise(xz * 1.7) - 0.08;',
    veins: 'float f = tFbm(xz * 0.19 + 9.0); return 1.0 - smoothstep(0.0, 0.006, abs(f - 0.5));',
    glow: 0xa070ff,
  },
};

// How far a point of a tile is from its enclosure's walls, 0 (at the wall) .. 1 (1 m in): the relief fades out.
// (lx, lz): metres from the tile's corner.
export function edgeFactor(world, T, tx, ty, lx, lz) {
  const { grid } = world;
  const occ = grid.getTile(tx, ty).occupant;
  const same = (x, y) => grid.inBounds(x, y) && grid.getTile(x, y).occupant === occ;
  let dist = 9;
  if (!same(tx - 1, ty)) dist = Math.min(dist, lx);
  if (!same(tx + 1, ty)) dist = Math.min(dist, T - lx);
  if (!same(tx, ty - 1)) dist = Math.min(dist, lz);
  if (!same(tx, ty + 1)) dist = Math.min(dist, T - lz);
  return Math.min(1, Math.max(0, (dist - 0.15) / 0.9));
}

// The ground of these tiles cut in small squares (10 per tile, 25 cm), with `aEdge` on each corner.
export function reliefGeometry(world, T, tiles, size, y = 0.015) {
  const N = 10, step = T / N;
  const pos = [], uv = [], edge = [], idx = [];
  for (const { tx, ty } of tiles) {
    const x0 = (tx - 0.5) * T, z0 = (ty - 0.5) * T, base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        pos.push(x, y, z);
        uv.push(x / size, -z / size);
        edge.push(edgeFactor(world, T, tx, ty, i * step, j * step));
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

// the GLSL functions of a habitat: tMask, tHeight, tVeins
function habitatFn(r) {
  return `
float tMask(vec2 xz) { ${r.mask ?? 'return 0.0;'} }
float tHeight(vec2 xz) { ${r.height ?? 'return 0.0;'} }
float tVeins(vec2 xz) { ${r.veins ?? 'return 0.0;'} }
`;
}

const glslColor = (c) => {
  const k = new THREE.Color(c);
  return `vec3(${k.r.toFixed(3)}, ${k.g.toFixed(3)}, ${k.b.toFixed(3)})`;
};

// Makes a ground material (map, normalMap, roughnessMap of the habitat) take the habitat's relief and looks.
// `second`: { map, normal } textures of its second ground, if it has one. `minRough`: see antiTile.
export function terrainMaterial(mat, habitat, second, minRough = 0.45) {
  const r = RELIEF[habitat];
  const rough = minRough.toFixed(2);
  if (r.glow) {
    mat.emissive = new THREE.Color(r.glow);
    mat.emissiveIntensity = 1.5;
  }
  mat.onBeforeCompile = (sh) => {
    if (second) {
      sh.uniforms.uSecond = { value: second.map };
      sh.uniforms.uSecondN = { value: second.normal };
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aEdge;
varying vec2 vGroundXZ;
${NOISE}
${habitatFn(r)}`)
      .replace('#include <beginnormal_vertex>', `
  vGroundXZ = (modelMatrix * vec4(position, 1.0)).xz;
  float tH = tHeight(vGroundXZ) * aEdge;
  float tHx = tHeight(vGroundXZ + vec2(0.1, 0.0)) * aEdge;
  float tHz = tHeight(vGroundXZ + vec2(0.0, 0.1)) * aEdge;
  vec3 objectNormal = normalize(vec3(-(tHx - tH) / 0.1, 1.0, -(tHz - tH) / 0.1));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += tH;');
    const sec = second ? `
  vec2 sUv = G_ROT * vMapUv * 1.15;
  vec4 secC = mix(texture2D(uSecond, sUv), texture2D(uSecond, gUv(sUv)), gm);
  secC.rgb *= ${glslColor(r.secondTint ?? 0xffffff)} / max(diffuse, vec3(0.05));
  sampledDiffuseColor = mix(sampledDiffuseColor, secC, gTm);` : '';
    const dark = r.slick ?? r.crack; // (a crack darkens without shining)
    const slick = dark ? `
  sampledDiffuseColor.rgb *= mix(vec3(1.0), vec3(${dark.map((v) => v.toFixed(3)).join(', ')}), gTm);` : '';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vGroundXZ;
${second ? 'uniform sampler2D uSecond;\nuniform sampler2D uSecondN;' : ''}
${NOISE}
${habitatFn(r)}
float gTm;`)
      .replace('#include <map_fragment>', `
  gTm = tMask(vGroundXZ);
  float gm = gMix(vGroundXZ);
  vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map, gUv(vMapUv)), gm);
  ${sec}
  ${slick}
  sampledDiffuseColor.rgb *= gShade(vGroundXZ);
  diffuseColor *= sampledDiffuseColor;`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness * max(texture2D(roughnessMap, vRoughnessMapUv).g, ${rough});
${r.slick ? 'roughnessFactor = mix(roughnessFactor, 0.07, gTm);' : second ? 'roughnessFactor = mix(roughnessFactor, 0.9, gTm);' : ''}`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
  vec3 gnA = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec3 gnB = texture2D( normalMap, gUv( vNormalMapUv ) ).xyz * 2.0 - 1.0;
  gnB.xy = G_UNROT * gnB.xy;
  vec3 mapN = normalize( mix( gnA, gnB, gMix( vGroundXZ ) ) );
  ${second ? `vec3 gnS = texture2D( uSecondN, G_ROT * vNormalMapUv * 1.15 ).xyz * 2.0 - 1.0;
  gnS.xy = G_UNROT * gnS.xy;
  mapN = normalize( mix( mapN, gnS, gTm ) );` : ''}
  ${r.slick ? 'mapN = normalize( mix( mapN, vec3( 0.0, 0.0, 1.0 ), gTm * 0.85 ) );' : ''}`)
      .replace('#include <emissivemap_fragment>', r.veins ? 'totalEmissiveRadiance *= tVeins(vGroundXZ);' : '#include <emissivemap_fragment>');
  };
  mat.customProgramCacheKey = () => `terrain-${habitat}-${rough}-${!!second}`;
  mat.needsUpdate = true;
  return mat;
}

// Makes the small things laid on a habitat's ground (an InstancedMesh's material, with `aEdge` per instance)
// follow its relief: each one is lifted by the height under it.
export function onRelief(mat, habitat) {
  const r = RELIEF[habitat];
  if (!r) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aEdge;
${NOISE}
${habitatFn(r)}`)
      .replace('#include <project_vertex>', THREE.ShaderChunk.project_vertex.replace('mvPosition = modelViewMatrix * mvPosition;', `
  #ifdef USE_INSTANCING
    mvPosition.y += tHeight((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz) * aEdge;
  #endif
  mvPosition = modelViewMatrix * mvPosition;`));
  };
  mat.customProgramCacheKey = () => `relief-${habitat}`;
  return mat;
}
