// "Visite 3D": walk through the museum as a visitor, in first person, in real 3D (three.js).
// The 3D scene is built from the live world (src/sim): lawn, paths, enclosure grounds, walls with iron
// railings (or glass where a path runs along), buildings, the forest around; the real 3D monsters
// (src/assets/3d/*.glb, compressed copies of models/*.glb) walk where the 2D game puts them, visitors and
// keepers too. The game keeps running underneath (money, visitors, monsters...).
//
// Controls: Z Q S D / W A S D / arrows to walk, Shift to run, mouse to look around (click to capture the
// mouse), on touch screens: left thumb to walk, right thumb to look. Échap (or the button) to leave.
//
// This module and everything it loads are only downloaded when the visit starts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { tilesOf, containsTile } from '../sim/enclosure.js';
import { HABITAT_FAMILY } from '../config/species.js';
import { t } from '../i18n/index.js';
import { BALANCE } from '../config/balance.js';

// models: .glb files wrapped in .json (scripts/3d/glb-to-json.mjs) so any host serves them
const ASSETS = import.meta.glob('../assets/3d/**/*.{json,webp}', { eager: true, query: '?url', import: 'default' });
const asset = (name) => ASSETS[`../assets/3d/${name}`];

const T = 2.5; // metres per tile
const RING = 7; // tiles of scenery around the park (same as the 2D map)
const EYE = 1.65;
const WALK = 1.7, RUN = 4.2; // m / s
const BODY = 0.3; // player radius (m)
const VIEW_PEOPLE = 70; // m: people further away are not drawn

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

let running = null;

export async function startVisit(scene) {
  if (running) return;
  running = new Visit(scene);
  window.__visit = running; // for the automated checks
  try {
    await running.start();
  } catch (err) {
    // keep the page open with the reason, so the player sees what went wrong (and can leave)
    console.error(err);
    running?.status(`${t('visit.error')} (${err?.message ?? err})`);
  }
}

class Visit {
  constructor(scene) {
    this.scene = scene;
    this.world = scene.world;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.people = new Map(); // id -> { obj, mixer, actions, current, last }
    this.monsters = new Map();
    this.models = new Map(); // file -> Promise<{ scene, animations }>
    this.texCache = new Map();
    this.disposables = [];
    this.clock = new THREE.Clock();
    this.touch = { move: null, look: null };
  }

  // ---------------------------------------------------------------- setup

  async start() {
    this.buildDom();
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.root.prepend(r.domElement);
    this.canvas = r.domElement;

    this.s3 = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
    this.s3.fog = new THREE.Fog(0xcfe0ea, 60, 210);

    this.loader = new GLTFLoader();
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildWalls();
    this.buildBuildings();
    this.buildTrees();
    this.placePlayer();
    this.bindInput();
    this.status(t('visit.loading'));
    this.lastGrid = this.world.grid.version;

    this.onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(() => this.frame());
    // the models come in the background; the walk can start at once
    const names = [...Object.keys(MONSTERS), ...VISITOR_MODELS, KEEPER_MODEL];
    const results = await Promise.allSettled(names.map((n) => this.model(n)));
    const failed = results.filter((r) => r.status === 'rejected');
    for (const r of failed) console.error(r.reason);
    this.status(failed.length ? t('visit.modelsFailed', { n: failed.length }) : null);
  }

