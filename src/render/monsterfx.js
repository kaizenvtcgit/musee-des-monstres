// Extra visual effects for some animated monsters (see MONSTER_FX in sprites.js). Everything here is
// drawn on top of the pre-rendered sprite sheets; the game rules never depend on it.
//
// - crossfade: when a monster changes animation, its previous pose fades out over the new one
//   (sprite sheets cannot blend skeleton poses, so the images are blended instead).
// - spectral: a see-through floating ghost: no shadow, gentle levitation, irregular light pulse,
//   faint cold glow on the ground, mist under the body, a smoke trail while moving, and it fades in
//   and out (vanishing through the walls) when it escapes, is caught or placed.
//
// - glow layer (golem): its eyes and golden cracks are a separate light sheet drawn on top (additive), so
//   their brightness can live: a slow pulse at rest, brighter when it is unhappy, flaring during its slam
//   and threat, fading out as it falls asleep and coming back as it wakes up.
// - heavy (golem): on the moments of its events file (src/assets/anims/<species>-events.json, found from the
//   bones by render.mjs) a landing foot raises dust and pebbles and makes the ground tremble around; the
//   ground slam adds a dust cloud, a shock wave and a small camera shake; rock shaking throws stone chips.
//   Every moment has its sound (src/render/sound.js).
//
// Performance: shared textures (mist, glow, pebble, ring); one particle emitter per monster with a small
// particle cap; fewer particles when zoomed out, none when off screen or zoomed far out; no dynamic light.

const APPEAR_MS = 700;
const MIST_CAP = 26;          // particles alive per ghost
const MIST_EVERY = 0.22;      // game seconds between two mist puffs at rest
const TRAIL_EVERY = 0.07;     // ... and between two smoke puffs while moving
const FAR_ZOOM = 0.55;        // below this camera zoom: no particles at all
const NEAR_ZOOM = 0.9;        // below this zoom: half the particles

export class MonsterFX {
  constructor(scene) {
    this.scene = scene;
    this.makeTextures();
  }

  makeTextures() {
    const tex = this.scene.textures;
    if (!tex.exists('fx-mist')) {
      // soft round puff, white (tinted per particle)
      const c = tex.createCanvas('fx-mist', 32, 32);
      const g = c.getContext();
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      c.refresh();
    }
    if (!tex.exists('fx-pebble')) {
      // a small irregular stone (tinted per particle)
      const c = tex.createCanvas('fx-pebble', 8, 8);
      const g = c.getContext();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(1, 4); g.lineTo(3, 1); g.lineTo(6, 1.5); g.lineTo(7.5, 5); g.lineTo(5, 7.5); g.lineTo(2, 6.5);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(3, 5, 4, 2);
      c.refresh();
    }
    if (!tex.exists('fx-ring')) {
      // shock wave on the ground: a soft ellipse ring seen in perspective
      const c = tex.createCanvas('fx-ring', 128, 64);
      const g = c.getContext();
      g.setTransform(1, 0, 0, 0.5, 0, 0);
      const grad = g.createRadialGradient(64, 64, 34, 64, 64, 62);
      grad.addColorStop(0, 'rgba(235,220,190,0)');
      grad.addColorStop(0.6, 'rgba(235,220,190,0.8)');
      grad.addColorStop(1, 'rgba(235,220,190,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      c.refresh();
    }
    if (!tex.exists('fx-eyes')) {
      // two small glowing eyes (tinted per monster), for a monster hidden in the dark of its shelter
      const c = tex.createCanvas('fx-eyes', 20, 8);
      const g = c.getContext();
      for (const x of [5, 15]) {
        const grad = g.createRadialGradient(x, 4, 0, x, 4, 4);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x - 4, 0, 8, 8);
      }
      c.refresh();
    }
    if (!tex.exists('fx-glow')) {
      // faint cold light on the ground (an ellipse seen in perspective), instead of a dark shadow
      const c = tex.createCanvas('fx-glow', 96, 48);
      const g = c.getContext();
      g.setTransform(1, 0, 0, 0.5, 0, 0);
      const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      grad.addColorStop(0, 'rgba(190,230,255,0.9)');
      grad.addColorStop(0.5, 'rgba(150,205,255,0.35)');
      grad.addColorStop(1, 'rgba(150,205,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 96, 96);
      c.refresh();
    }
  }

  // ---- crossfade -----------------------------------------------------------------------------

  // Call just before the sprite switches to another animation.
  beginCrossfade(entry) {
    const s = entry.sprite;
    if (!s.frame) return;
    if (!entry.xfade) entry.xfade = this.scene.add.image(0, 0, s.texture.key, s.frame.name);
    entry.xfade.setTexture(s.texture.key, s.frame.name).setVisible(true);
    entry.xfadeStart = this.scene.time.now;
  }

  // Call every frame after the sprite was placed: sets the sprite alpha (times `alpha`) and the fading old pose.
  applyCrossfade(entry, ms, alpha = 1) {
    const s = entry.sprite;
    const t = entry.xfade && entry.xfade.visible ? (this.scene.time.now - entry.xfadeStart) / ms : 1;
    if (t >= 1) {
      if (entry.xfade) entry.xfade.setVisible(false);
      s.setAlpha(alpha);
      return;
    }
    s.setAlpha(alpha * (0.35 + 0.65 * t));
    entry.xfade.setPosition(s.x, s.y).setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY)
      .setTint(s.tintTopLeft).setDepth(s.depth - 0.01).setAlpha(alpha * (1 - t));
  }

