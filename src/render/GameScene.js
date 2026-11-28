import Phaser from 'phaser';
import { generateTextures, monsterTextureKey } from './textures.js';
import {
  preloadSprites, directionIndex, createAnimations, hasAnimation, hasFlyAnimation, hasThreatAnimation, idleActions,
  visitorLook, hasPerson, personDirection, monsterFx, MONSTER_EVENTS,
} from './sprites.js';
import { createWanderer, stepWander, findFreeSpot } from './wander.js';
import { eventSounds } from './monsterfx.js';
import { BALANCE } from '../config/balance.js';
import { Sounds } from './sound.js';
import { ENCLOSURE_DECOR } from '../config/decor.js';
import { HABITAT_FAMILY, habitatFits } from '../config/species.js';
import { rectsOf, containsTile } from '../sim/enclosure.js';
import { capacity } from '../sim/breeding.js';

// Room the decorations take for the monsters walking around them (tile units); the shelter: its room and
// where its entrance is (tile y of the monster resting in it, from the shelter's first tile).
const DECOR_RADIUS = 0.32;
const SHELTER_RADIUS = 0.8;
const SHELTER_ENTRANCE = 1.15;
// How long a happy visitor waves (game seconds).
const WAVE_SECONDS = 2.1;
// Game seconds of plain idling between two idle actions (wing flap, look around...).
const IDLE_ACTION_GAP = [4, 12];
// Footprint of each monster on the ground (tile units), used to keep them from overlapping.
const MONSTER_RADIUS = { dragonnet: 0.6, kraken: 0.6, spectre: 0.4, golem: 0.45, yeti: 0.45 };

