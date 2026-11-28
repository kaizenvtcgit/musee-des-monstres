// The main view of the game, in 3D: the park seen from above, with a camera turned freely.
// Phaser (src/render/GameScene.js) keeps running hidden underneath: it runs the simulation, the monsters'
// wandering and their animation logic; the menus and HUD (src/render/ui.js) stay on top of this view.
//
// Controls from above: right button held = turn the view (freely), wheel = zoom, middle button held
// (or left button with the selection tool) = move, Z Q S D / W A S D / arrows = move; on touch screens:
// one finger = move (or use the tool), two fingers = zoom and turn. A button switches to the walk
// (src/render3d/visit.js).
// The tools of the menus work here as in 2D: the tile under the pointer is found by a ray from the camera
// to the ground and given to the hidden GameScene (toolDown / toolMove / toolUp), which runs them; its
// preview tiles are drawn in 3D (green: possible, red: not). A click with the selection tool opens the
// sheet of the monster, visitor, keeper or building under the pointer.
import * as THREE from 'three';
import { ParkScene, T, RING } from './park-scene.js';
import { WalkMode } from './visit.js';
import { t } from '../i18n/index.js';

const DIST = { min: 7, max: 150, start: 48 }; // m, camera to the point looked at
const ELEV = { min: 0.22, max: 1.5, start: 0.82 }; // radians above the horizon
const START_AZ = Math.PI / 4; // looking along the diagonal of the park

// The camera from above: turns around a point on the ground.
export class TopMode {
  constructor(view) {
    this.view = view;
    this.park = view.park;
    this.camera = view.camera;
    this.keys = view.keys;
    this.target = this.parkCentre();
    this.az = START_AZ;
    this.el = ELEV.start;
    this.dist = DIST.start;
    this.pointers = new Map(); // id -> { x, y, button }
  }

  get focus() {
    return this.target;
  }