  buildDom() {
    const root = (this.root = document.createElement('div'));
    root.className = 'visit3d';
    root.innerHTML = `
      <div class="visit-top">
        <span class="visit-title">${t('visit.title')}</span>
        <span class="visit-help">${t('visit.help')}</span>
        <button data-exit>${t('visit.exit')}</button>
      </div>
      <div class="visit-status"></div>
      <div class="visit-cross"></div>
      <div class="visit-stick"><div class="visit-knob"></div></div>`;
    const style = document.createElement('style');
    style.textContent = `
      .visit3d { position: fixed; inset: 0; z-index: 50; background: #cfe0ea; touch-action: none; user-select: none; }
      .visit3d canvas { display: block; width: 100%; height: 100%; }
      .visit-top { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center;
        background: rgba(20, 24, 28, .6); color: #eee; padding: 6px 12px; border-radius: 10px; font: 13px system-ui, sans-serif; width: max-content; max-width: calc(100% - 32px); }
      .visit-title { font-weight: 600; }
      .visit-help { opacity: .8; transition: opacity 1s; }
      .visit-help.gone { opacity: 0; width: 0; overflow: hidden; white-space: nowrap; }
      .visit-top button { background: #3a3f46; color: #fff; border: 1px solid #555; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer; }
      .visit-status { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); color: #fff; background: rgba(20,24,28,.7);
        padding: 6px 12px; border-radius: 8px; font: 14px system-ui, sans-serif; display: none; }
      .visit-cross { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255,255,255,.7); box-shadow: 0 0 2px #000; }
      .visit-stick { position: absolute; left: 24px; bottom: 24px; width: 110px; height: 110px; border-radius: 50%; background: rgba(255,255,255,.15);
        border: 2px solid rgba(255,255,255,.35); display: none; }
      .visit-knob { position: absolute; left: 35px; top: 35px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,.55); }
      @media (pointer: coarse) { .visit-stick { display: block; } .visit-help { display: none; } }`;
    root.appendChild(style);
    document.body.appendChild(root);
    root.querySelector('[data-exit]').addEventListener('click', () => this.stop());
    setTimeout(() => root.querySelector('.visit-help')?.classList.add('gone'), 12000);
  }

