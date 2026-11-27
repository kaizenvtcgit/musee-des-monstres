// Extra visual effects for some animated monsters (see MONSTER_FX in sprites.js). Everything here is
// drawn on top of the pre-rendered sprite sheets; the game rules never depend on it.
//
// - crossfade: when a monster changes animation, its previous pose fades out over the new one
//   (sprite sheets cannot blend skeleton poses, so the images are blended instead).
// - spectral: a see-through floating ghost: no shadow, gentle levitation, irregular light pulse,
//   faint cold glow on the ground, mist under the body, a smoke trail while moving, and it fades in
//   and out (vanishing through the walls) when it escapes, is caught or placed.
//
// Performance: one mist texture and one glow texture shared by all ghosts; one particle emitter per ghost
// with a small particle cap; fewer particles when zoomed out, none when off screen or zoomed far out.

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

  // The monster is no longer drawn (caught and put in the hatchery...): vanish and free its effects.
  remove(entry) {
    if (entry.ghostState !== undefined) this.vanish(entry, entry.lastScreen);
    if (entry.xfade) entry.xfade.destroy();
    if (entry.glow) entry.glow.destroy();
    if (entry.mist) {
      const e = entry.mist;
      e.stop();
      this.scene.time.delayedCall(2300, () => e.destroy()); // let the last puffs fade
    }
  }
}