  // where the view looks at first: the middle of what is built (the entrance, enclosures, buildings)
  parkCentre() {
    const { entrance, builder } = this.park.world;
    const pts = [[entrance.tx, entrance.ty]];
    for (const e of [...builder.enclosures.values(), ...builder.buildings.values()]) pts.push([(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2]);
    const x = pts.reduce((s, p) => s + p[0], 0) / pts.length, y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return new THREE.Vector3(x * T, 0, y * T);
  }

  // `from`: { x, z, yaw } to look at that spot, from behind someone looking towards `yaw`
  enter(from) {
    if (from) {
      this.target.set(from.x, 0, from.z);
      this.az = from.yaw;
    }
    this.camera.fov = 50;
    this.camera.near = 0.5;
    this.camera.updateProjectionMatrix();
    this.bindInput();
  }

  exit() {
    for (const [target, type, fn, opt] of this.listeners) target.removeEventListener(type, fn, opt);
    this.pointers.clear();
    this.park.scene?.toolCancel();
    this.park.showGhost(null);
    this.view.canvas.style.cursor = '';
  }

  // ---------------------------------------------------------------- moving

  // ground directions under the camera: right, and forward (away from the camera)
  axes() {
    const s = Math.sin(this.az), c = Math.cos(this.az);
    return { rx: c, rz: -s, fx: -s, fz: -c };
  }

  // moves the point looked at by (right, forward) metres
  pan(right, forward) {
    const { rx, rz, fx, fz } = this.axes();
    this.target.x += rx * right + fx * forward;
    this.target.z += rz * right + fz * forward;
    const { grid } = this.park.world;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -RING * T, (grid.w + RING) * T);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -RING * T, (grid.h + RING) * T);
  }

  // metres on the ground for one pixel of the screen, around the point looked at
  metresPerPixel() {
    const h = 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return h / Math.max(1, this.view.canvas.clientHeight);
  }

  // drags the ground with the mouse: the spot under the pointer follows it
  dragGround(dx, dy) {
    const m = this.metresPerPixel();
    this.pan(-dx * m, (dy * m) / Math.max(0.35, Math.sin(this.el)));
  }

  rotate(dx, dy) {
    this.az -= dx * 0.006;
    this.el = THREE.MathUtils.clamp(this.el + dy * 0.005, ELEV.min, ELEV.max);
  }

  zoom(factor) {
    this.dist = THREE.MathUtils.clamp(this.dist * factor, DIST.min, DIST.max);
  }

  update(dt) {
    this.update3dTool();
    const k = this.keys;
    let f = 0, s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (f || s) {
      const speed = this.dist * (k.has('ShiftLeft') || k.has('ShiftRight') ? 1.8 : 0.9);
      const l = Math.hypot(f, s);
      this.pan((s / l) * speed * dt, (f / l) * speed * dt);
    }
    const c = Math.cos(this.el);
    this.camera.position.set(
      this.target.x + this.dist * c * Math.sin(this.az),
      this.target.y + this.dist * Math.sin(this.el),
      this.target.z + this.dist * c * Math.cos(this.az),
    );
    this.camera.lookAt(this.target);
    // what is drawn around the point looked at grows with the distance
    this.park.viewPeople = Math.max(70, this.dist * 1.6);
    this.park.shadowSize = THREE.MathUtils.clamp(Math.round(this.dist * 0.8), 30, 100);
    this.park.s3.fog.near = this.dist + 50;
    this.park.s3.fog.far = this.dist + 230;
  }

  onEscape() {
    this.view.ui.setTool?.({ type: 'select' });
  }

  // ---------------------------------------------------------------- tools

  // the tool chosen in the menus (the hidden game scene holds it and runs it, tile by tile)
  toolType() {
    return this.park.scene?.tool?.type ?? 'select';
  }

  // Shows the placement preview of the tool on the tile under the pointer (and paints paths while
  // `leftDown`); a tile is found by a ray from the camera to the ground, whatever the turn and zoom.
  hover(e, leftDown = false) {
    const sc = this.park.scene;
    if (!sc || this.toolType() === 'select') return this.park.showGhost(null);
    const { tile } = this.park.pick(e.clientX, e.clientY, this.camera);
    this.park.showGhost(tile ? sc.toolMove(tile, leftDown) : null);
  }

  toolDown(e) {
    const { tile } = this.park.pick(e.clientX, e.clientY, this.camera);
    if (!tile) return false;
    this.park.scene.toolDown(tile);
    this.hover(e, false);
    return true;
  }

  // a click (left button released without moving the view): use the tool, or select what is there
  toolUp(e) {
    const { tile, hit } = this.park.pick(e.clientX, e.clientY, this.camera);
    if (!tile) return this.park.scene.toolCancel();
    const cells = this.park.scene.toolUp(tile, hit);
    this.park.showGhost(this.toolType() === 'select' ? null : cells);
  }

  update3dTool() {
    // a new tool chosen in the menus: its preview at once where the mouse is (or none)
    const tool = this.park.scene?.tool;
    if (tool !== this.lastTool) {
      this.lastTool = tool;
      if (this.mouse && !this.pointers.size) this.hover(this.mouse);
      else this.park.showGhost(null);
    }
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    const c = this.view.canvas;
    this.listeners = [];
    const on = (target, type, fn, opt) => {
      target.addEventListener(type, fn, opt);
      this.listeners.push([target, type, fn, opt]);
    };
    const touches = () => [...this.pointers.values()].filter((q) => q.touch);
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'wheel', (e) => {
      e.preventDefault();
      // pixels or lines; a notch of the wheel is about 100 px
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoom(Math.pow(1.0015, THREE.MathUtils.clamp(d, -300, 300)));
      this.hover(e);
    }, { passive: false });
    on(c, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 1) e.preventDefault(); // no auto-scroll
      const touch = e.pointerType === 'touch';
      const p = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, touch };
      // a second finger: zoom and turn, the tool being used is let go
      if (touch) {
        for (const q of touches()) {
          if (q.tool) { q.tool = false; this.park.scene?.toolCancel(); this.park.showGhost(null); }
          q.moved = true;
        }
      }
      this.pointers.set(e.pointerId, p);
      try { c.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      if (e.button === 2) c.style.cursor = 'grabbing';
      // the left button (or one finger) uses the tool; the right button only ever turns the view
      if (e.button === 0 && this.park.scene && this.toolType() !== 'select' && (!touch || touches().length === 1)) p.tool = this.toolDown(e);
    });
    on(c, 'pointermove', (e) => {
      if (e.pointerType === 'mouse') this.mouse = { clientX: e.clientX, clientY: e.clientY };
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') this.hover(e);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= 6) p.moved = true;
      const fingers = touches();
      if (p.touch && fingers.length >= 2) {
        // two fingers: pinch to zoom, twist to turn
        const [a, b] = fingers;
        const before = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
        p.x = e.clientX; p.y = e.clientY;
        const after = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
        if (after.d > 10 && before.d > 10) this.zoom(before.d / after.d);
        let da = after.ang - before.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        this.az += da;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (p.tool) {
        this.hover(e, true);
        return;
      }
      if (p.touch || p.button === 1) {
        this.dragGround(dx, dy);
      } else if (p.button === 2) {
        this.rotate(dx, dy);
      } else if (p.button === 0) {
        // the left button moves the view once dragged a little (a plain click stays a click)
        if (!p.moved) return;
        if (!p.dragging) {
          p.dragging = true;
          c.style.cursor = 'grabbing';
          this.dragGround(e.clientX - p.x0 - dx, e.clientY - p.y0 - dy);
        }
        this.dragGround(dx, dy);
      }
      if (e.pointerType === 'mouse') this.hover(e);
    });
    const up = (e, cancelled) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) c.style.cursor = '';
      if (!p || !this.park.scene) return;
      if (p.tool) {
        if (cancelled) { this.park.scene.toolCancel(); this.park.showGhost(null); } else this.toolUp(e);
      } else if (!cancelled && p.button === 0 && !p.moved && this.toolType() === 'select') {
        this.toolUp(e); // a click on a monster, someone, a building, an enclosure
      }
      if (p.touch && !this.pointers.size) this.park.showGhost(null);
    };
    on(c, 'pointerup', (e) => up(e, false));
    on(c, 'pointercancel', (e) => up(e, true));
    on(c, 'pointerleave', () => {
      this.mouse = null;
      if (!this.pointers.size) this.park.showGhost(null);
    });
  }
}