// The hidden scene that runs the game (Phaser drives the frames): it ticks the World, decides what every
// monster, visitor and keeper does and plays (a Phaser animation on an empty texture: its key and progress
// are what the 3D view shows, src/render3d/park-scene.js), their mood bubbles, the sounds, and the tools
// (by tile: toolDown / toolMove / toolUp, called by the 3D view). The current tool is set by the DOM UI
// through setTool(). Nothing of it is drawn.
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
    this.sys.setVisible(false);
    this.entitySprites = new Map(); // id -> { sprite, bubbleKey, kind, dir, w (where it strolls)... }
    this.sounds = new Sounds(this); // synthesized sound effects (src/render/sound.js)
    this.ui.bindScene(this);
  }

  setTool(tool) {
    this.tool = tool;
    this.dragStart = null;
  }

  // ---- frame ------------------------------------------------------------

  update(time, delta) {
    this.world.tick(Math.min(delta / 1000, 1));
    for (const e of this.world.events.splice(0)) this.ui.onEvent(e);
    this.syncEntities(time, Math.min(delta / 1000, 0.1) * this.world.speed);
    this.ui.update();
  }

  // Stroll of an enclosed monster (src/render/wander.js): walk to a free spot,
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

  // Length of one loop of an animation, in game seconds (0 if there is none).
  animDuration(anim, kind) {
    const a = this.anims.get(`${anim}-${kind}-d0`);
    return a ? a.frames.length / a.frameRate : 0;
  }

  // Sounds on the moments of the animation (a foot landing, a slam...), from the events file of the species.
  animationEvents(entry, anim, sheetKind, at, enc) {
    const s = entry.sprite;
    const evs = MONSTER_EVENTS[anim]?.[sheetKind]?.events;
    if (!evs || !s.anims.currentAnim) return;
    const key = s.anims.currentAnim.key, idx = s.anims.currentFrame.index - 1;
    if (key === entry.evKey && idx === entry.evIdx) return;
    entry.evKey = key;
    entry.evIdx = idx;
    // snow underfoot (and on its fur) only in a snowy enclosure
    const opts = { cold: !!monsterFx(anim).cold, snowy: !!enc && HABITAT_FAMILY[enc.habitat] === 'ice' };
    for (const e of evs) {
      if (e.f !== idx) continue;
      for (const [sound, gain] of eventSounds(e.type, opts)) this.sounds.play(sound, at, gain);
    }
  }

  // What every monster, visitor and keeper does now: where it strolls, which animation it plays (and in
  // which of the 8 directions), its mood bubble; also when a monster hides in its shelter (hideK: 0 hidden).
  syncEntities(time, dt = 0) {
    const { world } = this;
    const dtReal = Math.min(0.1, (time - (this.lastSyncTime ?? time)) / 1000); // real seconds, for easing
    this.lastSyncTime = time;
    const alive = new Set();

    for (const m of world.monsters.values()) {
      if (m.state === 'stored') continue;
      alive.add(m.id);
      const animated = hasAnimation(this, m.speciesId);
      const entry = this.entry(m.id, 'monster', monsterTextureKey(m));
      let x = m.pos.x, y = m.pos.y;
      const enc = m.state === 'enclosed' ? world.builder.enclosures.get(m.enclosureId) : null;
      // a habitat version of the animations if there is one ("kraken_water": swimming in its pool)
      // (by habitat family: the kraken swims in the lagoon, the reef and the abyss alike)
      const habitatAnim = enc && `${m.speciesId}_${HABITAT_FAMILY[enc.habitat]}`;
      const anim = animated && habitatAnim && hasAnimation(this, habitatAnim) ? habitatAnim : m.speciesId;
      const fx = animated ? monsterFx(m.speciesId) : {};
      let sheetKind = null;
      if (enc) {
        ({ x, y } = this.wanderInEnclosure(m, entry, enc, dt));
      } else {
        entry.w = null;
      }
      // turn toward the walking direction (tile-space movement since last frame)
      const mdx = x - (entry.lastTX ?? x), mdy = y - (entry.lastTY ?? y);
      entry.lastTX = x;
      entry.lastTY = y;
      const moving = Math.hypot(mdx, mdy) > 0.0015;
      if (moving) entry.walkUntil = time + 250; // short grace so tiny stops don't flicker to idle
      if (moving) entry.dir = directionIndex(mdx, mdy);
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
          entry.sprite.play({ key, startFrame: sameKind ? entry.sprite.anims.currentFrame.index - 1 : 0 });
        }
        entry.sprite.anims.timeScale = kind === 'statue' ? 0.0001 : world.speed || 0.0001;
      }
      // hidden in its shelter: it fades into the dark
      const hidden = m.shelter === 'inside' && entry.atShelter ? 0 : 1;
      entry.hideK = (entry.hideK ?? 1) + (hidden - (entry.hideK ?? 1)) * (1 - Math.exp(-dtReal * 4));
      if ((fx.heavy || fx.cold) && sheetKind) this.animationEvents(entry, anim, sheetKind, { x, y }, enc);
      entry.bubbleKey = m.state === 'escaped' ? 'bubble-scared' : null;
    }

    for (const v of world.visitors) {
      alive.add(v.id);
      const entry = this.entry(v.id, 'visitor', `visitor-${v.variant}`);
      // happy in front of a monster: wave once, then just watch
      entry.watchT = v.state === 'watching' ? (entry.watchT ?? 0) + dt : null;
      const still = v.state === 'watching' && v.mood === 'happy' && entry.watchT < WAVE_SECONDS ? 'wave' : 'idle';
      this.animatePerson(entry, visitorLook(v), v.pos, time, v.state === 'fleeing' ? 'run' : 'walk', still);
      let bubble = null;
      if (v.mood !== 'happy') bubble = `bubble-${v.mood}`;
      else if (v.state === 'watching') bubble = 'bubble-happy';
      entry.bubbleKey = bubble;
    }

    for (const k of world.keepers) {
      alive.add(k.id);
      const entry = this.entry(k.id, 'keeper', 'keeper');
      this.animatePerson(entry, 'person-keeper', k.pos, time, k.state === 'chasing' ? 'run' : 'walk', 'idle');
    }

    for (const [id, entry] of this.entitySprites) {
      if (alive.has(id)) continue;
      entry.sprite.destroy();
      this.entitySprites.delete(id);
    }
  }

  // A visitor or keeper: the animation `look` ("person-visitor3") plays `moving` while it moves, `still` when
  // it stands, in the direction of the path (4 directions).
  animatePerson(entry, look, pos, time, moving, still) {
    const dx = pos.x - (entry.lastTX ?? pos.x), dy = pos.y - (entry.lastTY ?? pos.y);
    entry.lastTX = pos.x;
    entry.lastTY = pos.y;
    if (!hasPerson(this, look)) return;
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
  }

  entry(id, kind, texture) {
    let e = this.entitySprites.get(id);
    if (!e) {
      const sprite = this.add.sprite(0, 0, texture).setVisible(false);
      e = { sprite, bubbleKey: null, kind, dir: 0 };
      this.entitySprites.set(id, e);
    }
    return e;
  }

  // ---- tools, by tile ---------------------------------------------------
  // Used by the 3D view (src/render3d/park3d.js), which finds the tile under the pointer.
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
    return this.ghostCells(tile);
  }

  // the tool's drag was let go (no click): forget its start
  toolCancel() {
    this.dragStart = null;
    this.lastPainted = null;
  }

  // left button released (a click); `hit`: what the 3D view found under the pointer (see selectAt)
  toolUp(tile, hit) {
    return this.handleClick(tile, hit);
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

  handleClick(tile, hit) {
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
        this.selectAt(tile, hit);
        break;
      default:
        break;
    }
    return this.ghostCells(tile);
  }

  // `hit`: what the 3D view found under the pointer: { entity: { id, kind } | null, buildingId | null }.
  selectAt(tile, hit = { entity: null, buildingId: null }) {
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

  // The tiles of the placement preview (green `ok`: the tool can be used there), drawn by the 3D view.
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
