// The museum in real 3D (three.js), shared by every 3D view (the view from above, the walk).
// The scene is built from the live world (src/sim): lawn, paths, enclosure grounds, walls with iron
// railings (or glass where a path runs along), buildings, the forest around; the real 3D monsters
// (src/assets/3d/*.glb, compressed copies of models/*.glb) walk where the 2D game (Phaser, running hidden)
// puts them, visitors and keepers too. When the park changes (built, demolished), the static parts are
// rebuilt. The views only move the camera and handle the input.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { tilesOf, containsTile } from '../sim/enclosure.js';
import { HABITAT_FAMILY } from '../config/species.js';
import { BALANCE } from '../config/balance.js';

// models: .glb files wrapped in .json (scripts/3d/glb-to-json.mjs) so any host serves them
const ASSETS = import.meta.glob('../assets/3d/**/*.{json,webp}', { eager: true, query: '?url', import: 'default' });
const asset = (name) => ASSETS[`../assets/3d/${name}`];

export const T = 2.5; // metres per tile
export const RING = 7; // tiles of scenery around the park (same as the 2D map)

// Monsters: height (m), how it stands, which clips to play.
const MONSTERS = {
  dragonnet: { height: 2.2, walk: 'Walk', idle: 'Idle' },
  golem: { height: 3.4, walk: 'Walk', idle: 'Idle' },
  kraken: { height: 2.4, walk: 'Crawl', idle: 'Idle', sink: 0.45 }, // swims, sunk to the eyes
  spectre: { height: 2.5, walk: 'Float', idle: 'Idle', hover: 0.35 },
  yeti: { height: 3.0, walk: 'Walk', idle: 'Idle' },
};
const VISITOR_MODELS = ['person-men-casual_2', 'person-women-casual', 'person-men-suit', 'person-women-formal'];
const KEEPER_MODEL = 'person-men-worker';

// Ground textures: file, metres covered by one copy of the texture, tint.
const GROUNDS = {
  grass: { tex: 'grass', size: 4, tint: 0xdcf0cc },
  path: { tex: 'path', size: 2.5, tint: 0xe2dcd0 },
  lava: { tex: 'lava', size: 6, tint: 0xb0a8a4, emissive: 'lava-e' },
  dark: { tex: 'dark', size: 4, tint: 0xb6aec4 },
  forest: { tex: 'forest', size: 5, tint: 0xd0d8c4 },
  ice: { tex: 'ice', size: 6, tint: 0xe4eefa },
  // the habitats not offered yet borrow a texture of the visible ones
  ash: { tex: 'dark', size: 5, tint: 0x8c8884 },
  basalt: { tex: 'dark', size: 6, tint: 0x9a8070 },
  graveyard: { tex: 'forest', size: 5, tint: 0x8e8a7a },
  ruins: { tex: 'path', size: 3, tint: 0xc8c4b4 },
  crystal: { tex: 'dark', size: 5, tint: 0x9088a8 },
  tundra: { tex: 'ice', size: 5, tint: 0xffffff },
  summit: { tex: 'ice', size: 6, tint: 0xd9e2ee },
};
// water habitats: colour of the water
const WATERS = { water: 0x1f6474, reef: 0x1f7a7c, abyss: 0x0a1a2c, swamp: 0x3a4226 };

export class ParkScene {
  // `scene`: the (hidden) Phaser GameScene, for where the monsters wander; may come later (setScene).
  constructor(world, scene = null) {
    this.world = world;
    this.scene = scene;
    this.people = new Map(); // id -> { obj, mixer, actions, current, last }
    this.monsters = new Map();
    this.models = new Map(); // file -> Promise<{ scene, animations, box }>
    this.texCache = new Map();
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
    this.buildTrees();
    this.lastGrid = this.world.grid.version;
  }