  // ---- spectral ghost ------------------------------------------------------------------------

  // Updates the ghost effects of a monster drawn by `entry` at screen point `p` (its ground point).
  // Returns the alpha the sprite should have (light pulse and fade in).
  spectral(m, entry, p, time, dt, moving) {
    const scene = this.scene;
    const s = entry.sprite;
    const ph = entry.phase;

    // fade out at the old place and in at the new one when it escapes or is put back
    if (entry.ghostState !== undefined && entry.ghostState !== m.state && (m.state === 'escaped' || entry.ghostState === 'escaped')) {
      this.vanish(entry, entry.lastScreen);
      entry.appearAt = scene.time.now;
    }
    if (entry.ghostState === undefined) entry.appearAt = scene.time.now; // first appearance
    entry.ghostState = m.state;
    const appear = Math.min(1, (scene.time.now - (entry.appearAt ?? 0)) / APPEAR_MS);

    // levitation: floats a little and drifts slowly up and down
    const lift = 2 + 1.6 * Math.sin(time * 0.0016 + ph);
    s.y -= lift + (1 - appear) * 10;

    // irregular, subtle light pulse (sum of unrelated slow waves)
    const pulse = 0.86 + 0.07 * Math.sin(time * 0.0019 + ph) + 0.05 * Math.sin(time * 0.0053 + ph * 2.3)
      + 0.02 * Math.sin(time * 0.0131 + ph * 0.7);

    // cold glow on the ground, fainter when it floats higher
    if (!entry.glow) entry.glow = scene.add.image(0, 0, 'fx-glow').setBlendMode('ADD');
    entry.glow.setPosition(p.x, p.y + 2).setDepth(p.y - 0.6)
      .setScale(0.75 - lift * 0.02).setAlpha((0.16 + 0.08 * (pulse - 0.86) / 0.14) * appear);

    // mist under the body and a smoke trail while moving
    this.mist(entry, p, s, dt, moving);
    if (appear < 1 && !entry.appearBurst) {
      entry.appearBurst = true;
      this.puff(entry, p.x, p.y - 8, 10);
    }
    if (appear >= 1) entry.appearBurst = false;

    entry.lastScreen = { x: s.x, y: s.y };
    return pulse * appear;
  }

