// The museum in real 3D (three.js), shared by every 3D view (the view from above, the walk).
// The scene is built from the live world (src/sim): lawn, paths, enclosure grounds, walls with iron
// railings (or glass where a path runs along), buildings, the forest around; the real 3D monsters
// (src/assets/3d/*.glb, compressed copies of models/*.glb) walk where the game (Phaser, running hidden: src/render/GameScene.js)
// puts them, visitors and keepers too. When the park changes (built, demolished), the static parts are
// rebuilt. The views only move the camera and handle the input.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { tilesOf, containsTile } from '../sim/enclosure.js';
import { shelterSize } from '../sim/build.js';
import { SHELTER_MODEL_SCALE } from '../render/shelterpath.js';
import { HABITAT_FAMILY } from '../config/species.js';
import { BALANCE } from '../config/balance.js';
import { ENCLOSURE_DECOR, DECOR_SCALE } from '../config/decor.js';
import { drawBubble } from '../render/bubbles.js';
import { Parking3D } from './parking3d.js';
import { antiTile, lavaChannels, reliefGeometry, pathFringe, wallShade, groundDetails } from './grounds.js';
import { RELIEF, terrainMaterial } from './terrain.js';
import { instanceGroup, chunkedInstances, place, prepareDecor, prepareProps } from './scenery.js';

// models: .glb files wrapped in .json (scripts/3d/glb-to-json.mjs) so any host serves them
const ASSETS = import.meta.glob('../assets/3d/**/*.{json,webp}', { eager: true, query: '?url', import: 'default' });
const asset = (name) => ASSETS[`../assets/3d/${name}`];

export const T = 2.5; // metres per tile
export const RING = 7; // tiles of scenery around the park around the park

// Monsters: height (m), how it stands, which clips to play.
const MONSTERS = {
  dragonnet: { height: 2.2, walk: 'Walk', idle: 'Idle' },
  golem: { height: 3.4, walk: 'Walk', idle: 'Idle' },
  kraken: { height: 2.4, walk: 'Crawl', idle: 'Idle', sink: 0.45 }, // swims, sunk to the eyes
  spectre: { height: 2.5, walk: 'Float', idle: 'Idle', hover: 0.35 },
  yeti: { height: 3.0, walk: 'Walk', idle: 'Idle' },
};
// The animations of the game scene (the kind in their key, "golem-slam-d3": src/render/sprites.js) and the clips of the 3D
// models playing them: the first one the model has. "sitdown" is the wake-up played backwards, "statue" the
// idle pose frozen (the animation stops: so does the clip).
const CLIPS = {
  idle: ['Idle'], statue: ['Idle'], walk: ['Walk', 'Crawl', 'Float'], run: ['Run', 'Walk', 'Crawl', 'Float'],
  fly: ['Fly', 'Walk'], flap: ['FlapWings'], stretch: ['Stretch', 'StretchWings'], look: ['Look Around', 'LookAround'],
  tail: ['TailWag'], chestbeat: ['ChestBeat'], slam: ['GroundSlam'], threat: ['Threat'], sleep: ['Sleep'],
  wakeup: ['WakeUp'], sitdown: ['WakeUp'], shake: ['RockShake', 'ShakeFur'], wiggle: ['Tentacle Wiggle'],
  haunt: ['Haunt'], scratch: ['ScratchHead'], happy: ['Happy'], wave: ['Wave'],
};
// Clips authored backwards (the golem's walk: its supporting foot moves forward): played the other way.
const REVERSED = { golem: ['walk'] };
const VISITOR_MODELS = ['person-men-casual_2', 'person-women-casual', 'person-men-suit', 'person-women-formal'];
const KEEPER_MODEL = 'person-men-worker';

// Ground textures (src/assets/3d/tex, CC0 from ambientCG: name, name-n normals, name-r AO (R) + roughness (G)):
// metres covered by one copy of the texture, tint.
const GROUNDS = {
  grass: { size: 4, tint: 0xe8f2dc, minRough: 0.85 },
  path: { size: 2.5, tint: 0xf0ebe2 },
  lava: { size: 4, tint: 0xffffff, emissive: 'lava-e', rock: 'basalt' }, // lava in channels on volcanic rock
  dark: { size: 3, tint: 0xc4bccc },
  forest: { size: 4, tint: 0xffffff },
  ice: { size: 5, tint: 0xf4f8ff },
  ash: { size: 4, tint: 0xb8b2ac },
  basalt: { size: 4, tint: 0xd8ccc4 },
  graveyard: { size: 4, tint: 0xd8d6cc },
  ruins: { size: 3, tint: 0xf0ece0 },
  crystal: { size: 4, tint: 0xd8d0f0 },
  tundra: { size: 5, tint: 0xffffff },
  summit: { size: 5, tint: 0xeef2f8 },
};
// water habitats: colour of the water
const WATERS = { water: 0x1f6474, reef: 0x1f7a7c, abyss: 0x0a1a2c, swamp: 0x3a4226 };
// The garden decorations (buildings of one tile, picked in the Furniture menu: their `look`).
// name: prop of props.glb.json (or `decor`: a node of decor.glb.json), its height or width in metres.
export const GARDEN = [
  { name: 'pottedPlant', height: 1.3 },
  { name: 'shrubClump', height: 1.2 },
  { name: 'streetLamp', height: 3.6 },
  { name: 'parkBench', height: 1.0, facePath: true }, // with its back (its model is short and deep)
  { name: 'flowerBox', height: 1.0, facePath: true }, // with its flowers
  { name: 'mossRocks', decor: 'mossRocks' },
  { name: 'trashCan', height: 1.0, facePath: true },
];

export class ParkScene {
  // `scene`: the (hidden) Phaser GameScene, for where the monsters wander; may come later (setScene).
  constructor(world, scene = null) {
    this.world = world;
    this.scene = scene;
    this.people = new Map(); // id -> { obj, mixer, actions, current, last }
    this.monsters = new Map();
    this.models = new Map(); // file -> Promise<{ scene, animations, box }>
    this.texCache = new Map();
    this.lowTex = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    this.focus = new THREE.Vector3(); // where the camera looks: shadows and people around it
    this.viewPeople = 70; // m: people further from the focus are not drawn
    this.shadowSize = 38; // m: half the side of the square that gets sun shadows

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = r.domElement;

    this.s3 = new THREE.Scene();
    this.s3.fog = new THREE.Fog(0xcfe0ea, 60, 210);
    this.loader = new GLTFLoader();
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildWalls();
    this.buildBuildings();
    this.buildDecor();
    this.parking3d = new Parking3D(this, T); // the road, and the car park with its cars
    this.buildTrees();
    this.lastGrid = this.world.grid.version;
  }

  setScene(scene) {
    this.scene = scene;
  }

