import Phaser from 'phaser';
import { tileToScreen, screenToTile } from '../sim/iso.js';
import { generateTextures } from './textures.js';
import {
  preloadSprites, resolveMonsterTexture, realKey, directionIndex,
  createAnimations, hasAnimation, hasFlyAnimation, hasThreatAnimation, idleActions, directionalOriginY,
  visitorLook, hasPerson, personDirection, PERSON_ORIGIN_Y, monsterFx, MONSTER_EVENTS,
} from './sprites.js';
import { createWanderer, stepWander, findFreeSpot } from './wander.js';
import { MonsterFX } from './monsterfx.js';
import { BALANCE } from '../config/balance.js';
import { Sounds } from './sound.js';
import { ENCLOSURE_DECOR } from '../config/decor.js';
import { HABITAT_FAMILY, habitatFits } from '../config/species.js';
import { rectsOf, tilesOf, containsTile } from '../sim/enclosure.js';

const DECOR_IDS = Object.keys(ENCLOSURE_DECOR); // order of the cells of the decoration atlas

// Footprint of each monster on the ground (tile units), used to keep them from overlapping.
// Enclosure decoration images (scripts/render-model/decor.html): size, ground row, number of variants;
// DECOR_RADIUS: room they take for the monsters walking around them (tile units).
const DECOR_IMG = { w: 128, h: 192, groundY: 150 };
const DECOR_VARIANTS = 2;
const DECOR_RADIUS = 0.32;
// Shelter images (scripts/render-model/render-decor.mjs: SHELTER_FRAME): size and ground row of the centre of
// its 2 x 2 tiles; SHELTER_RADIUS: room it takes for the monsters; SHELTER_ENTRANCE: where the entrance is
// (tile y of the monster resting in it, from the shelter's first tile).
const SHELTER_IMG = { w: 288, h: 320, groundY: 230 };
const SHELTER_RADIUS = 0.8;
const SHELTER_ENTRANCE = 1.15;
// Colour of the eyes glowing in the dark of a shelter.
const EYES = { dragonnet: 0xffa040, kraken: 0xfff070, spectre: 0x9fe6ff, golem: 0xffc850, yeti: 0x8fd0ff };
// Display scale of the 3D people (128 px frames) and how long a happy visitor waves (game seconds).
const PERSON_SCALE = 0.5;
const WAVE_SECONDS = 2.1;
// Size of the barrier renders (scripts/render-model/fence.html) and the row where the ground is.
const FENCE_IMG = { w: 128, h: 192, groundY: 134 };
// Game seconds of plain idling between two idle actions (wing flap, look around...).
const IDLE_ACTION_GAP = [4, 12];
const MONSTER_RADIUS = { dragonnet: 0.6, kraken: 0.6, spectre: 0.4, golem: 0.45, yeti: 0.45 };
import { capacity } from '../sim/breeding.js';

const GROUND_DEPTH = -1e6;
const GROUND_ANIM_FPS = 7; // frames per second of the animated grounds
// Small 3D details scattered on the enclosure grounds, per habitat (none on lava, water, snow).
const ENCLOSURE_GROUND_DETAIL = {
  forest: { kinds: ['img-grass-tuft', 'img-grass-tuft', 'img-grass-tuftDry', 'img-grass-pebbles'], chance: 0.4 },
  ruins: { kinds: ['img-grass-tuft', 'img-grass-tuftDry', 'img-grass-pebbles'], chance: 0.25 },
  dark: { kinds: ['img-grass-pebbles', 'img-grass-tuftDry'], chance: 0.14 },
  graveyard: { kinds: ['img-grass-tuftDry', 'img-grass-tuftDry', 'img-grass-pebbles'], chance: 0.3 },
};
const FENCE_DEPTH = -5e5;
const GHOST_DEPTH = 1e6;
const FENCE_COLOR = 0x8a6038;
const FENCE_SHADE = 0x3e2a17;

// Draws the World and turns pointer input into World / Builder calls.
// The current tool is set by the DOM UI through setTool().
export class GameScene extends Phaser.Scene {
  constructor(world, ui) {
    super('game');
    this.world = world;
    this.ui = ui;
    this.tool = { type: 'select' };
  }

  preload() {
    preloadSprites(this);
  }