  status(text) {
    const el = this.root?.querySelector('.visit-status');
    if (!el) return;
    el.style.display = text ? 'block' : 'none';
    el.textContent = text ?? '';
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
      old.traverse((o) => o.geometry?.dispose());
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
      if (b.type === 'snack' || b.type === 'souvenir') {
        const colour = b.type === 'snack' ? '#c0392b' : '#2e6fb0';
        add(new THREE.BoxGeometry(1.8, 2.2, 1.6), wood, cx, 1.1, cz);
        add(new THREE.BoxGeometry(1.9, 0.12, 0.5), white, cx, 1.05, cz + 0.95); // counter
        const awning = add(new THREE.BoxGeometry(2.3, 0.08, 1.2), new THREE.MeshStandardMaterial({ map: this.stripes(colour, '#f6f1e7'), roughness: 0.8 }), cx, 2.45, cz + 0.4);
        awning.rotation.x = 0.25;
        add(new THREE.BoxGeometry(2, 0.5, 1.8), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7 }), cx, 2.45, cz - 0.2);
      } else if (b.type === 'hatchery') {
        this.placeIncubator(group, cx, cz);
      } else if (b.type === 'expeditionBase') {
        const tent = add(new THREE.ConeGeometry(2, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0xc9b99a, roughness: 0.9 }), cx, 1.2, cz);
        tent.rotation.y = Math.PI / 4;
        add(new THREE.CylinderGeometry(0.03, 0.03, 3.2), wood, cx + 1.9, 1.6, cz - 1.2);
        add(new THREE.BoxGeometry(0.6, 0.4, 0.02), new THREE.MeshStandardMaterial({ color: 0xc0392b }), cx + 2.2, 3, cz - 1.2);
      } else {
        // a garden decoration: a round bush in flowers
        add(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshStandardMaterial({ color: 0x4f7d3a, roughness: 0.9, flatShading: true }), cx, 0.7, cz);
      }
    }
    // the entrance gate
    const { tx, ty } = this.world.entrance;
    const ex = tx * T, ez = ty * T;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, 3.6, 0.5), white, ex + s * 1.5, 1.8, ez);
    add(new THREE.BoxGeometry(3.6, 0.7, 0.2), wood, ex, 3.4, ez);
  }

  // The incubator (models/incubator.glb, 5 places for eggs: nodes EggSlot_01..05) on its 2 x 2 tiles.
  placeIncubator(group, cx, cz) {
    this.eggSlots = [];
    this.eggs3d = new Map();
    this.model('incubator').then((m) => {
      if (this.buildGroup !== group) return; // rebuilt meanwhile
      const inc = m.scene.clone(true);
      const size = m.box.getSize(new THREE.Vector3());
      const s = 4.4 / Math.max(size.x, size.z); // a little smaller than its 5 m square
      inc.scale.setScalar(s);
      inc.position.set(cx, -m.box.min.y * s, cz);
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
          Object.assign(e, body, { loading: false });
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
      const entry = this.scene.entitySprites.get(m.id);
      const p = m.state === 'enclosed' && entry?.w ? entry.w : m.pos;
      if (!p) continue;
      const e = m.enclosureId && this.world.builder.enclosures.get(m.enclosureId);
      const inWater = e && HABITAT_FAMILY[e.habitat] === 'water';
      const y3 = (look.hover ?? 0) - (inWater && look.sink ? look.sink * look.height : 0);
      items.push({
        id: m.id, x: p.x, y: p.y, y3, species: m.speciesId, walk: look.walk, idle: look.idle,
        visible: (entry?.hideK ?? 1) > 0.3,
      });
    }
    this.sync(this.monsters, items, (it) => this.spawn(it.species, MONSTERS[it.species].height * (0.9 + Math.random() * 0.2)), dt);
  }

  syncPeople(dt) {
    const px = this.pos.x, pz = this.pos.z;
    const near = (x, y) => Math.hypot(x * T - px, y * T - pz) < VIEW_PEOPLE;
    const items = [];
    for (const v of this.world.visitors) {
      if (v.state === 'gone' || !v.pos || !near(v.pos.x, v.pos.y)) continue;
      const k = [...v.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
      items.push({ id: v.id, x: v.pos.x, y: v.pos.y, model: VISITOR_MODELS[k % VISITOR_MODELS.length], walk: v.state === 'fleeing' ? 'Run' : 'Walk', idle: 'Idle', h: 1.62 + (k % 7) * 0.04 });
    }
    for (const kp of this.world.keepers) {
      if (!kp.pos || !near(kp.pos.x, kp.pos.y)) continue;
      items.push({ id: kp.id, x: kp.pos.x, y: kp.pos.y, model: KEEPER_MODEL, walk: kp.state === 'chasing' ? 'Run' : 'Walk', idle: 'Idle', h: 1.8 });
    }
    this.sync(this.people, items, (it) => this.spawn(it.model, it.h), dt);
  }

  // ---------------------------------------------------------------- player

  placePlayer() {
    const { tx, ty } = this.world.entrance;
    this.pos = new THREE.Vector3(tx * T, 0, (ty + 1.2) * T);
    this.yaw = 0; // looking into the park (towards -z)
    this.bob = 0;
  }

  walkable(x, z) {
    const { grid } = this.world;
    const tx = Math.round(x / T), ty = Math.round(z / T);
    if (tx < -RING + 1 || ty < -RING + 1 || tx > grid.w + RING - 2 || ty > grid.h + RING - 2) return false;
    if (!grid.inBounds(tx, ty)) return true; // the lawn around the park
    return !grid.getTile(tx, ty).occupant;
  }

  free(x, z) {
    return [[BODY, 0], [-BODY, 0], [0, BODY], [0, -BODY]].every(([a, b]) => this.walkable(x + a, z + b));
  }

  movePlayer(dt) {
    const k = this.keys;
    let f = 0, s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyA')) s -= 1;
    if (k.has('KeyD')) s += 1;
    if (k.has('ArrowLeft')) this.yaw += dt * 2;
    if (k.has('ArrowRight')) this.yaw -= dt * 2;
    if (this.touch.move) { f -= this.touch.move.dy; s += this.touch.move.dx; }
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') || (this.touch.move && Math.hypot(this.touch.move.dx, this.touch.move.dy) > 0.9) ? RUN : WALK);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // forward
    const rx = -fz, rz = fx; // right
    const dx = (fx * f + rx * s) * speed * dt, dz = (fz * f + rz * s) * speed * dt;
    // slide along walls: try each axis on its own
    if (this.free(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    if (this.free(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
    const moving = Math.hypot(dx, dz) > 1e-4;
    this.bob = moving ? this.bob + dt * speed * 2.2 : this.bob * 0.9;
    this.camera.position.set(this.pos.x, EYE + Math.sin(this.bob) * 0.035, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  bindInput() {
    const c = this.canvas;
    this.onKeyDown = (e) => {
      if (e.code === 'Escape') {
        if (document.pointerLockElement !== c) this.stop();
        return;
      }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      e.stopPropagation();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    const look = (mx, my, k) => {
      this.yaw -= mx * k;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - my * k));
    };
    this.onMouseMove = (e) => {
      if (document.pointerLockElement === c) look(e.movementX, e.movementY, 0.0024);
      else if (this.dragging) look(e.movementX, e.movementY, 0.005);
    };
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      // capture the mouse (some browsers / embedded pages refuse: then dragging looks around)
      try { c.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag instead */ }
    });
    this.onMouseUp = () => { this.dragging = false; };
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    // touch: left half = stick (walk), right half = look
    const stick = this.root.querySelector('.visit-stick'), knob = this.root.querySelector('.visit-knob');
    this.ids = {};
    c.addEventListener('touchstart', (e) => {
      for (const tch of e.changedTouches) {
        if (tch.clientX < window.innerWidth / 2 && !this.touch.move) {
          const r = stick.getBoundingClientRect();
          this.ids.move = tch.identifier;
          this.touch.move = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0 };
        } else if (!this.touch.look) {
          this.ids.look = tch.identifier;
          this.touch.look = { x: tch.clientX, y: tch.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === this.ids.move && this.touch.move) {
          const m = this.touch.move;
          let dx = (tch.clientX - m.cx) / 50, dy = (tch.clientY - m.cy) / 50;
          const l = Math.hypot(dx, dy);
          if (l > 1.2) { dx *= 1.2 / l; dy *= 1.2 / l; }
          m.dx = dx; m.dy = dy;
          knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
        } else if (tch.identifier === this.ids.look && this.touch.look) {
          look(tch.clientX - this.touch.look.x, tch.clientY - this.touch.look.y, 0.006);
          this.touch.look = { x: tch.clientX, y: tch.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === this.ids.move) { this.touch.move = null; knob.style.transform = ''; }
        if (tch.identifier === this.ids.look) this.touch.look = null;
      }
    };
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);
  }

  // ---------------------------------------------------------------- loop

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    // the park changed (built, demolished): rebuild the static parts
    if (this.world.grid.version !== this.lastGrid) {
      this.lastGrid = this.world.grid.version;
      this.buildGround();
      this.buildWalls();
      this.buildBuildings();
    }
    this.movePlayer(dt);
    this.syncMonsters(dt);
    this.syncPeople(dt);
    this.updateEggs(time);
    // living grounds: water ripples, glowing lava breathing
    if (this.waterNormal) this.waterNormal.offset.set(time * 0.012, time * 0.007);
    for (const m of this.lavaMats ?? []) m.emissiveIntensity = 3 + Math.sin(time * 1.3) * 0.5 + Math.sin(time * 3.1) * 0.15;
    // the sun's shadows follow the player
    this.sun.target.position.set(this.pos.x, 0, this.pos.z);
    this.sun.position.copy(this.sunDir).multiplyScalar(80).add(this.sun.target.position);
    this.renderer.render(this.s3, this.camera);
  }

  stop() {
    if (running !== this) return;
    running = null;
    this.renderer?.setAnimationLoop(null);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('resize', this.onResize);
    if (document.pointerLockElement) document.exitPointerLock();
    this.s3?.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    for (const tx of this.texCache.values()) tx.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.root?.remove();
  }
}