  setScene(scene) {
    this.scene = scene;
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
    const tx = new THREE.TextureLoader().load(asset(`tex/${name}.webp`));
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
    const m = new THREE.MeshStandardMaterial({
      map: this.tex(d.tex), normalMap: this.tex(`${d.tex}-n`, false), color: d.tint, roughness: 0.95,
    });
    if (d.emissive) {
      m.emissiveMap = this.tex(d.emissive);
      m.emissive = new THREE.Color(0xff5a10);
      m.emissiveIntensity = 3;
      this.lavaMats = [...(this.lavaMats ?? []), m];
    }
    return m;
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
      old.traverse((o) => o.geometry?.dispose());
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
    const lawn = [];
    for (let ty = -RING; ty < grid.h + RING; ty++) for (let tx = -RING; tx < grid.w + RING; tx++) if (!isWater(tx, ty)) lawn.push({ tx, ty });
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
          color: WATERS[k], roughness: 0.06, metalness: 0, transmission: 0, normalMap: n, normalScale: new THREE.Vector2(0.6, 0.6),
          transparent: true, opacity: 0.88, envMapIntensity: 1.2,
        });
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
      const mesh = new THREE.Mesh(this.quads(tiles, 0.015, GROUNDS[k].size), this.mats.get(k));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
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
    const wood = new THREE.MeshStandardMaterial({ color: 0x9b7653, roughness: 0.8 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.7 });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      return m;
    };
    for (const b of this.world.builder.buildings.values()) {
      const cx = ((b.x0 + b.x1) / 2) * T, cz = ((b.y0 + b.y1) / 2) * T;
      if (b.type === 'snack') {
        // two stands, picked from the building id: the Kraken's waffles or the Dragon's grill
        const n = Number(String(b.id).replace(/\D/g, '')) || 0;
        // (the waffle stand's counter is on its +z side, the grill's on its +x side)
        const [model, front] = n % 2 ? ['stand-kraken-waffles', 0] : ['stand-dragon-grill', -Math.PI / 2];
        this.placeModel(group, model, cx, cz, 2.4, this.faceToPath(b) + front, b.id);
      } else if (b.type === 'souvenir') {
        this.placeModel(group, 'fabrique-a-monstres', cx, cz, 2.6, this.faceToPath(b), b.id);
      } else if (b.type === 'hatchery') {
        this.placeIncubator(group, cx, cz, b.id);
      } else if (b.type === 'expeditionBase') {
        this.placeModel(group, 'expedition-base', cx, cz, 4.8, this.faceToPath(b), b.id);
      } else {
        // a garden decoration: a round bush in flowers
        add(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshStandardMaterial({ color: 0x4f7d3a, roughness: 0.9, flatShading: true }), cx, 0.7, cz)
          .userData.buildingId = b.id;
      }
    }
    // the entrance gate
    const { tx, ty } = this.world.entrance;
    const ex = tx * T, ez = ty * T;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, 3.6, 0.5), white, ex + s * 1.5, 1.8, ez);
    add(new THREE.BoxGeometry(3.6, 0.7, 0.2), wood, ex, 3.4, ez);
  }

  // A building model on its tiles: `width` metres across (its widest side), turned by `rot` (radians),
  // standing on the ground. Loaded in the background. `id`: the building's, for clicks.
  placeModel(group, name, cx, cz, width, rot = 0, id = null) {
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
      const s = 4.4 / Math.max(size.x, size.z); // a little smaller than its 5 m square
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

  buildTrees() {
    const { grid } = this.world;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pines = [], oaks = [];
    for (let ty = -RING; ty < grid.h + RING; ty += 2) {
      for (let tx = -RING; tx < grid.w + RING; tx += 2) {
        const out = Math.max(-tx, -ty, tx - grid.w + 1, ty - grid.h + 1);
        if (out < 2) continue;
        if (rnd() > 0.35 + out * 0.1) continue;
        const x = (tx + rnd() * 0.8) * T, z = (ty + rnd() * 0.8) * T;
        (rnd() < 0.5 ? pines : oaks).push([x, z, 0.8 + rnd() * 0.6, rnd() * 6.28]);
      }
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 1 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2f5a37, roughness: 1, flatShading: true });
    const oakMat = new THREE.MeshStandardMaterial({ color: 0x4d7a35, roughness: 1, flatShading: true });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const make = (geo, mat, list, y, sx = 1) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, s, r], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
        im.setMatrixAt(i, m4.compose(p.set(x, y * s, z), q, sc.set(s * sx, s, s * sx)));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.s3.add(im);
    };
    make(new THREE.CylinderGeometry(0.18, 0.28, 2.4, 6), trunkMat, [...pines, ...oaks], 1.2);
    make(new THREE.ConeGeometry(1.9, 5.5, 7), pineMat, pines, 4.6);
    make(new THREE.ConeGeometry(1.4, 3.6, 7), pineMat, pines, 6.6);
    make(new THREE.IcosahedronGeometry(2.4, 1), oakMat, oaks, 4.2, 1.1);
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
          return { scene: g.scene, animations: g.animations, box };
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
      if (d > 0.002) {
        const target = Math.atan2(dx, dz);
        let diff = target - e.obj.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        e.obj.rotation.y += diff * Math.min(1, dt * 8);
      }
      e.moving = (e.moving ?? 0) * 0.8 + (speed > 0.15 ? 0.2 : 0);
      e.obj.visible = it.visible !== false;
      this.play(e, e.moving > 0.5 ? it.walk : it.idle);
      if (e.actions?.[it.walk]) e.actions[it.walk].timeScale = it.walkScale ?? 1;
      e.mixer.update(dt);
    }
    for (const [id, e] of map) {
      if (seen.has(id)) continue;
      if (e.obj) this.s3.remove(e.obj);
      map.delete(id);
    }
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
        visible: (entry?.hideK ?? 1) > 0.3,
      });
    }
    this.sync(this.monsters, items, (it) => this.spawn(it.species, MONSTERS[it.species].height * (0.9 + Math.random() * 0.2)), dt);
  }

  syncPeople(dt) {
    const px = this.focus.x, pz = this.focus.z, r = this.viewPeople;
    const near = (x, y) => Math.hypot(x * T - px, y * T - pz) < r;
    const items = [];
    for (const v of this.world.visitors) {
      if (v.state === 'gone' || !v.pos || !near(v.pos.x, v.pos.y)) continue;
      const k = [...v.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
      items.push({ id: v.id, kind: 'visitor', x: v.pos.x, y: v.pos.y, model: VISITOR_MODELS[k % VISITOR_MODELS.length], walk: v.state === 'fleeing' ? 'Run' : 'Walk', idle: 'Idle', h: 1.62 + (k % 7) * 0.04 });
    }
    for (const kp of this.world.keepers) {
      if (!kp.pos || !near(kp.pos.x, kp.pos.y)) continue;
      items.push({ id: kp.id, kind: 'keeper', x: kp.pos.x, y: kp.pos.y, model: KEEPER_MODEL, walk: kp.state === 'chasing' ? 'Run' : 'Walk', idle: 'Idle', h: 1.8 });
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
    }
    this.syncMonsters(dt);
    this.syncPeople(dt);
    this.updateEggs(time);
    // living grounds: water ripples, glowing lava breathing
    if (this.waterNormal) this.waterNormal.offset.set(time * 0.012, time * 0.007);
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