  create() {
    generateTextures(this);
    createAnimations(this);
    const { grid } = this.world;

    this.tileImages = [];
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        const p = tileToScreen(tx, ty);
        this.tileImages.push(this.add.image(p.x, p.y, 'tile-grass').setDepth(GROUND_DEPTH));
      }
    }
    this.fences = this.add.graphics().setDepth(FENCE_DEPTH);
    this.fenceSprites = [];
    this.ghost = this.add.graphics().setDepth(GHOST_DEPTH);
    this.buildingSprites = new Map();
    this.entitySprites = new Map(); // id -> { sprite, bubble, kind }
    this.fx = new MonsterFX(this); // extra effects of some monsters (ghost mist, crossfades, golem dust)
    this.sounds = new Sounds(this); // synthesized sound effects (src/render/sound.js)
    this.lastGridVersion = -1;
    this.createSurroundings();

    this.cameras.main.setZoom(1.2);
    this.centerView();
    this.scale.on('resize', () => {
      if (!this.userMovedCamera) this.centerView();
    });

    this.setupInput();
    this.ui.bindScene(this);
  }

  // Static scenery around the playable grid: grass ring, a forest edge and the entrance gate.
  // Purely visual; uses the Blender renders when they are loaded.
  createSurroundings() {
    const { grid, entrance } = this.world;
    const has = (k) => this.textures.exists(k);
    const RING = 7;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let ty = -RING; ty < grid.h + RING; ty++) {
      for (let tx = -RING; tx < grid.w + RING; tx++) {
        if (grid.inBounds(tx, ty)) continue;
        const p = tileToScreen(tx, ty);
        const sheet = this.groundTile('grass', tx, ty);
        if (sheet) this.add.image(p.x, p.y, sheet.key, sheet.frame).setDisplaySize(66, 33).setDepth(GROUND_DEPTH);
        else this.add.image(p.x, p.y, realKey(this, this.grassKey(tx, ty))).setDisplaySize(66, 33).setDepth(GROUND_DEPTH);
        this.addGrassDetail(tx, ty, null);
      }
    }
    // forest edge: trees on every other cell of the ring, denser further out
    if (has('img-prop-pine') && has('img-prop-oak')) {
      for (let ty = -RING; ty < grid.h + RING; ty += 2) {
        for (let tx = -RING; tx < grid.w + RING; tx += 2) {
          const out = Math.max(-tx, -ty, tx - grid.w + 1, ty - grid.h + 1); // distance outside the grid
          if (out < 2) continue;
          if (rnd() > 0.35 + out * 0.1) continue;
          const jx = tx + rnd() * 0.8, jy = ty + rnd() * 0.8;
          const c = tileToScreen(jx + 0.5, jy + 0.5);
          const key = rnd() < 0.55 ? 'img-prop-pine' : 'img-prop-oak';
          const s = 0.85 + rnd() * 0.35;
          this.add.image(c.x, c.y + 32 * s, key).setOrigin(0.5, 1).setDisplaySize(128 * s, 192 * s).setDepth(c.y);
        }
      }
    }
    if (has('img-prop-gate')) {
      const c = tileToScreen(entrance.tx, entrance.ty);
      this.add.image(c.x, c.y + 16, 'img-prop-gate').setOrigin(0.5, 1).setDisplaySize(64, 128).setDepth(c.y + 1);
    }
  }

  // Stable pseudo-random number for a tile (same tile -> same value every time).
  static tileHash(tx, ty, salt = 0) {
    let h = (Math.imul(tx + 1000, 73856093) ^ Math.imul(ty + 1000, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h % 10000) / 10000;
  }

  // One of the realistic grass variants (procedural fallback when renders are missing).
  // Soft shade on the enclosure ground along its walls (contact shadow, and the walls' own shadow on
  // the sides the sun comes from: upper left), so the ground sits under the walls instead of looking
  // like a picture laid on the map. One image per wall side touching the tile.
  drawEnclosureShade() {
    for (const im of this.wallShade || []) im.destroy();
    this.wallShade = [];
    // side: [dx, dy] towards the wall; sun side walls (-x, -y) cast a longer, darker shade
    const SIDES = { n: [0, -1, 0.75, 0.55], e: [1, 0, 0.4, 0.32], s: [0, 1, 0.4, 0.32], w: [-1, 0, 0.75, 0.55] };
    for (const [side, [dx, dy, width, dark]] of Object.entries(SIDES)) {
      const key = `wall-shade-${side}`;
      if (this.textures.exists(key)) continue;
      const W = 128, H = 64;
      const c = this.textures.createCanvas(key, W, H);
      const ctx = c.getContext();
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // screen pixel -> tile coordinates (u along x, v along y), each in -0.5 .. 0.5
          const sx = (x + 0.5 - W / 2) / (W / 2), sy = (y + 0.5 - H / 2) / (H / 2);
          const u = (sx + sy) / 2, v = (sy - sx) / 2;
          if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) continue; // edge to edge: an overlap would darken a line
          const d = 0.5 + (dx ? -dx * u : -dy * v); // distance from the wall side, in tiles
          const a = Math.max(0, 1 - d / width);
          img.data[(y * W + x) * 4 + 3] = Math.round(a * a * dark * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      c.refresh();
    }
    for (const e of this.world.builder.enclosures.values()) {
      for (const { tx, ty } of tilesOf(e)) {
        const p = tileToScreen(tx, ty);
        const on = { n: !containsTile(e, tx, ty - 1), s: !containsTile(e, tx, ty + 1), w: !containsTile(e, tx - 1, ty), e: !containsTile(e, tx + 1, ty) };
        for (const side of Object.keys(on)) {
          if (on[side]) this.wallShade.push(this.add.image(p.x, p.y, `wall-shade-${side}`).setDisplaySize(64, 32).setDepth(GROUND_DEPTH + 1));
        }
      }
    }
  }

  // A tile of a photo-realistic ground sheet (scripts/render-model/render-ground.mjs): the sheet holds a
  // block of n x n tiles that fit together (row = y), the map picks tile (tx mod n, ty mod n).
  // null when the sheet is not there (then the older single tiles are used).
  // An animated ground ("-anim" atlas: frame f is a block at column f % 4, row f / 4) comes with `anim`,
  // for animateGround.
  groundTile(name, tx, ty) {
    const animKey = `img-tile-${name}-anim`;
    if (this.textures.exists(animKey)) {
      const src = this.textures.get(animKey).getSourceImage();
      const n = src.width / 4 / 128, frames = 4 * Math.round(src.height / 64 / n);
      const anim = { n, frames, bx: ((tx % n) + n) % n, by: ((ty % n) + n) % n };
      return { key: animKey, frame: GameScene.animFrame(anim, this.groundFrame ?? 0), anim };
    }
    const key = `img-tile-${name}-sheet`;
    if (!this.textures.exists(key)) return null;
    const n = Math.round(Math.sqrt(this.textures.get(key).frameTotal - 1)); // frameTotal counts __BASE
    return { key, frame: (((ty % n) + n) % n) * n + (((tx % n) + n) % n) }; // tx, ty < 0 around the park
  }

  static animFrame({ n, frames, bx, by }, f) {
    f %= frames;
    return (Math.floor(f / 4) * n + by) * 4 * n + (f % 4) * n + bx;
  }

  // Moves the animated grounds (flowing lava, moving water) to the frame of this moment.
  animateGround(time) {
    if (!this.animTiles?.length) return;
    const f = Math.floor(time / (1000 / GROUND_ANIM_FPS));
    if (f === this.groundFrame) return;
    this.groundFrame = f;
    for (const { img, anim } of this.animTiles) img.setFrame(GameScene.animFrame(anim, f));
  }

  grassKey(tx, ty) {
    if (!this.grassVariants) {
      this.grassVariants = ['tile-grass', 'tile-grass2', 'tile-grass3', 'tile-grass4'].filter((k) => this.textures.exists(`img-${k}`));
    }
    if (!this.grassVariants.length) return (tx * 7 + ty * 13) % 5 === 0 ? 'tile-grass2' : 'tile-grass';
    return this.grassVariants[Math.floor(GameScene.tileHash(tx, ty) * this.grassVariants.length)];
  }

  // A small tuft, wild flowers or pebbles on some grass tiles, to break the flat lawn.
  // kinds / chance: other sets for the enclosure grounds (ENCLOSURE_GROUND_DETAIL).
  addGrassDetail(tx, ty, list, kinds = ['img-grass-tuft', 'img-grass-tuft', 'img-grass-tuftDry', 'img-grass-wildflowers', 'img-grass-pebbles'], chance = 0.22) {
    if (GameScene.tileHash(tx, ty, 1) > chance) return;
    const key = kinds[Math.floor(GameScene.tileHash(tx, ty, 2) * kinds.length)];
    if (!this.textures.exists(key)) return;
    const jx = (GameScene.tileHash(tx, ty, 3) - 0.5) * 0.6, jy = (GameScene.tileHash(tx, ty, 4) - 0.5) * 0.6;
    const c = tileToScreen(tx + jx, ty + jy);
    const s = 0.55 + GameScene.tileHash(tx, ty, 5) * 0.4;
    const img = this.add.image(c.x, c.y, key).setDisplaySize(64 * s, 64 * s).setDepth(c.y - 2);
    if (list) list.push(img);
  }

  setTool(tool) {
    this.tool = tool;
    this.dragStart = null;
    this.ghost.clear();
  }

  // ---- frame ------------------------------------------------------------

  update(time, delta) {
    if (!this.centeredOnce) {
      this.centeredOnce = true;
      this.centerView();
    }
    this.world.tick(Math.min(delta / 1000, 1));
    for (const e of this.world.events.splice(0)) this.ui.onEvent(e);
    if (this.world.grid.version !== this.lastGridVersion) {
      this.lastGridVersion = this.world.grid.version;
      this.redrawGround();
    }
    this.animateGround(time);
    this.syncEntities(time, Math.min(delta / 1000, 0.1) * this.world.speed);
    this.moveCameraWithKeys(delta);
    this.ui.update();
  }

  redrawGround() {
    const { grid, builder } = this.world;
    this.animTiles = [];
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        const t = grid.getTile(tx, ty);
        let key = this.grassKey(tx, ty);
        let name = 'grass';
        const enc = t.occupant && builder.enclosures.get(t.occupant);
        if (t.ground === 'path') {
          const gate = tx === this.world.entrance.tx && ty === this.world.entrance.ty;
          key = gate ? 'tile-entrance' : 'tile-path';
          name = 'path'; // the gate tile too, when the paved sheet is there
        }
        if (enc) {
          key = `tile-${enc.habitat}`;
          name = enc.habitat;
        }
        const sheet = name && this.groundTile(name, tx, ty);
        let frame;
        if (sheet) ({ key, frame } = sheet);
        if (sheet?.anim) this.animTiles.push({ img: this.tileImages[ty * grid.w + tx], anim: sheet.anim });
        const img = this.tileImages[ty * grid.w + tx];
        const rk = realKey(this, key);
        // real tiles have soft anti-aliased edges: overlap them by a pixel so no seam shows
        const real = rk.startsWith('img-');
        img.setTexture(rk, frame).setDisplaySize(real ? 66 : 64, real ? 33 : 32);
      }
    }

    this.drawEnclosureShade();

    // grass details only on free lawn tiles (removed under paths, enclosures and buildings)
    for (const d of this.grassDetails || []) d.destroy();
    this.grassDetails = [];
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        if (grid.isFree(tx, ty)) this.addGrassDetail(tx, ty, this.grassDetails);
        else {
          // a few small 3D tufts and stones on some enclosure grounds, so they are not a flat picture
          const t = grid.getTile(tx, ty);
          const enc = t.occupant && builder.enclosures.get(t.occupant);
          const d = enc && ENCLOSURE_GROUND_DETAIL[enc.habitat];
          if (d && !builder.decorAt?.(tx, ty)) this.addGrassDetail(tx, ty, this.grassDetails, d.kinds, d.chance);
        }
      }
    }

    // fences: one 3D-rendered segment per tile edge, depth-sorted so monsters pass behind
    // the front edges; falls back to drawn lines when the renders are missing
    this.fences.clear();
    for (const s of this.fenceSprites) s.destroy();
    this.fenceSprites = [];
    this.drawDecor();
    const realFence = this.textures.exists('img-prop-fenceX') && this.textures.exists('img-prop-fenceY');
    const f = this.fences;
    for (const e of builder.enclosures.values()) {
      if (realFence) {
        // [edge middle x, y, axis, outside tile x, y]: a side that touches a path becomes a viewing window
        // one segment on every tile side that is not shared with another tile of the same enclosure
        // (two enclosures of the same habitat side by side are merged: no fence between them)
        const segs = [];
        for (const { tx, ty } of tilesOf(e)) {
          if (!containsTile(e, tx, ty - 1)) segs.push([tx, ty - 0.5, 'X', tx, ty - 1]);
          if (!containsTile(e, tx, ty + 1)) segs.push([tx, ty + 0.5, 'X', tx, ty + 1]);
          if (!containsTile(e, tx - 1, ty)) segs.push([tx - 0.5, ty, 'Y', tx - 1, ty]);
          if (!containsTile(e, tx + 1, ty)) segs.push([tx + 0.5, ty, 'Y', tx + 1, ty]);
        }
        const hasWindow = this.textures.exists('img-prop-windowX') && this.textures.exists('img-prop-windowY');
        for (const [mx, my, axis, ox, oy] of segs) {
          const c = tileToScreen(mx, my);
          const outside = grid.inBounds(ox, oy) && grid.getTile(ox, oy);
          const kind = hasWindow && outside && outside.ground === 'path' ? 'window' : 'fence';
          this.fenceSprites.push(this.add.image(c.x, c.y, `img-prop-${kind}${axis}`)
            .setOrigin(0.5, FENCE_IMG.groundY / FENCE_IMG.h).setDisplaySize(FENCE_IMG.w / 2, FENCE_IMG.h / 2).setDepth(c.y));
        }
        continue;
      }
      const corners = [[e.x0 - 0.5, e.y0 - 0.5], [e.x1 + 0.5, e.y0 - 0.5], [e.x1 + 0.5, e.y1 + 0.5], [e.x0 - 0.5, e.y1 + 0.5]];
      const posts = [];
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        for (let s = 0; s < steps; s++) posts.push(tileToScreen(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps));
      }
      for (const [h, w] of [[4, 3], [10, 3]]) {
        f.lineStyle(w + 2, FENCE_SHADE, 1);
        f.strokePoints(posts.map((p) => ({ x: p.x, y: p.y - h })), true);
        f.lineStyle(w, FENCE_COLOR, 1);
        f.strokePoints(posts.map((p) => ({ x: p.x, y: p.y - h - 0.5 })), true);
      }
      for (const p of posts) {
        f.fillStyle(FENCE_SHADE, 1);
        f.fillRect(p.x - 2.5, p.y - 15, 5, 16);
        f.fillStyle(FENCE_COLOR, 1);
        f.fillRect(p.x - 2.5, p.y - 15, 3, 15);
      }
    }

    const alive = new Set();
    for (const b of builder.buildings.values()) {
      alive.add(b.id);
      if (this.buildingSprites.has(b.id)) continue;
      const big = b.x1 > b.x0;
      const center = big ? tileToScreen(b.x0 + 0.5, b.y0 + 0.5) : tileToScreen(b.x0, b.y0);
      let key = realKey(this, b.type);
      if (b.type === 'decoration') {
        // several realistic decorations, picked from the building id so it never changes
        const variants = ['img-bld-decoration', 'img-prop-bush', 'img-prop-lamp', 'img-prop-bench', 'img-prop-flowers', 'img-prop-rock']
          .filter((k) => this.textures.exists(k));
        const n = Number(String(b.id).replace(/\D/g, '')) || 0;
        if (variants.length) key = variants[n % variants.length];
      }
      let s;
      if (key !== b.type) {
        // Blender render: the tile centre sits 16 px (per tile) above the image bottom
        s = this.add.image(center.x, center.y + (big ? 32 : 16), key).setOrigin(0.5, 1);
        s.setDisplaySize(big ? 128 : 64, big ? 160 : 96);
      } else {
        s = this.add.image(center.x, center.y + (big ? 14 : 8), b.type).setOrigin(0.5, 1);
      }
      s.setDepth(tileToScreen(b.x1, b.y1).y);
      this.buildingSprites.set(b.id, s);
    }
    for (const [id, s] of this.buildingSprites) {
      if (!alive.has(id)) {
        s.destroy();
        this.buildingSprites.delete(id);
      }
    }
  }

  // Decorations inside the enclosures (src/config/decor.js), redrawn with the ground; fumaroles smoke.
  drawDecor() {
    for (const s of this.decorSprites ?? []) s.destroy();
    for (const e of this.decorSmoke ?? []) e.destroy();
    this.decorSprites = [];
    this.decorSmoke = [];
    for (const e of this.world.builder.enclosures.values()) {
      const sh = e.shelter;
      if (sh && this.textures.exists(`img-shelter-${sh.family}`)) {
        // centre of its 2 x 2 tiles; drawn a little in front so a monster just behind it is hidden by it
        const c = tileToScreen(sh.tx + 0.5, sh.ty + 0.5);
        this.decorSprites.push(this.add.image(c.x, c.y, `img-shelter-${sh.family}`)
          .setOrigin(0.5, SHELTER_IMG.groundY / SHELTER_IMG.h).setDisplaySize(SHELTER_IMG.w / 2, SHELTER_IMG.h / 2).setDepth(c.y + 8));
      }
      for (const d of e.decor ?? []) {
        // the variant (turned differently) is picked from the tile, so it never changes
        const v = (d.tx * 7 + d.ty * 13) % DECOR_VARIANTS;
        const key = 'img-decor-atlas';
        const cell = DECOR_IDS.indexOf(d.type) * DECOR_VARIANTS + v; // see render-decor.mjs
        if (!this.textures.exists(key) || cell < 0) continue;
        const c = tileToScreen(d.tx, d.ty);
        // a low decoration stays under a monster walking over it
        const depth = ENCLOSURE_DECOR[d.type]?.low ? c.y - 14 : c.y;
        this.decorSprites.push(this.add.image(c.x, c.y, key, cell)
          .setOrigin(0.5, DECOR_IMG.groundY / DECOR_IMG.h).setDisplaySize(DECOR_IMG.w / 2, DECOR_IMG.h / 2).setDepth(depth));
        if (ENCLOSURE_DECOR[d.type]?.smoke) {
          this.decorSmoke.push(this.add.particles(c.x, c.y - 10, 'fx-mist', {
            frequency: 380, lifespan: { min: 2200, max: 3200 }, quantity: 1,
            x: { min: -6, max: 6 }, speedX: { min: -3, max: 5 }, speedY: { min: -16, max: -8 },
            scale: { start: 0.35, end: 1.5 }, alpha: { start: 0.32, end: 0 }, tint: [0x8d8782, 0x6f6a66, 0xa49c94],
            maxAliveParticles: 9,
          }).setDepth(c.y + 1));
        }
      }
    }
  }

  // Visual-only stroll of an enclosed monster (src/render/wander.js): walk to a free spot,
  // rest, repeat, never through another monster of the same enclosure. Returns the drawn position.
  wanderInEnclosure(m, entry, e, dt) {
    const r = MONSTER_RADIUS[m.speciesId] ?? 0.5;
    // the bounding box, and for an L-shaped (merged) enclosure, which points are really inside
    const bounds = { minX: e.x0 - 0.1, maxX: e.x1 + 0.1, minY: e.y0 - 0.1, maxY: e.y1 + 0.1 };
    if (rectsOf(e).length > 1) bounds.inside = (x, y) => containsTile(e, Math.round(x), Math.round(y));
    const others = [];
    for (const id of e.monsterIds) {
      if (id === m.id) continue;
      const o = this.entitySprites.get(id);
      if (o && o.w && o.wEnc === e.id) others.push(o.w);
    }
    // big decorations are obstacles too (the low ones are walked over), and the shelter
    for (const d of e.decor ?? []) if (!ENCLOSURE_DECOR[d.type]?.low) others.push({ x: d.tx, y: d.ty, r: DECOR_RADIUS });
    const sh = e.shelter;
    if (sh) others.push({ x: sh.tx + 0.5, y: sh.ty + 0.5, r: SHELTER_RADIUS });
    // its enclosure was just merged into this one: it keeps walking from where it is
    if (entry.w && entry.wEnc !== e.id && !this.world.builder.enclosures.has(entry.wEnc)) entry.wEnc = e.id;
    if (!entry.w || entry.wEnc !== e.id) {
      entry.wEnc = e.id;
      const fx = monsterFx(m.speciesId);
      entry.w = createWanderer(findFreeSpot(bounds, others, r, Math.random), r, { speed: fx.walkSpeed, pause: fx.restRange });
      entry.w.rest = Math.random() * 3;
    }
    entry.atShelter = false;
    if (sh && m.shelter) {
      // taking refuge: straight to the entrance of the shelter, then stays there
      const w = entry.w;
      const gx = sh.tx + 0.5, gy = sh.ty + SHELTER_ENTRANCE;
      const d = Math.hypot(gx - w.x, gy - w.y);
      const step = (w.speed ?? 0.7) * dt;
      if (d > step) {
        w.x += ((gx - w.x) / d) * step;
        w.y += ((gy - w.y) / d) * step;
      } else {
        w.x = gx;
        w.y = gy;
        entry.atShelter = true;
      }
      w.goal = null;
      w.rest = 1 + Math.random(); // when it comes out, a short pause before walking away
      return { x: w.x, y: w.y };
    }
    const goal = entry.w.goal;
    stepWander(entry.w, others, bounds, dt, Math.random);
    // a new stroll: now and then a run (monsters with a run animation)
    const fx = monsterFx(m.speciesId);
    if (fx.runChance && entry.w.goal && entry.w.goal !== goal) {
      entry.running = Math.random() < fx.runChance;
      entry.w.speed = entry.running ? fx.runSpeed : fx.walkSpeed;
    }
    if (!entry.w.goal) entry.running = false;
    return { x: entry.w.x, y: entry.w.y };
  }

  // Now and then, a resting animated monster does something (flap its wings, look around...), then goes
  // back to its idle loop; never the same thing twice in a row. Some monsters (MONSTER_FX) may also stand
  // perfectly still for a while ("statue"), take a nap (sit down, sleep, wake up), or show their anger when
  // unhappy. `anim`: the animation set ("kraken" or "kraken_water"). Returns the kind to play, or null.
  pickIdleAction(anim, entry, dt, m) {
    const fx = monsterFx(anim);
    let actions = idleActions(this, anim);
    if (fx.angry && m && m.happiness < fx.angry.below) {
      actions = [...actions, ...fx.angry.kinds.map((kind) => ({ kind, duration: this.animDuration(anim, kind) })).filter((a) => a.duration)];
    }
    if (!actions.length && !fx.statue && !fx.sleep) return null;
    const gap = fx.actionGap ?? IDLE_ACTION_GAP;
    if (entry.actionQueue?.length) {
      const head = entry.actionQueue[0];
      head.left -= dt;
      if (head.left > 0) {
        entry.actionProgress = 1 - head.left / head.total;
        return head.kind;
      }
      entry.actionQueue.shift();
      entry.actionProgress = 0;
      if (entry.actionQueue.length) return entry.actionQueue[0].kind;
      entry.actionIn = gap[0] + Math.random() * (gap[1] - gap[0]);
      return null;
    }
    if (entry.actionIn == null) entry.actionIn = Math.random() * gap[1];
    entry.actionIn -= dt;
    if (entry.actionIn > 0) return null;
    const step = (kind, total) => ({ kind, total, left: total });
    let queue;
    if (fx.sleep && entry.lastAction !== 'sleep' && Math.random() < fx.sleep.chance) {
      const [a, b] = fx.sleep.loops;
      const loops = a + Math.floor(Math.random() * (b - a + 1));
      const wake = this.animDuration(anim, 'wakeup');
      queue = [step('sitdown', wake), step('sleep', loops * this.animDuration(anim, 'sleep')), step('wakeup', wake)];
      if (fx.sleep.stretchAfter && this.animDuration(anim, 'stretch')) queue.push(step('stretch', this.animDuration(anim, 'stretch')));
      entry.lastAction = 'sleep';
    } else if (fx.statue && entry.lastAction !== 'statue' && Math.random() < 0.3) {
      queue = [step('statue', fx.statue[0] + Math.random() * (fx.statue[1] - fx.statue[0]))];
      entry.lastAction = 'statue';
    } else if (actions.length) {
      let choices = actions.length > 1 ? actions.filter((a) => a.kind !== entry.lastAction) : actions;
      // watched by visitors: it shows off (if it likes company)
      if (fx.visitorKinds && m && this.watchersOf(m.enclosureId) >= 2 && Math.random() < 0.6) {
        const fav = choices.filter((a) => fx.visitorKinds.includes(a.kind));
        if (fav.length) choices = fav;
      }
      const a = choices[Math.floor(Math.random() * choices.length)];
      queue = [step(a.kind, a.duration)];
      entry.lastAction = a.kind;
    } else {
      entry.actionIn = gap[0];
      return null;
    }
    entry.actionQueue = queue;
    entry.actionProgress = 0;
    // stay put until it is over
    if (entry.w) entry.w.rest = Math.max(entry.w.rest, queue.reduce((t, q) => t + q.total, 0) + 0.2);
    return queue[0].kind;
  }

  // Visitors watching an enclosure right now.
  watchersOf(enclosureId) {
    let n = 0;
    for (const v of this.world.visitors) if (v.state === 'watching' && v.target?.id === enclosureId) n++;
    return n;
  }

  // Length of one loop of an animation, in game seconds (0 if there is none).
  animDuration(anim, kind) {
    const a = this.anims.get(`${anim}-${kind}-d0`);
    return a ? a.frames.length / a.frameRate : 0;
  }

  // Effects on the moments of the animation (a foot landing, a slam...), from the events file of the species.
  animationEvents(entry, anim, sheetKind, p, scale, m, enc) {
    const s = entry.sprite;
    const evs = MONSTER_EVENTS[anim]?.[sheetKind]?.events;
    if (!evs || !s.anims.currentAnim) return;
    const key = s.anims.currentAnim.key, idx = s.anims.currentFrame.index - 1;
    if (key === entry.evKey && idx === entry.evIdx) return;
    entry.evKey = key;
    entry.evIdx = idx;
    for (const e of evs) {
      if (e.f !== idx) continue;
      const [dx, dy] = e.at[entry.dir] ?? e.at[0];
      const x = p.x + dx * scale, y = p.y + dy * scale;
      if (monsterFx(anim).cold) {
        // snow underfoot (and on its fur) only in a snowy enclosure
        const snowy = !!enc && HABITAT_FAMILY[enc.habitat] === 'ice';
        this.fx.coldEvent(entry, e.type, x, y, this.sounds, { snowy, behind: entry.dir >= 3 && entry.dir <= 5 });
      } else this.fx.heavyEvent(entry, e.type, x, y, this.sounds);
    }
  }

  syncEntities(time, dt = 0) {
    const { world } = this;
    const dtReal = Math.min(0.1, (time - (this.lastSyncTime ?? time)) / 1000); // real seconds, for eased lights
    this.lastSyncTime = time;
    for (const e of this.decorSmoke ?? []) e.timeScale = world.speed || 0.0001; // smoke follows the game speed
    const alive = new Set();

    for (const m of world.monsters.values()) {
      if (m.state === 'stored') continue;
      alive.add(m.id);
      const entry0 = this.entitySprites.get(m.id);
      const look = resolveMonsterTexture(this, m, entry0 ? entry0.dir : 0);
      const animated = look.directional && hasAnimation(this, m.speciesId);
      const entry = this.entry(m.id, 'monster', look.key);
      if (!animated && entry.sprite.texture.key !== look.key) {
        entry.sprite.stop();
        entry.sprite.setTexture(look.key);
      }
      if (look.tint) entry.sprite.setTint(look.tint);
      else entry.sprite.clearTint();
      if (!entry.shadow) entry.shadow = this.add.image(0, 0, 'shadow');
      let x = m.pos.x, y = m.pos.y;
      const enc = m.state === 'enclosed' ? world.builder.enclosures.get(m.enclosureId) : null;
      // a habitat version of the animations if there is one ("kraken_water": swimming in its pool)
      // (by habitat family: the kraken swims in the lagoon, the reef and the abyss alike)
      const habitatAnim = enc && `${m.speciesId}_${HABITAT_FAMILY[enc.habitat]}`;
      const anim = animated && habitatAnim && hasAnimation(this, habitatAnim) ? habitatAnim : m.speciesId;
      const swimming = anim !== m.speciesId;
      const fx = animated ? monsterFx(m.speciesId) : {};
      let sheetKind = null, heavyKind = null;
      if (enc) {
        ({ x, y } = this.wanderInEnclosure(m, entry, enc, dt));
      } else {
        entry.w = null;
      }
      const p = tileToScreen(x, y);
      // turn toward the walking direction (tile-space movement since last frame)
      const mdx = x - (entry.lastTX ?? x), mdy = y - (entry.lastTY ?? y);
      entry.lastTX = x;
      entry.lastTY = y;
      const moving = Math.hypot(mdx, mdy) > 0.0015;
      if (moving) entry.walkUntil = time + 250; // short grace so tiny stops don't flicker to idle
      if (look.directional) {
        if (moving) entry.dir = directionIndex(mdx, mdy);
        entry.sprite.setFlipX(false).setOrigin(0.5, directionalOriginY(anim));
        if (animated) {
          const walking = time < (entry.walkUntil || 0);
          let kind = walking ? (m.state === 'escaped' && hasFlyAnimation(this, m.speciesId) ? 'fly' : 'walk') : 'idle';
          if (walking && ((m.state === 'escaped' && fx.escapedMove) || entry.running)) kind = fx.escapedMove ?? 'run';
          if (walking) {
            entry.actionQueue = null;
            entry.escKind = null;
          } else if (m.shelter && entry.atShelter) {
            // in its shelter, facing out: asleep at the entrance (or just resting), or hidden inside
            entry.dir = 0;
            kind = m.shelter === 'entrance' && this.anims.exists(`${anim}-sleep-d0`) ? 'sleep' : 'idle';
            entry.actionQueue = null;
          } else if (m.state === 'escaped' && fx.escapedKinds) {
            // each time it stops while escaped, it picks one of its threatening moves
            entry.escKind ??= fx.escapedKinds[Math.floor(Math.random() * fx.escapedKinds.length)];
            kind = entry.escKind;
            entry.actionQueue = null;
          } else if (m.state === 'escaped' && hasThreatAnimation(this, m.speciesId)) {
            kind = 'threat';
            entry.actionQueue = null;
          } else kind = this.pickIdleAction(anim, entry, dt, m) || kind;
          // standing perfectly still: the idle pose, frozen
          sheetKind = kind === 'statue' ? 'idle' : kind;
          const key = `${anim}-${sheetKind}-d${entry.dir}`;
          const cur = entry.sprite.anims.currentAnim;
          if (!cur || cur.key !== key) {
            // keep the stride going when only the direction changes
            const sameKind = cur && cur.key.includes(`-${kind}-`);
            const frame = sameKind ? entry.sprite.anims.currentFrame.index - 1 : 0;
            if (fx.crossfadeMs && cur) this.fx.beginCrossfade(entry);
            entry.sprite.play({ key, startFrame: frame });
          }
          entry.sprite.anims.timeScale = kind === 'statue' ? 0.0001 : world.speed || 0.0001;
          heavyKind = kind;
        }
      } else {
        const dx = p.x - entry.lastX;
        // single real images face left, procedural ones face the viewer: flip toward the walking direction
        if (Math.abs(dx) > 0.05) entry.sprite.setFlipX(look.real ? dx > 0 : dx < 0);
        entry.sprite.setOrigin(0.5, 1);
      }
      entry.lastX = p.x;
      const bob = animated ? 0 : Math.abs(Math.sin(time * 0.006 + entry.phase)) * (look.real ? 1.2 : 3);
      // the ground trembles under the others, not under the heavy monster that shakes it (it would look blurred)
      const tremor = fx.heavy ? 0 : this.fx.tremorAt(p.x, p.y);
      entry.sprite.setPosition(p.x, p.y + (look.directional ? 0 : 8) - bob + tremor).setDepth(p.y);
      const pulse = m.state === 'escaped' ? 1 + 0.08 * Math.sin(time * 0.02) : 1;
      entry.sprite.setScale(look.scale * pulse);
      let shadow = [0.7, 0.7];
      if (look.directional) shadow = fx.heavy ? [1.75, 1.3] : [1.3, 1.0];
      else if (look.real) shadow = [(entry.sprite.displayWidth / 64) * 0.9, 0.9];
      // no shadow on the water under a swimming monster, nor under a ghost
      entry.shadow.setVisible(!swimming && !fx.spectral);
      entry.shadow.setPosition(p.x, p.y + (look.directional ? 1 : 6)).setDepth(p.y - 0.5).setScale(shadow[0], shadow[1]);
      // hidden in its shelter: it fades into the dark, only its eyes still glow
      const hidden = m.shelter === 'inside' && entry.atShelter ? 0 : 1;
      entry.hideK = (entry.hideK ?? 1) + (hidden - (entry.hideK ?? 1)) * (1 - Math.exp(-dtReal * 4));
      entry.shadow.setAlpha(entry.hideK);
      if (fx.spectral || fx.crossfadeMs) {
        const alpha = fx.spectral ? this.fx.spectral(m, entry, p, time, dt, time < (entry.walkUntil || 0)) : 1;
        this.fx.applyCrossfade(entry, fx.crossfadeMs ?? 1, alpha * entry.hideK);
      } else entry.sprite.setAlpha(entry.hideK);
      const eyes = Math.max(0, 1 - entry.hideK / 0.35);
      const blink = Math.sin(time * 0.0013 + entry.phase * 3) > -0.93 ? 1 : 0;
      this.fx.shelterEyes(entry, p.x, p.y - 13, eyes * blink, EYES[m.speciesId] ?? 0xffe080);
      if (fx.glow && sheetKind) {
        this.fx.glowLayer(entry, m, anim, sheetKind === 'sitdown' ? 'wakeup' : sheetKind, heavyKind, fx, time, dtReal, entry.actionProgress ?? 0);
      }
      if ((fx.heavy || fx.cold) && sheetKind) this.animationEvents(entry, anim, sheetKind, p, look.scale, m, enc);
      const top = look.directional ? entry.sprite.displayHeight * directionalOriginY(anim) : entry.sprite.displayHeight;
      this.setBubble(entry, m.state === 'escaped' ? 'bubble-scared' : null, p, top - 10);
    }

    for (const v of world.visitors) {
      alive.add(v.id);
      const look = visitorLook(v);
      const entry = this.entry(v.id, 'visitor', `visitor-${v.variant}`);
      const p = tileToScreen(v.pos.x, v.pos.y);
      // happy in front of a monster: wave once, then just watch
      entry.watchT = v.state === 'watching' ? (entry.watchT ?? 0) + dt : null;
      const still = v.state === 'watching' && v.mood === 'happy' && entry.watchT < WAVE_SECONDS ? 'wave' : 'idle';
      const top = this.drawPerson(entry, look, v.pos, p, time, v.state === 'fleeing' ? 'run' : 'walk', still);
      let bubble = null;
      if (v.mood !== 'happy') bubble = `bubble-${v.mood}`;
      else if (v.state === 'watching') bubble = 'bubble-happy';
      this.setBubble(entry, bubble, p, top);
    }

    for (const k of world.keepers) {
      alive.add(k.id);
      const entry = this.entry(k.id, 'keeper', 'keeper');
      const p = tileToScreen(k.pos.x, k.pos.y);
      this.drawPerson(entry, 'person-keeper', k.pos, p, time, k.state === 'chasing' ? 'run' : 'walk', 'idle');
    }

    for (const [id, entry] of this.entitySprites) {
      if (alive.has(id)) continue;
      this.fx.remove(entry);
      entry.sprite.destroy();
      if (entry.bubble) entry.bubble.destroy();
      if (entry.shadow) entry.shadow.destroy();
      this.entitySprites.delete(id);
    }
  }

  // Draws a visitor or keeper: the animated 3D character `look` if it was rendered, else the flat drawing.
  // `moving` / `still`: animation to play while moving / standing. Returns the height for the mood bubble.
  drawPerson(entry, look, pos, p, time, moving, still) {
    const dx = pos.x - (entry.lastTX ?? pos.x), dy = pos.y - (entry.lastTY ?? pos.y);
    entry.lastTX = pos.x;
    entry.lastTY = pos.y;
    if (!hasPerson(this, look)) {
      const bob = Math.hypot(dx, dy) > 0.001 ? Math.abs(Math.sin(time * 0.015 + entry.phase)) * 2 : 0;
      entry.sprite.setPosition(p.x, p.y + 6 - bob).setDepth(p.y);
      return 40;
    }
    if (Math.hypot(dx, dy) > 0.001) {
      entry.walkUntil = time + 200; // short grace so tiny stops don't flicker to idle
      entry.dir = personDirection(dx, dy);
    }
    const kind = time < (entry.walkUntil || 0) ? moving : still;
    const key = `${look}-${this.anims.exists(`${look}-${kind}-d0`) ? kind : 'idle'}-d${entry.dir}`;
    const cur = entry.sprite.anims.currentAnim;
    if (!cur || cur.key !== key) {
      const sameKind = cur && cur.key.slice(0, -3) === key.slice(0, -3);
      entry.sprite.play({ key, startFrame: sameKind ? entry.sprite.anims.currentFrame.index - 1 : 0 });
    }
    entry.sprite.anims.timeScale = this.world.speed || 0.0001;
    entry.sprite.setOrigin(0.5, PERSON_ORIGIN_Y).setScale(PERSON_SCALE).setPosition(p.x, p.y + 2 + this.fx.tremorAt(p.x, p.y)).setDepth(p.y);
    if (!entry.shadow) entry.shadow = this.add.image(0, 0, 'shadow');
    entry.shadow.setPosition(p.x, p.y + 3).setDepth(p.y - 0.5).setScale(0.45, 0.45);
    return 46;
  }

  entry(id, kind, texture) {
    let e = this.entitySprites.get(id);
    if (!e) {
      const sprite = this.add.sprite(0, 0, texture).setOrigin(0.5, 1);
      e = { sprite, bubble: null, kind, phase: Math.random() * 10, lastX: 0, dir: 0 };
      this.entitySprites.set(id, e);
    }
    return e;
  }

  setBubble(entry, key, p, height) {
    if (!key) {
      if (entry.bubble) entry.bubble.setVisible(false);
      return;
    }
    if (!entry.bubble) entry.bubble = this.add.image(0, 0, key);
    entry.bubble.setTexture(key).setVisible(true).setPosition(p.x + 10, p.y - height).setDepth(p.y + 1);
  }

  // ---- camera -----------------------------------------------------------

  centerView() {
    const start = tileToScreen(20, 34);
    this.cameras.main.centerOn(start.x, start.y);
  }

  moveCameraWithKeys(delta) {
    const cam = this.cameras.main;
    const speed = (0.6 * delta) / cam.zoom;
    const k = this.keys;
    if (k.left.isDown || k.a.isDown || k.q.isDown) cam.scrollX -= speed;
    if (k.right.isDown || k.d.isDown) cam.scrollX += speed;
    if (k.up.isDown || k.w.isDown || k.z.isDown) cam.scrollY -= speed;
    if (k.down.isDown || k.s.isDown) cam.scrollY += speed;
  }

  // ---- input ------------------------------------------------------------

  setupInput() {
    this.input.mouse.disableContextMenu();
    this.keys = this.input.keyboard.addKeys('up,down,left,right,w,a,s,d,z,q');
    this.input.keyboard.on('keydown-ESC', () => this.ui.setTool({ type: 'select' }));

    this.input.on('wheel', (pointer, objs, dx, dy) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 2));
    });

    this.input.on('pointerdown', (pointer) => {
      this.downAt = { x: pointer.x, y: pointer.y };
      this.panning = false;
      if (!pointer.leftButtonDown()) return;
      this.toolDown(this.pointerTile(pointer));
    });

    this.input.on('pointermove', (pointer) => {
      const cam = this.cameras.main;
      const rightDrag = pointer.rightButtonDown() || pointer.middleButtonDown();
      const leftPan = pointer.leftButtonDown() && this.tool.type === 'select' && this.downAt
        && Phaser.Math.Distance.Between(this.downAt.x, this.downAt.y, pointer.x, pointer.y) > 6;
      if (rightDrag || leftPan) {
        this.panning = true;
        this.userMovedCamera = true;
        cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
        cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
        return;
      }
      this.toolMove(this.pointerTile(pointer), pointer.leftButtonDown());
    });

    this.input.on('pointerup', (pointer) => {
      if (pointer.button !== 0 || pointer.downElement !== this.game.canvas) return;
      const tile = this.pointerTile(pointer);
      if (this.panning) {
        this.panning = false;
        return;
      }
      this.toolUp(tile, pointer);
    });
  }

  // ---- tools, by tile ---------------------------------------------------
  // Used by the 2D input above and by the 3D view (src/render3d/park3d.js), which finds the tile itself.
  // toolMove and toolUp return the tiles of the placement preview: [{ tx, ty, ok }].

  // left button pressed on a tile
  toolDown(tile) {
    if (this.tool.type === 'enclosure') this.dragStart = tile;
    if (this.tool.type === 'path') {
      this.lastPainted = null;
      this.paintPath(tile);
    }
  }

  // pointer over a tile (`leftDown`: the left button is held)
  toolMove(tile, leftDown) {
    if (this.tool.type === 'path' && leftDown) this.paintPath(tile);
    return this.drawGhost(tile);
  }

  // the tool's drag was let go (no click): forget its start
  toolCancel() {
    this.dragStart = null;
    this.lastPainted = null;
  }

  // left button released (a click); `hit`: what the 3D view found under the pointer (see selectAt)
  toolUp(tile, pointer, hit) {
    return this.handleClick(tile, pointer, hit);
  }

  pointerTile(pointer) {
    const p = pointer.positionToCamera(this.cameras.main);
    return screenToTile(p.x, p.y);
  }

  report(result) {
    if (!result.ok) this.ui.error(result.reason);
    return result;
  }

  // Paints every tile between the last painted tile and this one (4-connected),
  // so fast mouse moves leave no holes.
  paintPath(tile) {
    const last = this.lastPainted;
    this.lastPainted = { ...tile };
    const cells = [];
    if (last) {
      let { tx, ty } = last;
      while (tx !== tile.tx || ty !== tile.ty) {
        if (Math.abs(tile.tx - tx) >= Math.abs(tile.ty - ty)) tx += Math.sign(tile.tx - tx);
        else ty += Math.sign(tile.ty - ty);
        cells.push({ tx, ty });
      }
    } else cells.push(tile);
    for (const c of cells) {
      if (this.world.grid.isPath(c.tx, c.ty)) continue;
      const r = this.world.builder.placePath(c.tx, c.ty);
      if (!r.ok && r.reason !== 'outOfBounds') this.report(r);
    }
  }

  handleClick(tile, pointer, hit) {
    const { world } = this;
    const b = world.builder;
    this.lastPainted = null;
    switch (this.tool.type) {
      case 'enclosure': {
        if (this.dragStart) this.report(b.placeEnclosure(this.dragStart.tx, this.dragStart.ty, tile.tx, tile.ty, this.tool.habitat));
        this.dragStart = null;
        break;
      }
      case 'decor':
        this.report(b.placeDecor(tile.tx, tile.ty, this.tool.decor));
        break;
      case 'shelter':
        this.report(b.placeShelter(tile.tx, tile.ty));
        break;
      case 'decoration':
      case 'snack':
      case 'souvenir':
        this.report(b.placeBuilding(this.tool.type, tile.tx, tile.ty));
        break;
      case 'demolish':
        this.report(b.demolish(tile.tx, tile.ty));
        break;
      case 'placeMonster': {
        const t = world.grid.getTile(tile.tx, tile.ty);
        const enc = t && t.occupant && b.enclosures.get(t.occupant);
        if (!enc) {
          this.ui.error('wrongHabitat');
          break;
        }
        if (this.report(world.placeStoredMonster(this.tool.monsterId, enc.id)).ok) {
          this.ui.setTool({ type: 'select' });
          this.ui.select({ kind: 'monster', id: this.tool.monsterId });
        }
        break;
      }
      case 'select':
        this.selectAt(tile, pointer, hit);
        break;
      default:
        break;
    }
    return this.drawGhost(tile);
  }

  // What the 2D sprites under the pointer are: { entity: { id, kind } | null, buildingId: id | null }.
  spriteHit(pointer) {
    const p = pointer.positionToCamera(this.cameras.main);
    let best = null;
    for (const [id, e] of this.entitySprites) {
      if (!e.sprite.getBounds().contains(p.x, p.y)) continue;
      if (!best || e.sprite.depth > best.e.sprite.depth || (e.kind === 'monster' && best.e.kind !== 'monster')) best = { id, e };
    }
    // building sprites are taller than their tiles: test their image bounds too
    let bestB = null;
    for (const [id, s] of this.buildingSprites) {
      if (s.getBounds().contains(p.x, p.y) && (!bestB || s.depth > bestB.s.depth)) bestB = { id, s };
    }
    return { entity: best ? { id: best.id, kind: best.e.kind } : null, buildingId: bestB?.id ?? null };
  }

  // `hit`: what is under the pointer (see spriteHit; the 3D view gives its own)
  selectAt(tile, pointer, hit = this.spriteHit(pointer)) {
    const { world } = this;
    // people and monsters first (escaped monsters are clickable to catch them)
    const best = hit.entity;
    if (best && best.kind === 'monster') {
      const m = world.monsters.get(best.id);
      if (m && m.state === 'escaped') {
        world.catchMonster(m.id);
        this.ui.onEvent({ type: 'caught', speciesId: m.speciesId });
        return;
      }
      this.ui.select({ kind: 'monster', id: best.id });
      return;
    }
    if (best && (best.kind === 'visitor' || best.kind === 'keeper')) {
      this.ui.select({ kind: best.kind, id: best.id });
      return;
    }
    if (hit.buildingId) {
      const bld = world.builder.buildings.get(hit.buildingId);
      if (bld) {
        this.ui.select({ kind: 'building', id: bld.id, type: bld.type });
        return;
      }
    }
    const t = world.grid.getTile(tile.tx, tile.ty);
    if (!t || !t.occupant) {
      this.ui.select(null);
      return;
    }
    const enc = world.builder.enclosures.get(t.occupant);
    if (enc) {
      this.ui.select({ kind: 'enclosure', id: enc.id });
      return;
    }
    const bld = world.builder.buildings.get(t.occupant);
    if (bld) this.ui.select({ kind: 'building', id: bld.id, type: bld.type });
  }

  // Draws the placement preview of the tool on the pointed tile; returns its tiles, [{ tx, ty, ok }].
  drawGhost(tile) {
    const g = this.ghost;
    g.clear();
    const cells = this.ghostCells(tile);
    for (const { tx, ty, ok } of cells) {
      const c = tileToScreen(tx, ty);
      const pts = [{ x: c.x, y: c.y - 16 }, { x: c.x + 32, y: c.y }, { x: c.x, y: c.y + 16 }, { x: c.x - 32, y: c.y }];
      g.fillStyle(ok ? 0x52b788 : 0xe63946, 0.45);
      g.fillPoints(pts, true);
    }
    return cells;
  }

  // The tiles of the placement preview (green `ok`: the tool can be used there), same rules for 2D and 3D.
  ghostCells(tile) {
    const cells = [];
    const { grid } = this.world;
    const type = this.tool.type;
    if (type === 'select') return cells;
    const diamondAt = (tx, ty, ok) => cells.push({ tx, ty, ok });
    if (type === 'enclosure' && this.dragStart) {
      const x0 = Math.min(this.dragStart.tx, tile.tx), x1 = Math.max(this.dragStart.tx, tile.tx);
      const y0 = Math.min(this.dragStart.ty, tile.ty), y1 = Math.max(this.dragStart.ty, tile.ty);
      let ok = x1 > x0 && y1 > y0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!grid.isFree(x, y)) ok = false;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid.inBounds(x, y)) diamondAt(x, y, ok);
      this.ui.hint(`${(x1 - x0 + 1)} × ${(y1 - y0 + 1)}`);
      return cells;
    }
    if (!grid.inBounds(tile.tx, tile.ty)) return cells;
    if (type === 'demolish') {
      const t = grid.getTile(tile.tx, tile.ty);
      if (t.occupant || t.ground === 'path') diamondAt(tile.tx, tile.ty, false);
      return cells;
    }
    if (type === 'shelter') {
      // its 2 x 2 tiles from the pointed one
      const t = grid.getTile(tile.tx, tile.ty);
      const enc = t.occupant && this.world.builder.enclosures.get(t.occupant);
      const ok = !!enc && HABITAT_FAMILY[enc.habitat] === this.tool.family && !enc.shelter
        && enc.area >= BALANCE.shelterMinArea && [[1, 0], [0, 1], [1, 1]].every(([dx, dy]) => containsTile(enc, tile.tx + dx, tile.ty + dy));
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (grid.inBounds(tile.tx + dx, tile.ty + dy)) diamondAt(tile.tx + dx, tile.ty + dy, ok);
      }
      return cells;
    }
    if (type === 'decor') {
      const t = grid.getTile(tile.tx, tile.ty);
      const enc = t.occupant && this.world.builder.enclosures.get(t.occupant);
      diamondAt(tile.tx, tile.ty, !!enc && enc.habitat === this.tool.habitat && !this.world.builder.decorAt(tile.tx, tile.ty));
      return cells;
    }
    if (type === 'placeMonster') {
      const t = grid.getTile(tile.tx, tile.ty);
      const enc = t.occupant && this.world.builder.enclosures.get(t.occupant);
      const sp = this.tool.speciesId;
      const ok = !!enc && habitatFits(sp, enc.habitat)
        && (enc.monsterIds.length === 0 || enc.speciesId === sp)
        && enc.monsterIds.length < capacity(enc, sp);
      diamondAt(tile.tx, tile.ty, ok);
      return cells;
    }
    diamondAt(tile.tx, tile.ty, grid.isFree(tile.tx, tile.ty));
    return cells;
  }
}