// ---------------------------------------------------------------- the view

let current = null;

// Starts the 3D view (once); `mode`: 'top' or 'walk'. Resolves with the view, or null if 3D is impossible.
export async function startPark3D(world, ui, mode = 'top') {
  if (current) {
    current.setMode(mode);
    return current;
  }
  try {
    current = new Park3D(world, ui);
  } catch (err) {
    // no WebGL: the page says so (main.js)
    console.error(err);
    current = null;
    return null;
  }
  window.__park3d = current; // for the automated checks
  current.setMode(mode);
  current.loadModels();
  return current;
}

class Park3D {
  constructor(world, ui) {
    this.ui = ui;
    this.keys = new Set();
    this.clock = new THREE.Clock();
    this.park = new ParkScene(world);
    this.canvas = this.park.canvas;
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 700);
    this.buildDom();
    this.modes = { top: new TopMode(this), walk: new WalkMode(this) };
    this.mode = null;
    this.bindKeys();
    ui.bindView3d?.(this);
    if (ui.scene) this.setScene(ui.scene);
    this.onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.park.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this.onResize);
    // phones and small processors start a step lower; then the frame rate decides (see adaptQuality)
    const modest = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    this.park.setQuality(modest ? 1 : 0);
    this.perf = { time: 0, frames: 0 };
    this.park.renderer.setAnimationLoop(() => this.frame());
  }

  // The game scene is ready (hidden: it runs the game): follow its monsters, hear its sounds from here.
  setScene(scene) {
    this.park.setScene(scene);
    if (scene.sounds) scene.sounds.placer = (x, y) => this.hear(x, y);
  }

  // Loudness and stereo position of a sound at a point of the park (in tiles), heard from the 3D camera:
  // softer with the distance, softer still off screen (from above), panned to its side. Null when too far.
  hear(x, y) {
    const p = new THREE.Vector3(x * T, 1, y * T);
    const cam = this.camera;
    const d = cam.position.distanceTo(p);
    let vol = THREE.MathUtils.clamp(1 - (d - 10) / 120, 0, 1);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const dir = p.clone().sub(cam.position).normalize();
    if (this.mode === 'top') {
      const n = p.clone().project(cam);
      if (n.z > 1 || Math.abs(n.x) > 1.2 || Math.abs(n.y) > 1.2) vol *= 0.4;
    }
    if (vol < 0.03) return null;
    return { vol, pan: THREE.MathUtils.clamp(dir.dot(right) * 0.9, -0.8, 0.8) };
  }

  buildDom() {
    const root = (this.root = document.createElement('div'));
    root.className = 'park3d';
    root.innerHTML = '<div class="park3d-status"></div>';
    const style = document.createElement('style');
    style.textContent = `
      .park3d { position: fixed; inset: 0; background: #cfe0ea; touch-action: none; user-select: none; }
      .park3d canvas { display: block; width: 100%; height: 100%; }
      .park3d-status { position: absolute; bottom: 110px; left: 50%; transform: translateX(-50%); color: #fff; background: rgba(20,24,28,.7);
        padding: 6px 12px; border-radius: 8px; font: 14px system-ui, sans-serif; display: none; pointer-events: none; }
      .walk-top { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center;
        background: rgba(20, 24, 28, .6); color: #eee; padding: 6px 12px; border-radius: 10px; font: 13px system-ui, sans-serif; width: max-content; max-width: calc(100% - 32px); }
      .walk-help { opacity: .8; transition: opacity 1s; }
      .walk-help.gone { opacity: 0; width: 0; overflow: hidden; white-space: nowrap; }
      .walk-top button { background: #3a3f46; color: #fff; border: 1px solid #555; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer; }
      .walk-cross { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255,255,255,.7); box-shadow: 0 0 2px #000; pointer-events: none; }
      .walk-stick { position: absolute; left: 24px; bottom: 120px; width: 110px; height: 110px; border-radius: 50%; background: rgba(255,255,255,.15);
        border: 2px solid rgba(255,255,255,.35); display: none; pointer-events: none; }
      .walk-knob { position: absolute; left: 35px; top: 35px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,.55); }
      @media (pointer: coarse) { .walk-stick { display: block; } .walk-help { display: none; } }
      @media (max-width: 700px) { .walk-top { top: 100px; } .walk-stick { bottom: 96px; } }`;
    root.appendChild(style);
    root.prepend(this.canvas);
    // under the menus and HUD (#ui)
    const ui = document.getElementById('ui');
    if (ui) document.body.insertBefore(root, ui);
    else document.body.appendChild(root);
  }

  status(text) {
    const el = this.root.querySelector('.park3d-status');
    el.style.display = text ? 'block' : 'none';
    el.textContent = text ?? '';
  }

  async loadModels() {
    this.status(t('visit.loading'));
    const failed = await this.park.loadModels();
    this.status(failed ? t('visit.modelsFailed', { n: failed }) : null);
    if (failed) setTimeout(() => this.status(null), 8000);
  }

  // 'top' (from above) or 'walk'; the new camera starts where the other one was looking
  setMode(mode) {
    if (mode === this.mode) return;
    const old = this.modes[this.mode];
    let from = null;
    if (old) {
      const f = old.focus;
      from = { x: f.x, z: f.z, yaw: mode === 'walk' ? this.modes.top.az : this.modes.walk.yaw };
      old.exit();
    }
    this.keys.clear();
    this.mode = mode;
    this.modes[mode].enter(from ?? (mode === 'walk' ? this.entranceSpot() : null));
    this.ui.refresh?.(true);
  }

  // A picture of the 3D model of a monster, visitor or keeper for the menus (null until it is ready).
  portrait(who) {
    return this.park.portrait(this.park.modelOf(who));
  }

  toggleWalk() {
    this.setMode(this.mode === 'walk' ? 'top' : 'walk');
  }

  entranceSpot() {
    const { tx, ty } = this.park.world.entrance;
    return { x: tx * T, z: (ty + 1.2) * T, yaw: 0 };
  }

  bindKeys() {
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '') || e.target?.isContentEditable;
    this.onKeyDown = (e) => {
      if (typing(e)) return;
      if (e.code === 'Escape') {
        this.modes[this.mode]?.onEscape();
        return;
      }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  // Every 3 seconds: if the drawing is slow (under ~28 frames per second), one step lighter (setQuality).
  adaptQuality(rawDt) {
    const p = this.perf;
    if (document.hidden || this.park.quality >= 3) return;
    p.time += rawDt;
    p.frames++;
    if (p.time < 3) return;
    const fps = p.frames / p.time;
    p.time = 0;
    p.frames = 0;
    if (fps < 28) this.park.setQuality(this.park.quality + 1);
  }

  frame() {
    const raw = this.clock.getDelta();
    if (raw < 1) this.adaptQuality(raw); // (a long pause: the tab was hidden)
    const dt = Math.min(raw, 0.1);
    const time = this.clock.elapsedTime;
    const m = this.modes[this.mode];
    m.update(dt);
    this.park.focus.set(m.focus.x, 0, m.focus.z);
    this.park.update(dt, time);
    this.park.render(this.camera);
  }
}