  // Particle level for this ghost: 0 none, 0.5 half, 1 all.
  detail(s) {
    const cam = this.scene.cameras.main;
    if (cam.zoom < FAR_ZOOM) return 0;
    const v = cam.worldView;
    const m = 60;
    if (s.x < v.x - m || s.x > v.right + m || s.y < v.y - m || s.y > v.bottom + m) return 0;
    return cam.zoom < NEAR_ZOOM ? 0.5 : 1;
  }

  emitter(entry) {
    if (!entry.mist) {
      entry.mist = this.scene.add.particles(0, 0, 'fx-mist', {
        lifespan: { min: 1300, max: 2200 },
        speedX: { min: -5, max: 5 },
        speedY: { min: -12, max: -3 },
        scale: { start: 0.32, end: 0.85 },
        alpha: { start: 0.26, end: 0 },
        tint: [0xeaf7ff, 0xc4e6ff, 0xd9efff],
        emitting: false,
        maxAliveParticles: MIST_CAP,
      });
    }
    return entry.mist;
  }

  puff(entry, x, y, n) {
    if (!this.detail(entry.sprite)) return;
    const e = this.emitter(entry);
    for (let i = 0; i < n; i++) e.emitParticleAt(x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 10, 1);
  }

  mist(entry, p, s, dt, moving) {
    const level = this.detail(s);
    const e = this.emitter(entry);
    e.setDepth(s.depth - 0.2);
    e.timeScale = this.scene.world.speed || 0.0001;
    if (!level || dt <= 0) return;
    entry.mistT = (entry.mistT ?? 0) + dt * level;
    while (entry.mistT >= MIST_EVERY) {
      entry.mistT -= MIST_EVERY;
      // around the dissolving bottom of the body
      e.emitParticleAt(p.x + (Math.random() - 0.5) * 18, s.y - 6 - Math.random() * 6, 1);
    }
    if (!moving) return;
    entry.trailT = (entry.trailT ?? 0) + dt * level;
    while (entry.trailT >= TRAIL_EVERY) {
      entry.trailT -= TRAIL_EVERY;
      // left behind at body height: the emitter does not move, so the puffs stay where they were made
      e.emitParticleAt(s.x + (Math.random() - 0.5) * 12, s.y - 18 - Math.random() * 16, 1);
    }
  }