  // Lighter drawing for modest computers and phones: 0 = full, 1 = finer pixels and shadows reduced,
  // 2 = coarse pixels, small shadows, 3 = no shadows.
  setQuality(level) {
    this.quality = level;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio([Math.min(dpr, 1.75), Math.min(dpr, 1.25), 1, 0.8][level]);
    const map = [2048, 1536, 1024, 0][level];
    this.sun.castShadow = map > 0;
    if (map && this.sun.shadow.mapSize.x !== map) {
      this.sun.shadow.mapSize.set(map, map);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  // Loads every monster and person model; resolves with the number that failed.
  async loadModels() {
    const names = [...Object.keys(MONSTERS), ...VISITOR_MODELS, KEEPER_MODEL];
    const results = await Promise.allSettled(names.map((n) => this.model(n)));
    const failed = results.filter((x) => x.status === 'rejected');
    for (const x of failed) console.error(x.reason);
    return failed.length;
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
  }


  // `key`: another copy of the same picture (its own repeat), cached under that key
  tex(name, repeatColor = true, key = name) {
    if (this.texCache.has(key)) return this.texCache.get(key);
    const url = asset(`tex/${name}.webp`);
    let tx;
    if (this.lowTex) {
      // modest computers and phones: the pictures halved (512 px), lighter on memory
      tx = new THREE.Texture(); // (nothing drawn until the picture is there: its size is known only then)
      new THREE.ImageLoader().load(url, (img) => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, img.width >> 1);
        c.height = Math.max(1, img.height >> 1);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        tx.image = c;
        tx.needsUpdate = true;
      });
    } else tx = new THREE.TextureLoader().load(url);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.anisotropy = 8;
    if (repeatColor) tx.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, tx);
    return tx;
  }

  buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(48), THREE.MathUtils.degToRad(-130));
    u.sunPosition.value.copy(this.sunDir);
    this.s3.add(sky);
    // reflections (water, glass) from the same sky
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(4000);
    Object.assign(sky2.material.uniforms.sunPosition.value, this.sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = u[k].value;
    skyScene.add(sky2);
    this.s3.environment = pmrem.fromScene(skyScene).texture;
    this.s3.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  buildLights() {
    this.s3.add(new THREE.HemisphereLight(0xdcecff, 0x5a6a48, 0.9));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = c.bottom = -38; c.right = c.top = 38; c.near = 1; c.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.s3.add(sun, sun.target);
  }

  // ---------------------------------------------------------------- ground

  // One flat mesh made of tile squares at height y, textured in world space (no seams, no grid pattern).
  quads(tiles, y, size) {
    const pos = [], uv = [], idx = [];
    for (const { tx, ty } of tiles) {
      const x0 = (tx - 0.5) * T, x1 = (tx + 0.5) * T, z0 = (ty - 0.5) * T, z1 = (ty + 0.5) * T;
      const i = pos.length / 3;
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      uv.push(x0 / size, -z0 / size, x1 / size, -z0 / size, x1 / size, -z1 / size, x0 / size, -z1 / size);
      idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  groundMaterial(name) {
    const d = GROUNDS[name];
    const r = this.tex(`${name}-r`, false);
    const m = new THREE.MeshStandardMaterial({
      map: this.tex(name), normalMap: this.tex(`${name}-n`, false), roughnessMap: r, aoMap: r, aoMapIntensity: 0.9,
      color: d.tint, roughness: 1,
    });
    if (d.emissive) {
      m.emissiveMap = this.tex(d.emissive);
      m.emissive = new THREE.Color(0xff5a10);
      m.emissiveIntensity = 3;
      m.aoMap = null;
      this.lavaMats = [...(this.lavaMats ?? []), m];
      this.flowTime ??= { value: 0 };
      lavaChannels(m, this.flowTime, this.tex(d.rock, true, `${d.rock}-lava`), this.tex(`${d.rock}-n`, false, `${d.rock}-n-lava`));
    } else if (RELIEF[name]) {
      const sec = RELIEF[name].second;
      terrainMaterial(m, name, sec && { map: this.tex(sec, true, `${sec}-second`), normal: this.tex(`${sec}-n`, false, `${sec}-n-second`) }, d.minRough ?? 0.45);
    } else antiTile(m, d.minRough ?? 0.45);
    return m;
  }

  // Moving water, in its shader, on the shared clock this.flowTime (see update): two sets of ripples crossing each
  // other at different speeds. (The lava flows in its channels: lavaChannels, src/render3d/grounds.js.)
  flowing(m) {
    this.flowTime ??= { value: 0 };
    const time = this.flowTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uFlowTime = time;
      sh.fragmentShader = 'uniform float uFlowTime;\n' + sh.fragmentShader
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps)
        .replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec3 mapN = normalize(
    ( texture2D( normalMap, vNormalMapUv + vec2( uFlowTime * 0.06, uFlowTime * 0.035 ) ).xyz * 2.0 - 1.0 )
    + ( texture2D( normalMap, vNormalMapUv * 2.6 + vec2( -uFlowTime * 0.09, uFlowTime * 0.12 ) ).xyz * 2.0 - 1.0 ) * 0.8 );`,
        );
    };
    m.customProgramCacheKey = () => 'flow-water';
  }

  // a tileable wavy normal map, drawn once
  waterNormals() {
    if (this.waterNormal) return this.waterNormal;
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const waves = Array.from({ length: 18 }, (_, i) => ({ fx: (i % 6) + 1, fy: ((i * 7) % 7) - 3, ph: i * 1.7, a: 1 / (1 + (i % 6)) }));
    const h = (x, y) => waves.reduce((s, w) => s + w.a * Math.sin(6.283 * (w.fx * x + w.fy * y) / S + w.ph), 0);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (h(x + 1, y) - h(x - 1, y)) * 1.2, dy = (h(x, y + 1) - h(x, y - 1)) * 1.2;
        const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
        img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
        img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tx = (this.waterNormal = new THREE.CanvasTexture(c));
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    return tx;
  }

  buildGround() {
    const old = this.groundGroup;
    if (old) {
      this.s3.remove(old);
      old.traverse((o) => {
        o.geometry?.dispose();
        o.userData.ownMap?.dispose();
        if (o.userData.ownMaterial) o.material.dispose();
      });
    }
    const group = (this.groundGroup = new THREE.Group());
    this.s3.add(group);
    const { grid, builder } = this.world;
    // the lawn: one big square under everything
    // (with holes where the water basins are dug)
    const isWater = (tx, ty) => {
      const tile = grid.inBounds(tx, ty) && grid.getTile(tx, ty);
      const e = tile && tile.occupant && builder.enclosures.get(tile.occupant);
      return !!e && WATERS[e.habitat] !== undefined;
    };
    // (and under the enclosures, whose grounds have their own relief, dug below it in places)
    const isLava = (tx, ty) => {
      const tile = grid.inBounds(tx, ty) && grid.getTile(tx, ty);
      return !!tile && !!tile.occupant && builder.enclosures.has(tile.occupant);
    };
    const lawn = [];
    for (let ty = -RING; ty < grid.h + RING; ty++) for (let tx = -RING; tx < grid.w + RING; tx++) if (!isWater(tx, ty) && !isLava(tx, ty)) lawn.push({ tx, ty });
    this.lawnMat ??= this.groundMaterial('grass');
    const lawnMesh = new THREE.Mesh(this.quads(lawn, 0, GROUNDS.grass.size), this.lawnMat);
    lawnMesh.receiveShadow = true;
    group.add(lawnMesh);
    // and beyond the forest, as far as the eye goes (four big bands around the lawn)
    const a = (-RING - 0.5) * T, bx = (grid.w + RING - 0.5) * T, bz = (grid.h + RING - 0.5) * T, F = 600;
    const far = [[-F, -F, bx + F, a], [-F, bz, bx + F, bz + F], [-F, a, a, bz], [bx, a, bx + F, bz]];
    const pos = [], uv = [], idx = [], sz = GROUNDS.grass.size;
    for (const [x0, z0, x1, z1] of far) {
      const i = pos.length / 3;
      pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
      uv.push(x0 / sz, -z0 / sz, x1 / sz, -z0 / sz, x1 / sz, -z1 / sz, x0 / sz, -z1 / sz);
      idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    group.add(new THREE.Mesh(fg, this.lawnMat));
    // paths and enclosure grounds, by kind
    const byKind = new Map();
    const add = (k, tile) => (byKind.get(k) ?? byKind.set(k, []).get(k)).push(tile);
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        const tile = grid.getTile(tx, ty);
        const e = tile.occupant && builder.enclosures.get(tile.occupant);
        if (e) add(e.habitat, { tx, ty });
        else if (tile.ground === 'path') add('path', { tx, ty });
      }
    }
    this.mats ??= new Map();
    this.waterMats = [];
    for (const [k, tiles] of byKind) {
      if (WATERS[k] !== undefined) {
        // water: a dark basin a little below, a shiny moving surface
        const bottom = new THREE.Mesh(this.quads(tiles, -0.9, 4), new THREE.MeshStandardMaterial({ color: 0x0d2a30, roughness: 1 }));
        group.add(bottom);
        const n = this.waterNormals();
        const m = new THREE.MeshPhysicalMaterial({
          color: WATERS[k], roughness: 0.06, metalness: 0, transmission: 0, normalMap: n, normalScale: new THREE.Vector2(1.1, 1.1),
          transparent: true, opacity: 0.88, envMapIntensity: 1.2,
        });
        this.flowing(m);
        this.waterMats.push(m);
        const surf = new THREE.Mesh(this.quads(tiles, -0.12, 6), m);
        surf.receiveShadow = true;
        group.add(surf);
        // the basin sides, down to the bottom, where the water meets dry ground
        const pos = [], idx = [];
        for (const { tx, ty } of tiles) {
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            if (isWater(tx + dx, ty + dy)) continue;
            const cx = (tx + dx / 2) * T, cz = (ty + dy / 2) * T;
            const ax = dy ? cx - T / 2 : cx, az = dy ? cz : cz - T / 2, bx = dy ? cx + T / 2 : cx, bz = dy ? cz : cz + T / 2;
            const i = pos.length / 3;
            pos.push(ax, 0, az, bx, 0, bz, bx, -0.9, bz, ax, -0.9, az);
            idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
          }
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        sg.setIndex(idx);
        sg.computeVertexNormals();
        group.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: 1, side: THREE.DoubleSide })));
        continue;
      }
      if (!GROUNDS[k]) continue;
      if (!this.mats.has(k)) this.mats.set(k, this.groundMaterial(k));
      const geo = k === 'lava' || RELIEF[k] ? reliefGeometry(this.world, T, tiles, GROUNDS[k].size) : this.quads(tiles, 0.015, GROUNDS[k].size);
      const mesh = new THREE.Mesh(geo, this.mats.get(k));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // softer edges: the paths fade into the lawn, a shade at the foot of the walls; small things on the grounds
    if (this.mats.has('path')) {
      const fringe = pathFringe(this.world, T, this.mats.get('path'), GROUNDS.path.size);
      if (fringe) group.add(fringe);
    }
    const shade = wallShade(this.world, T, (e) => WATERS[e.habitat] !== undefined);
    if (shade) group.add(shade);
    group.add(groundDetails(this.world, T));
  }

  // ---------------------------------------------------------------- walls

  buildWalls() {
    const old = this.wallGroup;
    if (old) {
      this.s3.remove(old);
      old.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    const group = (this.wallGroup = new THREE.Group());
    this.s3.add(group);
    const { grid, builder } = this.world;
    const segs = []; // { x, z, alongX, glass }
    const posts = new Map();
    for (const e of builder.enclosures.values()) {
      for (const { tx, ty } of tilesOf(e)) {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const ox = tx + dx, oy = ty + dy;
          if (containsTile(e, ox, oy)) continue;
          const out = grid.inBounds(ox, oy) && grid.getTile(ox, oy);
          const glass = !!out && out.ground === 'path' && !out.occupant;
          const x = (tx + dx / 2) * T, z = (ty + dy / 2) * T, alongX = dy !== 0;
          segs.push({ x, z, alongX, glass });
          // the two ends of the segment: posts
          for (const s of [-0.5, 0.5]) {
            const px = alongX ? x + s * T : x, pz = alongX ? z : z + s * T;
            posts.set(`${px.toFixed(2)},${pz.toFixed(2)}`, [px, pz]);
          }
        }
      }
    }
    if (!segs.length) return;
    const stoneTex = this.tex('wall'), stoneN = this.tex('wall-n', false);
    const stone = new THREE.MeshStandardMaterial({ map: stoneTex, normalMap: stoneN, color: 0xe6dccb, roughness: 0.9 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xd7cdbb, roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.45, metalness: 0.7 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ee, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false });
    const WALL_H = 0.75, WALL_D = 0.42, RAIL_TOP = 2.45, POST = 0.55, POST_H = 2.55;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const inst = (geo, mat, n, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.castShadow = shadow;
      im.receiveShadow = true;
      group.add(im);
      return im;
    };
    const set = (im, i, x, y, z, rot, sx, sy, sz) => {
      q.setFromAxisAngle(up, rot);
      m4.compose(p.set(x, y, z), q, sc.set(sx, sy, sz));
      im.setMatrixAt(i, m4);
    };
    // low stone wall
    const wallGeo = new THREE.BoxGeometry(T, WALL_H, WALL_D);
    wallGeo.translate(0, WALL_H / 2, 0);
    stoneTex.repeat.set(1.6, 1);
    const walls = inst(wallGeo, stone, segs.length);
    segs.forEach((s, i) => set(walls, i, s.x, 0, s.z, s.alongX ? 0 : Math.PI / 2, 1, 1, 1));
    // posts with a cap
    const postGeo = new THREE.BoxGeometry(POST, POST_H, POST);
    postGeo.translate(0, POST_H / 2, 0);
    const capGeo = new THREE.BoxGeometry(POST + 0.14, 0.14, POST + 0.14);
    capGeo.translate(0, POST_H + 0.07, 0);
    const pl = [...posts.values()];
    // the posts: same stones, not stretched (narrow and tall)
    const postTex = this.tex('wall', true, 'wall-post');
    postTex.repeat.set(0.45, 1.7);
    const postN = this.tex('wall-n', false, 'wall-n-post');
    postN.repeat.set(0.45, 1.7);
    const postMat = new THREE.MeshStandardMaterial({ map: postTex, normalMap: postN, color: 0xe6dccb, roughness: 0.9 });
    const postI = inst(postGeo, postMat, pl.length), capI = inst(capGeo, cap, pl.length);
    pl.forEach(([x, z], i) => { set(postI, i, x, 0, z, 0, 1, 1, 1); set(capI, i, x, 0, z, 0, 1, 1, 1); });
    // iron railings (bars with spear tips, two rails) or a glass pane
    const free = T - POST; // between two posts
    const BARS = 11;
    const bars = segs.filter((s) => !s.glass);
    const glass = segs.filter((s) => s.glass);
    const barGeo = new THREE.CylinderGeometry(0.022, 0.022, RAIL_TOP - WALL_H, 6);
    barGeo.translate(0, WALL_H + (RAIL_TOP - WALL_H) / 2, 0);
    const tipGeo = new THREE.ConeGeometry(0.05, 0.16, 6);
    tipGeo.translate(0, RAIL_TOP + 0.08, 0);
    const railGeo = new THREE.BoxGeometry(free, 0.05, 0.05);
    const barI = inst(barGeo, iron, bars.length * BARS), tipI = inst(tipGeo, iron, bars.length * BARS);
    const railI = inst(railGeo, iron, bars.length * 2 + glass.length);
    let bi = 0, ri = 0;
    for (const s of bars) {
      for (let k = 0; k < BARS; k++) {
        const o = -free / 2 + (free * (k + 0.5)) / BARS;
        const x = s.alongX ? s.x + o : s.x, z = s.alongX ? s.z : s.z + o;
        set(barI, bi, x, 0, z, 0, 1, 1, 1);
        set(tipI, bi++, x, 0, z, 0, 1, 1, 1);
      }
      for (const y of [WALL_H + 0.25, RAIL_TOP - 0.2]) set(railI, ri++, s.x, y, s.z, s.alongX ? 0 : Math.PI / 2, 1, 1, 1);
    }
    if (glass.length) {
      const paneGeo = new THREE.BoxGeometry(free, RAIL_TOP - WALL_H - 0.05, 0.03);
      paneGeo.translate(0, WALL_H + (RAIL_TOP - WALL_H) / 2, 0);
      const paneI = inst(paneGeo, glassMat, glass.length, false);
      glass.forEach((s, i) => {
        set(paneI, i, s.x, 0, s.z, s.alongX ? 0 : Math.PI / 2, 1, 1, 1);
        set(railI, ri++, s.x, RAIL_TOP - 0.02, s.z, s.alongX ? 0 : Math.PI / 2, 1, 1.2, 1.2);
      });
      paneI.renderOrder = 2;
    }
    railI.count = ri;
  }

  // ---------------------------------------------------------------- buildings and scenery

  stripes(a, b) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 8;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 8, 0, 8, 8); }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  }

  buildBuildings() {
    const old = this.buildGroup;
    if (old) this.s3.remove(old);
    const group = (this.buildGroup = new THREE.Group());
    this.s3.add(group);
    const garden = new Map(); // variant -> { matrices, ids }
    for (const b of this.world.builder.buildings.values()) {
      const cx = ((b.x0 + b.x1) / 2) * T, cz = ((b.y0 + b.y1) / 2) * T;
      if (b.type === 'snack') {
        // two stands, the one picked in the Snack menu: the Kraken's waffles or the Dragon's grill (older games:
        // picked from the building id)
        const n = Number(String(b.id).replace(/\D/g, '')) || 0;
        const waffles = b.look ? b.look === 'waffles' : n % 2 === 1;
        // (the waffle stand's counter is on its +z side, the grill's on its +x side)
        const [model, front] = waffles ? ['stand-kraken-waffles', 0] : ['stand-dragon-grill', -Math.PI / 2];
        // a real kiosk next to the visitors: counter about waist high, the edge of its roof about 2.3 m up
        // (3.1 m across: it overhangs its tile a little)
        this.placeModel(group, model, cx, cz, 3.1, this.faceToPath(b) + front, b.id);
      } else if (b.type === 'atm') {
        // the cash machine (src/assets/3d/atm.glb.json, from models/parking/ATM.fbx): 0.67 m wide, its screen
        // toward the path
        this.placeModel(group, 'atm', cx, cz, 0.67, this.faceToPath(b), b.id);
      } else if (b.type === 'souvenir') {
        // the same: the edge of its roof about 2.4 m up, its dragon on top about 3.8 m
        this.placeModel(group, 'fabrique-a-monstres', cx, cz, 3.25, this.faceToPath(b), b.id);
      } else if (b.type === 'hatchery') {
        this.placeIncubator(group, cx, cz, b.id);
      } else if (b.type === 'expeditionBase') {
        // a military tent about 3 m tall on its 3 x 3 tiles (the model is very wide for its height: it overhangs them a little)
        // furnished inside (seen through its door and windows): models/blender/musee-decors.blend, scene TentInterior
        this.placeModel(group, 'expedition-base', cx, cz, (b.x1 - b.x0 + 1) * T * 1.13, this.faceToPath(b), b.id, 'expedition-interior');
      } else {
        // a garden decoration: the one picked in the Furniture menu (older games: picked from its id)
        const n = Number(String(b.id).replace(/\D/g, '')) || 0;
        const v = GARDEN.find((g) => g.name === b.look) ?? GARDEN[n % GARDEN.length];
        const rot = v.facePath ? this.faceToPath(b) : (n * 2.39996) % (Math.PI * 2);
        const g = garden.get(v.name) ?? garden.set(v.name, { v, items: [], ids: [] }).get(v.name);
        g.items.push({ cx, cz, rot });
        g.ids.push(b.id);
      }
    }
    // the entrance gate (open), across the entrance path
    const { tx, ty } = this.world.entrance;
    const needDecor = [...garden.values()].some((g) => g.v.decor);
    Promise.all([this.props(), needDecor ? this.decorNodes() : new Map()]).then(([props, decor]) => {
      if (this.buildGroup !== group) return; // rebuilt meanwhile
      const gate = props.get('entranceGate');
      if (gate) group.add(instanceGroup(gate, [place(tx * T, 0, ty * T, 0, 3.7 / gate.userData.size.x)], { base: null }));
      for (const { v, items, ids } of garden.values()) {
        const tpl = v.decor ? decor.get(v.decor) : props.get(v.name);
        if (!tpl) continue;
        // its size: props in metres (largest side, or height), decorations in tiles
        const size = tpl.userData.size;
        const k = v.decor ? T : v.height ? v.height / size.y : v.width / Math.max(size.x, size.z);
        const mats = items.map(({ cx, cz, rot }) => place(cx, 0, cz, rot, k));
        group.add(instanceGroup(tpl, mats, { base: v.decor ? tpl.parent : null, ids }));
      }
    }).catch((err) => console.error(err));
  }

  // The props (Poly Haven models) and the enclosure decorations, loaded once (see scenery.js).
  props() {
    this.propsP ??= this.model('props').then((m) => prepareProps(m.gltf));
    return this.propsP;
  }

  decorNodes() {
    this.decorP ??= this.model('decor').then((m) => prepareDecor(m.scene));
    return this.decorP;
  }

  // The decorations and shelters inside the enclosures, rebuilt with the park; copies of the same one are
  // drawn together (instancing). In water they sit lower, their waterline at the surface.
  buildDecor() {
    const old = this.decorGroup;
    if (old) this.s3.remove(old);
    const group = (this.decorGroup = new THREE.Group());
    this.s3.add(group);
    const byNode = new Map();
    const add = (name, m) => (byNode.get(name) ?? byNode.set(name, []).get(name)).push(m);
    const shelters = [];
    const WATER_Y = -0.12, BOTTOM = -0.9;
    for (const e of this.world.builder.enclosures.values()) {
      const wet = WATERS[e.habitat] !== undefined;
      const y = (wl) => (wet ? Math.max(BOTTOM, WATER_Y - wl * T) : 0);
      for (const d of e.decor ?? []) {
        if (!ENCLOSURE_DECOR[d.type]) continue;
        // the variant, turned differently, picked from the tile (as the menu icons, render-decor.mjs: 0 or 140 degrees)
        const v = (d.tx * 7 + d.ty * 13) % 2;
        add(d.type, { tx: d.tx, ty: d.ty, rot: v ? THREE.MathUtils.degToRad(140) : 0, y, k: DECOR_SCALE[d.type] });
      }
      const sh = e.shelter;
      // centred on its n x n tiles (3, or 2 for an old one), its entrance toward +y (+z here): a model of
      // shelters.glb (made for 3 x 3 tiles, models/blender/musee-decors.blend), scaled to its monster
      if (sh) {
        const n = shelterSize(sh);
        shelters.push({ name: `shelter-${sh.family}`, tx: sh.tx + (n - 1) / 2, ty: sh.ty + (n - 1) / 2, y, k: (SHELTER_MODEL_SCALE[sh.family] ?? 0.55) * (n / 3) });
      }
    }
    if (shelters.length) {
      this.shelterP ??= this.model('shelters').then((m) => prepareDecor(m.scene));
      this.shelterP.then((nodes) => {
        if (this.decorGroup !== group) return; // rebuilt meanwhile
        for (const it of shelters) {
          const node = nodes.get(it.name);
          if (!node) continue;
          const obj = node.clone(true);
          obj.position.set(it.tx * T, it.y(0), it.ty * T);
          obj.scale.setScalar(T * it.k);
          group.add(obj);
        }
      }).catch((err) => console.error(err));
    }
    if (!byNode.size) return;
    this.decorNodes().then((nodes) => {
      if (this.decorGroup !== group) return; // rebuilt meanwhile
      for (const [name, list] of byNode) {
        const node = nodes.get(name);
        if (!node) continue;
        const wl = node.userData.waterline ?? 0;
        const items = list.map((it) => ({ x: it.tx * T, z: it.ty * T, matrix: place(it.tx * T, it.y(wl), it.ty * T, it.rot, T * (it.k ?? 1)) }));
        group.add(chunkedInstances(node, items, 40, { base: node.parent }));
      }
    }).catch((err) => console.error(err));
  }

  // A building model on its tiles: `width` metres across (its widest side), turned by `rot` (radians),
  // standing on the ground. Loaded in the background. `id`: the building's, for clicks.
  // `inside`: a model of what is inside it, made in the same frame as it (the tent's furnishings), placed with it.
  placeModel(group, name, cx, cz, width, rot = 0, id = null, inside = null) {
    this.model(name).then((m) => {
      if (this.buildGroup !== group) return; // rebuilt meanwhile
      const obj = m.scene.clone(true);
      const size = m.box.getSize(new THREE.Vector3());
      const s = width / Math.max(size.x, size.z);
      const inner = new THREE.Group();
      obj.scale.setScalar(s);
      // centred on the tiles, its feet on the ground
      obj.position.set(-((m.box.min.x + m.box.max.x) / 2) * s, -m.box.min.y * s, -((m.box.min.z + m.box.max.z) / 2) * s);
      inner.add(obj);
      inner.position.set(cx, 0, cz);
      inner.rotation.y = rot;
      inner.userData.buildingId = id;
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.frustumCulled = true;
      });
      group.add(inner);
      if (inside) {
        this.model(inside).then((mi) => {
          const io = mi.scene.clone(true);
          io.scale.setScalar(s);
          io.position.copy(obj.position);
          io.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
          inner.add(io);
        }).catch((err) => console.error(err));
      }
    }).catch((err) => console.error(err));
  }

  // The turn (radians) that points a building's front (+z of its model) toward a path next to it.
  faceToPath(b) {
    const { grid } = this.world;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let best = null;
    for (let y = b.y0 - 1; y <= b.y1 + 1; y++) {
      for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
        if (!grid.inBounds(x, y) || !grid.isPath(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (!best || d < best.d) best = { d, dx: x - cx, dy: y - cy };
      }
    }
    if (!best) return 0;
    // keep to the four sides
    const ang = Math.atan2(best.dx, best.dy);
    return Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  }

  // The incubator (models/incubator.glb, 5 places for eggs: nodes EggSlot_01..05) on its 2 x 2 tiles.
  placeIncubator(group, cx, cz, id = null) {
    this.eggSlots = [];
    this.eggs3d = new Map();
    this.model('incubator').then((m) => {
      if (this.buildGroup !== group) return; // rebuilt meanwhile
      const inc = m.scene.clone(true);
      const size = m.box.getSize(new THREE.Vector3());
      // about 2.8 m across and 3 m tall: big enough for its five 80 cm eggs under the glass bell
      const s = 2.8 / Math.max(size.x, size.z);
      inc.scale.setScalar(s);
      inc.position.set(cx, -m.box.min.y * s, cz);
      inc.userData.buildingId = id;
      inc.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.frustumCulled = true;
        if (o.material.transparent) {
          // the glass bell: drawn after the eggs, never hiding them
          o.material = o.material.clone();
          o.material.depthWrite = false;
          o.renderOrder = 3;
          o.castShadow = false;
        }
      });
      group.add(inc);
      for (let i = 1; i <= 5; i++) {
        const slot = inc.getObjectByName(`EggSlot_0${i}`);
        if (slot) this.eggSlots.push(slot);
      }
    }).catch((err) => console.error(err));
  }

  // One egg mesh per species: an egg shape, its shell coloured like the monster's habitat.
  eggMesh(egg) {
    const LOOK = {
      dragonnet: { color: 0x9a2e1c, spots: 0x2a1410, glow: 0xff6a1a },
      kraken: { color: 0x2f7f86, spots: 0x123c44, glow: 0x5ee0e6 },
      spectre: { color: 0x5b4a78, spots: 0x231a33, glow: 0xb48cff },
      golem: { color: 0x6f7a52, spots: 0x3c4430, glow: 0xffc94a },
      yeti: { color: 0xdfe8f2, spots: 0x9fb4c8, glow: 0x9fd8ff },
    }[egg.speciesId] ?? { color: 0xe8dcc0, spots: 0x8a7a5a, glow: 0xffffff };
    if (!this.eggGeo) {
      // profile of an egg (narrower at the top), turned around its axis; 1 unit tall, bottom at y = 0
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, a = t * Math.PI;
        pts.push(new THREE.Vector2(Math.sin(a) * 0.36 * (1 - 0.18 * t), (1 - Math.cos(a)) / 2));
      }
      this.eggGeo = new THREE.LatheGeometry(pts, 28);
    }
    // speckles: a small canvas painted once per species
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = `#${LOOK.color.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = `#${LOOK.spots.toString(16).padStart(6, '0')}`;
    let seed = [...egg.speciesId].reduce((s0, ch) => s0 + ch.charCodeAt(0), 1);
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 60; i++) {
      g.beginPath();
      g.ellipse(rnd() * 128, rnd() * 64, 1 + rnd() * 3.5, 1 + rnd() * 2.5, rnd() * 3, 0, 6.3);
      g.fill();
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    const mat = new THREE.MeshPhysicalMaterial({
      map, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.4,
      emissive: new THREE.Color(LOOK.glow), emissiveIntensity: 0,
    });
    if (egg.rare) mat.sheen = 1; // a rare egg shimmers a little
    const mesh = new THREE.Mesh(this.eggGeo, mat);
    mesh.castShadow = true;
    const pivot = new THREE.Group(); // rocks around its base
    pivot.add(mesh);
    return pivot;
  }

  // Shows the eggs of the hatchery in the incubator's places; they glow brighter and start to rock as
  // hatching gets near, and shake when ready.
  updateEggs(time) {
    if (!this.eggSlots?.length) return;
    const total = BALANCE.hatchTimeSec;
    const eggs = this.world.hatchery.eggs.slice(0, this.eggSlots.length);
    const seen = new Set();
    eggs.forEach((egg, i) => {
      seen.add(egg.id);
      let e = this.eggs3d.get(egg.id);
      const slot = this.eggSlots[i];
      if (!e) {
        e = this.eggMesh(egg);
        e.userData.phase = Math.random() * 6;
        this.eggs3d.set(egg.id, e);
      }
      if (e.parent !== slot) slot.add(e);
      // the slots are in the model's (scaled) units: a monster egg about 80 cm tall
      e.scale.setScalar(0.8 / slot.getWorldScale(new THREE.Vector3()).x);
      const p = egg.ready ? 1 : Math.min(1, 1 - egg.remainingSec / total);
      const ph = e.userData.phase;
      const rock = egg.ready ? 0.22 * Math.sin(time * 14 + ph) : p > 0.75 ? 0.08 * Math.sin(time * 4 + ph) * Math.max(0, Math.sin(time * 0.9 + ph)) : 0;
      e.rotation.set(rock, 0, rock * 0.6);
      const mesh = e.children[0];
      mesh.material.emissiveIntensity = (0.05 + 0.5 * p * p) * (0.75 + 0.25 * Math.sin(time * 2 + ph));
    });
    for (const [id, e] of this.eggs3d) {
      if (seen.has(id)) continue;
      e.removeFromParent();
      this.eggs3d.delete(id);
    }
  }

  // The forest around the park: Poly Haven fir and pine saplings grown to tree size, drawn by areas
  // (instancing, the areas out of view are skipped).
  buildTrees() {
    const { grid } = this.world;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const trees = [];
    for (let ty = -RING; ty < grid.h + RING; ty += 1.4) {
      for (let tx = -RING; tx < grid.w + RING; tx += 1.4) {
        const out = Math.max(-tx, -ty, tx - grid.w + 1, ty - grid.h + 1);
        if (out < 2) continue;
        if (rnd() > 0.32 + out * 0.11) continue;
        const x = (tx + rnd() * 0.9) * T, z = (ty + rnd() * 0.9) * T;
        // a clearing in front of the entrance gate, where the visitors come from; none on the road and the car park
        if (Math.hypot(x / T - this.world.entrance.tx, z / T - this.world.entrance.ty) < 8) continue;
        if (this.parking3d?.blocks(x / T, z / T)) continue;
        trees.push({ x, z, fir: rnd() < 0.35, h: 5 + rnd() * 4 + out * 0.3, rot: rnd() * 6.28 });
      }
    }
    // by areas of 30 m: near the camera the full trees, further the light pine (see updateForest)
    const CELL = 30;
    const areas = new Map();
    for (const t of trees) {
      const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
      (areas.get(k) ?? areas.set(k, []).get(k)).push(t);
    }
    const token = (this.treeToken = (this.treeToken ?? 0) + 1);
    this.props().then((props) => {
      if (token !== this.treeToken) return; // rebuilt meanwhile
      if (this.forestGroup) this.s3.remove(this.forestGroup);
      const group = (this.forestGroup = new THREE.Group());
      const low = props.get('pineTreeLow');
      this.forest = [];
      for (const list of areas.values()) {
        const near = new THREE.Group();
        for (const [name, fir] of [['firTree', true], ['pineTree', false]]) {
          const tpl = props.get(name);
          const mine = list.filter((t) => t.fir === fir);
          if (tpl && mine.length) near.add(instanceGroup(tpl, mine.map((t) => place(t.x, 0, t.z, t.rot, t.h / tpl.userData.size.y)), { base: null }));
        }
        // (far away, no shadows: they would fall outside the shadowed square anyway)
        const far = low ? instanceGroup(low, list.map((t) => place(t.x, 0, t.z, t.rot, t.h / low.userData.size.y)), { base: null, shadow: false }) : null;
        const cx = list.reduce((a, t) => a + t.x, 0) / list.length, cz = list.reduce((a, t) => a + t.z, 0) / list.length;
        group.add(near);
        if (far) group.add(far);
        this.forest.push({ x: cx, z: cz, near, far });
      }
      this.s3.add(group);
      this.treeCount = trees.length;
    }).catch((err) => console.error(err));
  }

  // The areas of forest near the camera with their full trees, the others with the light ones.
  updateForest(camera) {
    const NEAR = 45;
    for (const a of this.forest ?? []) {
      const d = Math.hypot(camera.position.x - a.x, camera.position.z - a.z, camera.position.y);
      a.near.visible = !a.far || d < NEAR;
      if (a.far) a.far.visible = !a.near.visible;
    }
  }

  // ---------------------------------------------------------------- models

  // A model, loaded once: fetched as JSON, its .glb bytes decoded here and parsed by three.js.
  model(name) {
    if (!this.models.has(name)) {
      const p = fetch(asset(`${name}.glb.json`))
        .then((r) => {
          if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
          return r.json();
        })
        .then(({ glb }) => {
          const bin = atob(glb), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return this.loader.parseAsync(bytes.buffer, '');
        })
        .then((g) => {
          g.scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
              o.frustumCulled = false; // skinned: its bounds do not follow the animation
            }
          });
          const box = new THREE.Box3().setFromObject(g.scene);
          return { scene: g.scene, animations: g.animations, box, gltf: g };
        });
      this.models.set(name, p);
    }
    return this.models.get(name);
  }

  // A new animated copy of a model, `height` metres tall, its feet at y = 0.
  async spawn(name, height) {
    const m = await this.model(name);
    const inner = SkeletonUtils.clone(m.scene);
    const size = m.box.max.y - m.box.min.y;
    const s = height / size;
    inner.scale.setScalar(s);
    inner.position.y = -m.box.min.y * s;
    const obj = new THREE.Group();
    obj.add(inner);
    const mixer = new THREE.AnimationMixer(inner);
    const actions = {};
    for (const clip of m.animations) actions[clip.name] = mixer.clipAction(clip);
    return { obj, mixer, actions, current: null };
  }

  play(e, name, fade = 0.3) {
    if (e.current === name || !e.actions[name]) return;
    const next = e.actions[name];
    next.reset().play();
    if (e.current) e.actions[e.current].crossFadeTo(next, fade, false);
    e.current = name;
  }

  // Follows a list of { id, x, y (tiles), ... } with 3D bodies: creates, moves, turns, animates, removes.
  sync(map, items, make, dt) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let e = map.get(it.id);
      if (!e) {
        e = { loading: true };
        map.set(it.id, e);
        make(it).then((body) => {
          if (map.get(it.id) !== e) return;
          Object.assign(e, body, { loading: false, kind: it.kind, height: it.h });
          e.obj.position.set(it.x * T, 0, it.y * T);
          this.s3.add(e.obj);
        }).catch(() => { e.failed = true; }); // this model could not be loaded: nobody drawn
        continue;
      }
      if (e.loading) continue;
      const nx = it.x * T, nz = it.y * T;
      const dx = nx - e.obj.position.x, dz = nz - e.obj.position.z;
      const d = Math.hypot(dx, dz);
      const speed = d / Math.max(dt, 1e-3);
      e.obj.position.set(nx, it.y3 ?? 0, nz);
      e.obj.visible = it.visible !== false;
      e.moving = (e.moving ?? 0) * 0.8 + (speed > 0.15 ? 0.2 : 0);
      if (it.drive?.sprite.anims?.currentAnim) {
        this.followAnimation(e, it.drive, d > 0.002 ? Math.atan2(dx, dz) : null, dt);
      } else {
        if (d > 0.002) this.turnTo(e, Math.atan2(dx, dz), dt);
        this.play(e, e.moving > 0.5 ? it.walk : it.idle);
        if (e.actions?.[it.walk]) e.actions[it.walk].timeScale = it.walkScale ?? 1;
      }
      e.mixer.update(dt);
      this.syncBubble(e, it.bubble, it.icon);
    }
    for (const [id, e] of map) {
      if (seen.has(id)) continue;
      if (e.obj) this.s3.remove(e.obj);
      if (e.bubble) this.s3.remove(e.bubble);
      map.delete(id);
    }
  }

  // The mood bubble of the entity in the game scene (bubble-happy, -bored, -hungry, -scared...) over the head: the
  // picture of src/render/bubbles.js, always facing the camera and the same size on screen whatever the zoom.
  // `icon`: a bubble of the 3D view only (the keeper's alert while chasing).
  syncBubble(e, entry, icon) {
    const key = entry?.bubbleKey ?? icon ?? null;
    if (!key) {
      if (e.bubble) e.bubble.visible = false;
      return;
    }
    if (!e.bubble) {
      e.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
      e.bubble.center.set(0.5, 0);
      e.bubble.renderOrder = 20;
      e.bubble.scale.setScalar(0.06);
      this.s3.add(e.bubble);
    }
    if (e.bubbleKey !== key) {
      e.bubbleKey = key;
      e.bubble.material.map = this.bubbleTexture(key);
      e.bubble.material.needsUpdate = true;
    }
    e.bubble.visible = e.obj.visible;
    const p = e.obj.position;
    e.bubble.position.set(p.x, p.y + (e.height ?? 1.7) + 0.3, p.z);
  }

  bubbleTexture(key) {
    this.bubbleTex ??= new Map();
    if (!this.bubbleTex.has(key)) {
      // drawn big (src/render/bubbles.js) so it stays sharp
      const img = drawBubble(key, 96);
      if (!img) return null;
      const tx = new THREE.CanvasTexture(img);
      tx.colorSpace = THREE.SRGBColorSpace;
      this.bubbleTex.set(key, tx);
    }
    return this.bubbleTex.get(key);
  }

  turnTo(e, target, dt) {
    let diff = target - e.obj.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    e.obj.rotation.y += diff * Math.min(1, dt * 8);
  }

  // A monster plays what its animation in the hidden game scene plays: the clip of the same behaviour, at the same point of
  // it (the clip's time follows that animation's progress, so speed, pauses and the game speed follow).
  // It faces where it walks, or when still its direction in the game (8 directions, d0 toward +y: dir x 45 degrees).
  followAnimation(e, { sprite, dir }, heading, dt) {
    const anims = sprite.anims;
    const parts = anims.currentAnim.key.split('-');
    const kind = parts[parts.length - 2];
    const species = parts[0].replace(/_[a-z]+$/, ''); // "kraken_water" -> "kraken"
    this.turnTo(e, heading ?? (dir * Math.PI) / 4, dt);
    const name = (CLIPS[kind] ?? CLIPS.idle).find((c) => e.actions[c]) ?? (e.actions.Idle ? 'Idle' : null);
    if (!name) return;
    this.play(e, name, 0.25);
    const act = e.actions[name];
    act.timeScale = 0; // its time is set here
    const p = Math.max(0, Math.min(1, anims.getProgress() || 0));
    const backwards = kind === 'sitdown' || REVERSED[species]?.includes(kind);
    act.time = (backwards ? 1 - p : p) * act.getClip().duration * 0.999;
    e.kind2d = kind;
  }

  // what the animation of a visitor or keeper in the game scene plays and its mood bubble (see followAnimation, syncBubble)
  follow(id) {
    const entry = this.scene?.entitySprites?.get(id);
    return entry?.sprite ? { drive: { sprite: entry.sprite, dir: entry.dir ?? 0 }, bubble: entry } : {};
  }

  syncMonsters(dt) {
    const items = [];
    for (const m of this.world.monsters.values()) {
      if (m.state !== 'enclosed' && m.state !== 'escaped') continue;
      const look = MONSTERS[m.speciesId];
      if (!look) continue;
      const entry = this.scene?.entitySprites?.get(m.id);
      const p = m.state === 'enclosed' && entry?.w ? entry.w : m.pos;
      if (!p) continue;
      const e = m.enclosureId && this.world.builder.enclosures.get(m.enclosureId);
      const inWater = e && HABITAT_FAMILY[e.habitat] === 'water';
      const y3 = (look.hover ?? 0) - (inWater && look.sink ? look.sink * look.height : 0);
      items.push({
        id: m.id, kind: 'monster', h: look.height, x: p.x, y: p.y, y3, species: m.speciesId, walk: look.walk, idle: look.idle,
        visible: (entry?.hideK ?? 1) > 0.3, drive: entry?.sprite ? { sprite: entry.sprite, dir: entry.dir ?? 0 } : null,
        bubble: entry,
      });
    }
    this.sync(this.monsters, items, (it) => this.spawn(it.species, MONSTERS[it.species].height * (0.9 + Math.random() * 0.2)), dt);
  }

  // A picture of a model for the sheets of the menus (its idle pose, seen from the front, a little from the
  // side): a data URL, or null while it is being made. `name`: the model ("golem", "person-men-suit"...).
  portrait(name, w = 96, h = 96) {
    this.portraits ??= new Map();
    if (this.portraits.has(name)) return this.portraits.get(name);
    this.portraits.set(name, null);
    this.model(name).then((m) => {
      const obj = SkeletonUtils.clone(m.scene);
      const idle = m.animations.find((c) => c.name === 'Idle');
      if (idle) {
        const mixer = new THREE.AnimationMixer(obj);
        mixer.clipAction(idle).play();
        mixer.update(0.4);
      }
      this.portraits.set(name, this.snapshot(obj, w, h));
    }).catch((err) => console.error(err));
    return null;
  }

  // A picture of a garden decoration ('parkBench', 'trashCan'...), of the cash machine ('atm') or of a snack
  // stand ('waffles', 'grill') for the menus: a data URL, or null while it is being made.
  thingPortrait(key) {
    this.portraits ??= new Map();
    const id = `thing:${key}`;
    if (this.portraits.has(id)) return this.portraits.get(id);
    this.portraits.set(id, null);
    const stand = { waffles: 'stand-kraken-waffles', grill: 'stand-dragon-grill' }[key];
    const make = stand || key === 'atm'
      ? this.model(stand ?? 'atm').then((m) => m.scene.clone(true))
      : Promise.all([this.props(), this.decorNodes()]).then(([props, decor]) => {
        const v = GARDEN.find((g) => g.name === key);
        const tpl = v?.decor ? decor.get(v.decor) : props.get(key);
        return tpl ? tpl.clone(true) : null;
      });
    make.then((obj) => { if (obj) this.portraits.set(id, this.snapshot(obj, 96, 96)); }).catch((err) => console.error(err));
    return null;
  }

  // Renders an object alone, seen from the front and a little from the side, into a w x h picture (data URL).
  snapshot(obj, w, h) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj, true);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const scene = new THREE.Scene();
    scene.environment = this.s3.environment;
    scene.add(obj, new THREE.HemisphereLight(0xffffff, 0x6a6458, 1.4));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(c.x - 3, c.y + 6, c.z + 5);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(28, w / h, 0.01, 1000);
    const r = Math.max(size.y, size.x * 0.9, size.z * 0.9) * 0.6 / Math.tan(THREE.MathUtils.degToRad(14));
    cam.position.copy(c).add(new THREE.Vector3(0.45, 0.25, 1).normalize().multiplyScalar(r));
    cam.lookAt(c);
    // drawn twice as big, then reduced (smooth edges)
    const W = w * 2, H = h * 2;
    const rt = new THREE.WebGLRenderTarget(W, H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const ren = this.renderer, oldAlpha = ren.getClearAlpha(), oldColor = ren.getClearColor(new THREE.Color());
    ren.setRenderTarget(rt);
    ren.setClearColor(0x000000, 0);
    ren.clear();
    ren.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    ren.readRenderTargetPixels(rt, 0, 0, W, H, px);
    ren.setRenderTarget(null);
    ren.setClearColor(oldColor, oldAlpha);
    rt.dispose();
    const big = document.createElement('canvas');
    big.width = W; big.height = H;
    const img = big.getContext('2d').createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // rows bottom-up
    big.getContext('2d').putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').drawImage(big, 0, 0, w, h);
    return out.toDataURL();
  }

  // The model of a visitor (always the same for a given visitor), of a keeper, of a monster.
  modelOf({ kind, id, speciesId }) {
    if (kind === 'monster') return speciesId;
    if (kind === 'keeper') return KEEPER_MODEL;
    const k = [...String(id)].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
    return VISITOR_MODELS[k % VISITOR_MODELS.length];
  }

  syncPeople(dt) {
    const px = this.focus.x, pz = this.focus.z, r = this.viewPeople;
    const near = (x, y) => Math.hypot(x * T - px, y * T - pz) < r;
    const items = [];
    for (const v of this.world.visitors) {
      if (v.state === 'gone' || !v.pos || !near(v.pos.x, v.pos.y)) continue;
      const k = [...v.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
      items.push({ id: v.id, kind: 'visitor', x: v.pos.x, y: v.pos.y, model: this.modelOf({ kind: 'visitor', id: v.id }), walk: v.state === 'fleeing' ? 'Run' : 'Walk', idle: 'Idle', h: 1.62 + (k % 7) * 0.04, ...this.follow(v.id) });
    }
    for (const kp of this.world.keepers) {
      if (!kp.pos || !near(kp.pos.x, kp.pos.y)) continue;
      items.push({ id: kp.id, kind: 'keeper', x: kp.pos.x, y: kp.pos.y, model: KEEPER_MODEL, walk: kp.state === 'chasing' ? 'Run' : 'Walk', idle: 'Idle', h: 1.8, ...this.follow(kp.id), icon: kp.state === 'chasing' ? 'bubble-alert' : null });
    }
    this.sync(this.people, items, (it) => this.spawn(it.model, it.h), dt);
  }

  // ---------------------------------------------------------------- picking

  // What is under a point of the screen (client pixels), seen by `camera`:
  // { tile: { tx, ty } (where the ray meets the ground) | null, hit: { entity: { id, kind } | null, buildingId | null } }
  pick(clientX, clientY, camera) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = (this.raycaster ??= new THREE.Raycaster());
    ray.setFromCamera(ndc, camera);
    const ground = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    const tile = ground ? { tx: Math.round(ground.x / T), ty: Math.round(ground.z / T) } : null;
    return { tile, hit: { entity: this.pickEntity(clientX - r.left, clientY - r.top, r, camera), buildingId: this.pickBuilding(ray) } };
  }

  // The monster or person drawn under the point (px, py inside the canvas): each body counts as the
  // screen segment from its feet to its head, a little thick; monsters first, then the nearest one.
  pickEntity(px, py, r, camera) {
    const toScreen = (v) => {
      v.project(camera);
      return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height, z: v.z };
    };
    let best = null;
    for (const map of [this.monsters, this.people]) {
      for (const [id, e] of map) {
        if (!e.obj || !e.obj.visible || !e.kind) continue;
        const h = e.height ?? 1.7;
        const p = e.obj.position;
        const a = toScreen(new THREE.Vector3(p.x, p.y, p.z)), b = toScreen(new THREE.Vector3(p.x, p.y + h, p.z));
        if (a.z > 1 || b.z > 1) continue; // behind the camera
        // thickness: about 40 % of the height on screen, at least 8 px
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const side = toScreen(new THREE.Vector3(p.x, p.y + h / 2, p.z).add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(h * 0.25)));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rad = Math.max(8, Math.hypot(side.x - mid.x, side.y - mid.y));
        const t = len ? Math.max(0, Math.min(1, ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / (len * len))) : 0;
        const d = Math.hypot(px - (a.x + t * (b.x - a.x)), py - (a.y + t * (b.y - a.y)));
        if (d > rad) continue;
        const depth = camera.position.distanceTo(p), rank = e.kind === 'monster' ? 0 : 1;
        if (!best || rank < best.rank || (rank === best.rank && depth < best.depth)) best = { id, kind: e.kind, depth, rank };
      }
    }
    return best ? { id: best.id, kind: best.kind } : null;
  }

  // The building whose model the ray meets first
  pickBuilding(ray) {
    if (!this.buildGroup) return null;
    for (const h of ray.intersectObject(this.buildGroup, true)) {
      const ids = h.object.userData.instanceIds;
      if (ids && h.instanceId !== undefined) return ids[h.instanceId];
      for (let o = h.object; o && o !== this.buildGroup; o = o.parent) {
        if (o.userData.buildingId) return o.userData.buildingId;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- placement preview

  // Coloured squares on the tiles of the preview: [{ tx, ty, ok }], green where possible, red if not.
  showGhost(cells) {
    const n = cells?.length ?? 0;
    if (!this.ghost || this.ghost.instanceMatrix.count < n) {
      if (this.ghost) {
        this.s3.remove(this.ghost);
        this.ghost.dispose();
      }
      const geo = this.ghostGeo ??= new THREE.PlaneGeometry(T * 0.94, T * 0.94).rotateX(-Math.PI / 2);
      const mat = this.ghostMat ??= new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, fog: false });
      this.ghost = new THREE.InstancedMesh(geo, mat, Math.max(64, n * 2));
      this.ghost.frustumCulled = false;
      this.ghost.renderOrder = 4;
      this.s3.add(this.ghost);
    }
    const m4 = new THREE.Matrix4(), good = new THREE.Color(0x52b788), bad = new THREE.Color(0xe63946);
    for (let i = 0; i < n; i++) {
      const { tx, ty, ok } = cells[i];
      this.ghost.setMatrixAt(i, m4.makeTranslation(tx * T, 0.06, ty * T));
      this.ghost.setColorAt(i, ok ? good : bad);
    }
    this.ghost.count = n;
    this.ghost.instanceMatrix.needsUpdate = true;
    if (this.ghost.instanceColor) this.ghost.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- loop

  // One step: rebuilds what changed, moves the monsters and people, animates the grounds.
  update(dt, time) {
    // the park changed (built, demolished): rebuild the static parts
    if (this.world.grid.version !== this.lastGrid) {
      this.lastGrid = this.world.grid.version;
      this.buildGround();
      this.buildWalls();
      this.buildBuildings();
      this.buildDecor();
    }
    this.syncMonsters(dt);
    this.syncPeople(dt);
    this.parking3d.update(dt);
    this.updateEggs(time);
    // living grounds: water ripples and flowing lava (flowing), glowing lava breathing
    if (this.flowTime) this.flowTime.value = time - (this.flowT0 ??= time); // from the start: small numbers for the shader
    for (const m of this.lavaMats ?? []) m.emissiveIntensity = 3 + Math.sin(time * 1.3) * 0.5 + Math.sin(time * 3.1) * 0.15;
    // the sun's shadows cover the square around the focus
    const c = this.sun.shadow.camera, s = this.shadowSize;
    if (c.right !== s) {
      c.left = c.bottom = -s; c.right = c.top = s; c.far = 120 + s * 2;
      c.updateProjectionMatrix();
    }
    this.sun.target.position.set(this.focus.x, 0, this.focus.z);
    this.sun.position.copy(this.sunDir).multiplyScalar(60 + s).add(this.sun.target.position);
  }

  render(camera) {
    this.updateForest(camera);
    this.renderer.render(this.s3, camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.s3.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    for (const tx of this.texCache.values()) tx.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
