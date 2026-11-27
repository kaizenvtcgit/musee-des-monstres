// "Marche à pied": walk through the museum as a visitor, in first person. A camera mode of the 3D view
// (src/render3d/park3d.js), on the shared 3D park (src/render3d/park-scene.js); the game keeps running.
//
// Controls: Z Q S D / W A S D / arrows to walk, Shift to run, mouse to look around (click to capture the
// mouse), on touch screens: left thumb to walk, right thumb to look. Échap (or the button) goes back up.
import { T, RING } from './park-scene.js';
import { t } from '../i18n/index.js';

const EYE = 1.65;
const WALK = 1.7, RUN = 4.2; // m / s
const BODY = 0.3; // player radius (m)

export class WalkMode {
  // `view`: the 3D view (park, camera, keys, root element, back to the view from above)
  constructor(view) {
    this.view = view;
    this.park = view.park;
    this.world = view.park.world;
    this.camera = view.camera;
    this.keys = view.keys;
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.touch = { move: null, look: null };
  }

  get focus() {
    return this.pos;
  }

  // Starts walking at (x, z) metres, looking towards `yaw` (0 = towards -z), from the nearest free spot.
  enter({ x, z, yaw }) {
    this.pos = this.freeSpot(x, z);
    this.yaw = yaw;
    this.pitch = -0.08;
    this.camera.fov = 70;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
    this.park.viewPeople = 70;
    this.park.shadowSize = 38;
    this.park.s3.fog.near = 60;
    this.park.s3.fog.far = 210;
    this.buildDom();
    this.bindInput();
  }

  exit() {
    for (const [target, type, fn, opt] of this.listeners) target.removeEventListener(type, fn, opt);
    if (document.pointerLockElement) document.exitPointerLock();
    this.dom.remove();
  }

  buildDom() {
    const dom = (this.dom = document.createElement('div'));
    dom.className = 'walk3d';
    dom.innerHTML = `
      <div class="walk-top">
        <span class="walk-help">${t('visit.help')}</span>
        <button data-exit>${t('visit.exit')}</button>
      </div>
      <div class="walk-cross"></div>
      <div class="walk-stick"><div class="walk-knob"></div></div>`;
    this.view.root.appendChild(dom);
    dom.querySelector('[data-exit]').addEventListener('click', () => this.view.setMode('top'));
    setTimeout(() => dom.querySelector('.walk-help')?.classList.add('gone'), 12000);
  }

  // ---------------------------------------------------------------- moving

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

  // the centre of the nearest tile where one can stand (searching in growing squares), else the entrance
  freeSpot(x, z) {
    if (this.free(x, z)) return { x, z };
    const cx = Math.round(x / T), cz = Math.round(z / T);
    for (let r = 1; r < 30; r++) {
      let best = null;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = (cx + dx) * T, pz = (cz + dz) * T;
          if (!this.free(px, pz)) continue;
          const d = Math.hypot(px - x, pz - z);
          if (!best || d < best.d) best = { x: px, z: pz, d };
        }
      }
      if (best) return { x: best.x, z: best.z };
    }
    const { tx, ty } = this.world.entrance;
    return { x: tx * T, z: (ty + 1.2) * T };
  }

  update(dt) {
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

  // Échap: free the mouse first, then go back up
  onEscape() {
    if (document.pointerLockElement !== this.view.canvas) this.view.setMode('top');
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    const c = this.view.canvas;
    this.listeners = [];
    const on = (target, type, fn, opt) => {
      target.addEventListener(type, fn, opt);
      this.listeners.push([target, type, fn, opt]);
    };
    const look = (mx, my, k) => {
      this.yaw -= mx * k;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - my * k));
    };
    on(window, 'mousemove', (e) => {
      if (document.pointerLockElement === c) look(e.movementX, e.movementY, 0.0024);
      else if (this.dragging) look(e.movementX, e.movementY, 0.005);
    });
    on(c, 'mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      // capture the mouse (some browsers / embedded pages refuse: then dragging looks around)
      try { c.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag instead */ }
    });
    on(window, 'mouseup', () => { this.dragging = false; });
    // touch: left half = stick (walk), right half = look
    const stick = this.dom.querySelector('.walk-stick'), knob = this.dom.querySelector('.walk-knob');
    this.ids = {};
    on(c, 'touchstart', (e) => {
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
    on(c, 'touchmove', (e) => {
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
    on(c, 'touchend', end);
    on(c, 'touchcancel', end);
  }
}