  // The current pose fades out and rises like smoke at `at` (screen point), then disappears.
  vanish(entry, at) {
    const s = entry.sprite;
    if (!at || !s.frame) return;
    const img = this.scene.add.image(at.x, at.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setDepth(s.depth).setAlpha(s.alpha);
    this.scene.tweens.add({
      targets: img, alpha: 0, y: at.y - 14, scaleX: s.scaleX * 0.9, duration: APPEAR_MS, ease: 'Sine.easeIn',
      onComplete: () => img.destroy(),
    });
    this.puff(entry, at.x, at.y - 10, 10);
  }

  // ---- light layer (golem) ------------------------------------------------------------------

  // Draws the light layer of `species` over the sprite: same frame of the "<species>_glow" sheet of `sheetKind`,
  // at `level` brightness (eased toward the target computed from what the monster is doing).
  glowLayer(entry, m, species, sheetKind, kind, fx, time, dtReal, progress) {
    const s = entry.sprite;
    const key = `anim-${species}_glow-${sheetKind}-dirs`;
    if (!s.frame || !this.scene.textures.exists(key)) {
      if (entry.glowSprite) entry.glowSprite.setVisible(false);
      return;
    }
    const base = fx.glow?.base ?? 0.5;
    const asleep = 0.06;
    // what the light should be now
    let target = base + 0.06 * Math.sin(time * 0.0011 + entry.phase) + 0.03 * Math.sin(time * 0.0029 + entry.phase * 2);
    target += Math.max(0, Math.min(1, (50 - m.happiness) / 50)) * 0.3; // unhappy: it smoulders
    let speed = 1.2; // how fast the light follows (per second)
    if (kind === 'slam' || kind === 'threat') { target += 0.45; speed = 5; }
    if (kind === 'sleep') { target = asleep; speed = 0.6; }
    if (kind === 'sitdown') { target = asleep + (base - asleep) * (1 - progress); speed = 3; }
    if (kind === 'wakeup') { target = asleep + (base - asleep) * progress; speed = 3; }
    entry.glowLevel ??= target;
    entry.glowLevel += (target - entry.glowLevel) * (1 - Math.exp(-dtReal * speed));
    if (!entry.glowSprite) entry.glowSprite = this.scene.add.image(0, 0, key, s.frame.name).setBlendMode('ADD');
    const k = s.width / entry.glowSprite.frame.width || 2; // the light sheet is half size
    entry.glowSprite.setTexture(key, s.frame.name).setVisible(true)
      .setPosition(s.x, s.y).setOrigin(s.originX, s.originY).setScale(s.scaleX * k, s.scaleY * k)
      .setDepth(s.depth + 0.01).setAlpha(Math.max(0, Math.min(1, entry.glowLevel)) * s.alpha);
  }

  // ---- heavy footsteps and impacts (golem) ---------------------------------------------------

  heavyEmitters(entry) {
    if (!entry.dust) {
      entry.dust = this.scene.add.particles(0, 0, 'fx-mist', {
        lifespan: { min: 700, max: 1300 },
        speed: { min: 6, max: 22 }, angle: { min: 180, max: 360 },
        scale: { start: 0.22, end: 0.8 }, alpha: { start: 0.38, end: 0 },
        tint: [0xbfb29b, 0xa89a82, 0x9d927f],
        emitting: false, maxAliveParticles: 40,
      });
      entry.chips = this.scene.add.particles(0, 0, 'fx-pebble', {
        lifespan: { min: 380, max: 700 },
        speedX: { min: -38, max: 38 }, speedY: { min: -95, max: -40 }, gravityY: 300,
        scale: { min: 0.35, max: 0.8 }, rotate: { min: 0, max: 360 }, alpha: { start: 1, end: 0.6 },
        tint: [0x7d776e, 0x948b7f, 0x5f5a53, 0x6f7a55],
        emitting: false, maxAliveParticles: 30,
      });
      // the big cloud of a ground slam: larger, slower puffs
      entry.cloud = this.scene.add.particles(0, 0, 'fx-mist', {
        lifespan: { min: 1400, max: 2200 },
        speed: { min: 18, max: 46 }, angle: { min: 160, max: 380 },
        scale: { start: 0.5, end: 1.9 }, alpha: { start: 0.5, end: 0 },
        tint: [0xc4b8a0, 0xae9f86, 0xa39882],
        emitting: false, maxAliveParticles: 24,
      });
    }
    return entry;
  }

  // An event of the monster's animation (see the events file) happened at world point (x, y).
  heavyEvent(entry, type, x, y, sounds) {
    const s = entry.sprite;
    const level = this.detail(s);
    if (level) {
      this.heavyEmitters(entry);
      entry.dust.setDepth(s.depth + 0.5);
      entry.chips.setDepth(s.depth + 0.6);
      entry.cloud.setDepth(s.depth + 0.55);
      const puff = (n, spread) => { for (let i = 0; i < Math.ceil(n * level); i++) entry.dust.emitParticleAt(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.4, 1); };
      const chips = (n, yy = y) => { for (let i = 0; i < Math.ceil(n * level); i++) entry.chips.emitParticleAt(x + (Math.random() - 0.5) * 10, yy, 1); };
      if (type === 'step') { puff(4, 12); chips(2); this.tremor(x, y, 1.2, 60, 260); }
      if (type === 'slam') {
        puff(10, 40); chips(14);
        for (let i = 0; i < Math.ceil(16 * level); i++) entry.cloud.emitParticleAt(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 10, 1);
        this.ring(x, y, s.depth - 0.4);
        this.tremor(x, y, 2.6, 110, 520);
        this.cameraShake(s);
      }
      if (type === 'debris') { chips(4, y); puff(3, 20); }
      if (type === 'pebbles') chips(3, y);
      if (type === 'beat') chips(1, y);
    }
    const sound = { step: 'step', slam: 'slam', debris: 'clack', pebbles: 'pebbles', beat: 'beat', rumble: 'rumble', grind: 'grind' }[type];
    if (sound) sounds.play(sound, { x, y });
    if (type === 'step' && Math.random() < 0.3) sounds.play('grind', { x, y }, 0.5); // stone rubbing as it moves
  }

  // ---- cold (yeti) ----------------------------------------------------------------------------

  coldEmitters(entry) {
    if (!entry.vapor) {
      // breath: small cold puffs that swell, drift up and fade
      entry.vapor = this.scene.add.particles(0, 0, 'fx-mist', {
        lifespan: { min: 900, max: 1500 },
        speedX: { min: -6, max: 6 }, speedY: { min: -14, max: -6 },
        scale: { start: 0.12, end: 0.55 }, alpha: { start: 0.3, end: 0 },
        tint: [0xffffff, 0xeef6ff],
        emitting: false, maxAliveParticles: 16,
      });
      // snow: powder kicked up by the feet or shaken off the fur
      entry.snow = this.scene.add.particles(0, 0, 'fx-mist', {
        lifespan: { min: 450, max: 900 },
        speedX: { min: -22, max: 22 }, speedY: { min: -40, max: -10 }, gravityY: 70,
        scale: { start: 0.14, end: 0.32 }, alpha: { start: 0.65, end: 0 },
        tint: [0xffffff, 0xf2f7ff, 0xe4eef8],
        emitting: false, maxAliveParticles: 36,
      });
      entry.flakes = this.scene.add.particles(0, 0, 'fx-pebble', {
        lifespan: { min: 500, max: 900 },
        speedX: { min: -30, max: 30 }, speedY: { min: -50, max: -10 }, gravityY: 160,
        scale: { min: 0.2, max: 0.45 }, alpha: { start: 0.95, end: 0.4 }, rotate: { min: 0, max: 360 },
        tint: [0xffffff, 0xf4f9ff],
        emitting: false, maxAliveParticles: 30,
      });
    }
    return entry;
  }

  // A moment of the yeti's animation (see its events file) at world point (x, y).
  // opts.snowy: it stands on snow; opts.behind: it faces away (its breath goes behind its head).
  coldEvent(entry, type, x, y, sounds, { snowy, behind }) {
    const s = entry.sprite;
    const level = this.detail(s);
    if (level && s.alpha > 0.3) {
      this.coldEmitters(entry);
      entry.vapor.setDepth(s.depth + (behind ? -0.3 : 0.3));
      entry.snow.setDepth(s.depth + 0.4);
      entry.flakes.setDepth(s.depth + 0.45);
      const n = (k) => Math.max(1, Math.round(k * level));
      const vapor = (k, spread = 3) => { for (let i = 0; i < n(k); i++) entry.vapor.emitParticleAt(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, 1); };
      // in the cold its breath shows more
      if (type === 'breath') vapor(snowy ? 3 : 1);
      if (type === 'snore') vapor(snowy ? 2 : 1);
      if (type === 'roar') vapor(snowy ? 8 : 4, 8);
      if (type === 'happy' || type === 'grunt') vapor(snowy ? 2 : 1);
      if (snowy && type === 'pad') for (let i = 0; i < n(3); i++) entry.snow.emitParticleAt(x + (Math.random() - 0.5) * 8, y, 1);
      if (snowy && type === 'padRun') {
        for (let i = 0; i < n(5); i++) entry.snow.emitParticleAt(x + (Math.random() - 0.5) * 10, y, 1);
        for (let i = 0; i < n(3); i++) entry.flakes.emitParticleAt(x + (Math.random() - 0.5) * 6, y, 1);
      }
      if (snowy && type === 'furShake') for (let i = 0; i < n(4); i++) entry.flakes.emitParticleAt(x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 30, 1);
    }
    const sound = {
      pad: snowy ? 'snowStep' : 'pad', padRun: snowy ? 'snowStep' : 'pad', breath: 'breath', snore: 'snore', roar: 'roar',
      happy: 'happy', grunt: 'grunt', beat: 'pad', furRub: 'furRub', furShake: 'furRub', // a furry chest: a muffled thump
    }[type];
    if (sound) sounds.play(sound, { x, y }, type === 'padRun' ? 1.2 : 1);
  }

  // shock wave spreading on the ground
  ring(x, y, depth) {
    const r = this.scene.add.image(x, y, 'fx-ring').setDepth(depth).setScale(0.25).setAlpha(0.8);
    this.scene.tweens.add({ targets: r, scale: 1.7, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => r.destroy() });
  }

  // A small shake of the camera for a big impact, only when it is on screen, close enough, and not too often.
  cameraShake(s) {
    const cam = this.scene.cameras.main;
    const now = this.scene.time.now;
    if (cam.zoom < 0.8 || !this.detail(s) || now - (this.lastShake ?? -1e9) < 5000) return;
    this.lastShake = now;
    cam.shake(170, 0.0022 * Math.min(1.5, cam.zoom));
  }

  // The ground trembles around (x, y): `amp` px, within `radius` px, for `ms`.
  tremor(x, y, amp, radius, ms) {
    this.tremors ??= [];
    this.tremors.push({ x, y, amp, radius, ms, t0: this.scene.time.now });
    if (this.tremors.length > 8) this.tremors.shift();
  }

  // Vertical offset (px) of something standing at (x, y) right now, because of the tremors.
  tremorAt(x, y) {
    if (!this.tremors?.length) return 0;
    const now = this.scene.time.now;
    let dy = 0;
    this.tremors = this.tremors.filter((t) => now - t.t0 < t.ms);
    for (const t of this.tremors) {
      const d = Math.hypot(x - t.x, (y - t.y) * 2);
      if (d > t.radius) continue;
      const fade = (1 - (now - t.t0) / t.ms) * (1 - d / t.radius);
      dy += t.amp * fade * Math.sin((now - t.t0) * 0.09);
    }
    return dy;
  }

  // Eyes glowing in the dark of a shelter, at (x, y), `alpha` 0 to hide them.
  shelterEyes(entry, x, y, alpha, tint) {
    if (alpha <= 0.01) {
      if (entry.eyes) entry.eyes.setVisible(false);
      return;
    }
    if (!entry.eyes) entry.eyes = this.scene.add.image(0, 0, 'fx-eyes').setBlendMode('ADD');
    entry.eyes.setVisible(true).setPosition(x, y).setDepth(y + 20).setTint(tint).setAlpha(alpha).setScale(0.8);
  }

  // The monster is no longer drawn (caught and put in the hatchery...): vanish and free its effects.
  remove(entry) {
    if (entry.eyes) entry.eyes.destroy();
    if (entry.ghostState !== undefined) this.vanish(entry, entry.lastScreen);
    if (entry.xfade) entry.xfade.destroy();
    if (entry.glow) entry.glow.destroy();
    if (entry.glowSprite) entry.glowSprite.destroy();
    for (const e of [entry.dust, entry.chips, entry.cloud, entry.vapor, entry.snow, entry.flakes]) {
      if (!e) continue;
      e.stop();
      this.scene.time.delayedCall(1500, () => e.destroy());
    }
    if (entry.mist) {
      const e = entry.mist;
      e.stop();
      this.scene.time.delayedCall(2300, () => e.destroy()); // let the last puffs fade
    }
  }
}
