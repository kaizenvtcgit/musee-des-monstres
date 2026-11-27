// The main view of the game, in 3D: the park seen from above, with a camera turned freely.
// Phaser (src/render/GameScene.js) keeps running hidden underneath: it runs the simulation, the monsters'
// wandering and their animation logic; the menus and HUD (src/render/ui.js) stay on top of this view.
//
// Controls from above: right button held = turn the view (freely), wheel = zoom, middle button held
// (or left button with the selection tool) = move, Z Q S D / W A S D / arrows = move; on touch screens:
// one finger = move, two fingers = zoom and turn. A button switches to the walk (src/render3d/visit.js).
import * as THREE from 'three';
import { ParkScene, T, RING } from './park-scene.js';
import { WalkMode } from './visit.js';
import { t } from '../i18n/index.js';

const DIST = { min: 7, max: 150, start: 48 }; // m, camera to the point looked at
const ELEV = { min: 0.22, max: 1.5, start: 0.82 }; // radians above the horizon
const START_AZ = Math.PI / 4; // looking along the diagonal, like the 2D isometric view

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

  // ---------------------------------------------------------------- input

  bindInput() {
    const c = this.view.canvas;
    this.listeners = [];
    const on = (target, type, fn, opt) => {
      target.addEventListener(type, fn, opt);
      this.listeners.push([target, type, fn, opt]);
    };
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'wheel', (e) => {
      e.preventDefault();
      // pixels or lines; a notch of the wheel is about 100 px
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoom(Math.pow(1.0015, THREE.MathUtils.clamp(d, -300, 300)));
    }, { passive: false });
    on(c, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 1) e.preventDefault(); // no auto-scroll
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, touch: e.pointerType === 'touch' });
      try { c.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      if (e.button === 2) c.style.cursor = 'grabbing';
    });
    on(c, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      const touches = [...this.pointers.values()].filter((q) => q.touch);
      if (p.touch && touches.length >= 2) {
        // two fingers: pinch to zoom, twist to turn
        const [a, b] = touches;
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
      if (p.touch || p.button === 1) {
        this.dragGround(dx, dy);
      } else if (p.button === 2) {
        this.rotate(dx, dy);
      } else if (p.button === 0 && (this.view.ui.scene?.tool?.type ?? 'select') === 'select') {
        // the left button moves the view once dragged a little (a plain click stays a click)
        if (!p.dragging && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) return;
        if (!p.dragging) {
          p.dragging = true;
          c.style.cursor = 'grabbing';
          this.dragGround(e.clientX - p.x0 - dx, e.clientY - p.y0 - dy);
        }
        this.dragGround(dx, dy);
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) c.style.cursor = '';
    };
    on(c, 'pointerup', up);
    on(c, 'pointercancel', up);
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
    // no WebGL: the 2D view stays
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
    this.park.renderer.setAnimationLoop(() => this.frame());
  }

  // The Phaser scene is ready: hide it (it keeps running the game), and follow its monsters.
  setScene(scene) {
    this.park.setScene(scene);
    scene.sys.setVisible(false);
    scene.input.enabled = false;
    if (scene.input.keyboard) scene.input.keyboard.enabled = false;
    scene.game.canvas.style.visibility = 'hidden';
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
      @media (pointer: coarse) { .walk-stick { display: block; } .walk-help { display: none; } }`;
    root.appendChild(style);
    root.prepend(this.canvas);
    // under the menus and HUD (#ui), above the hidden 2D canvas
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

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    const m = this.modes[this.mode];
    m.update(dt);
    this.park.focus.set(m.focus.x, 0, m.focus.z);
    this.park.update(dt, time);
    this.park.render(this.camera);
  }
}
