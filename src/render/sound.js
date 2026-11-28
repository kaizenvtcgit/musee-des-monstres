// Sound effects made on the fly with the browser's Web Audio synthesizer: no sound files, no dependency,
// and every sound is a little different each time. The audio starts at the first click or key press
// (browsers forbid sound before that). The player can mute it (HUD button), remembered in this browser.
//
// play(type, { x, y }): (x, y) is a point of the park (in tiles): the sound is softer when it is far from the
// 3D camera, panned to its side, and not played at all when too far (see `placer`). A few voices at most at once.

const MUTE_KEY = 'musee-des-monstres:muted';
const MAX_VOICES = 8;
const MIN_GAP_MS = {
  step: 70, grind: 400, clack: 120, slam: 600, rumble: 1500, pebbles: 250, beat: 90,
  pad: 60, snowStep: 60, breath: 1200, snore: 1500, roar: 1500, happy: 1200, grunt: 800, furRub: 250,
};

export class Sounds {
  constructor(scene) {
    this.scene = scene;
    this.ctx = null;
    this.voices = 0;
    this.last = {};
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    const start = () => this.unlock();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  unlock() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    // a gentle limiter so several impacts at once never clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    // one second of white noise, shared by every sound
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // not remembered, still applied
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  // Loudness (0..1) and stereo position (-1..1) of a sound at the point (x, y) of the park (in tiles), or
  // null when out of hearing: the 3D view (src/render3d/park3d.js) sets `placer` to hear from its camera.
  place(x, y) {
    return this.placer ? this.placer(x, y) : { vol: 1, pan: 0 };
  }

  play(type, at, gain = 1) {
    if (!this.ctx || this.muted || this.voices >= MAX_VOICES || this.scene.world.speed === 0) return;
    const now = performance.now();
    if (now - (this.last[type] ?? 0) < (MIN_GAP_MS[type] ?? 80)) return;
    const p = at ? this.place(at.x, at.y) : { vol: 1, pan: 0 };
    if (!p || p.vol < 0.03) return;
    this.last[type] = now;
    const out = this.ctx.createGain();
    out.gain.value = p.vol * gain;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = p.pan;
      out.connect(pan).connect(this.master);
    } else out.connect(this.master);
    const t = this.ctx.currentTime;
    const end = (this[type] ?? this.step).call(this, out, t);
    this.voices++;
    setTimeout(() => { this.voices--; out.disconnect(); }, (end + 0.1) * 1000);
  }

  // ---- building blocks ----

  thump(out, t, f0, f1, dur, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hiss(out, t, dur, vol, type, freq, q = 0.8, attack = 0.005) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  clicks(out, t, n, spread, vol) {
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * spread;
      this.hiss(out, at, 0.025 + Math.random() * 0.03, vol * (0.5 + Math.random() * 0.5), 'bandpass', 1800 + Math.random() * 2400, 3);
    }
  }

  // ---- the sounds (each returns its length in seconds) ----

  // a heavy, deep footstep
  step(out, t) {
    this.thump(out, t, 75 + Math.random() * 10, 38, 0.32, 0.9);
    this.hiss(out, t, 0.2, 0.35, 'lowpass', 260);
    return 0.4;
  }

  // stone rubbing on stone
  grind(out, t) {
    const dur = 0.5 + Math.random() * 0.4;
    this.hiss(out, t, dur, 0.18, 'bandpass', 500 + Math.random() * 300, 1.2, dur * 0.4);
    this.hiss(out, t + 0.05, dur * 0.8, 0.1, 'bandpass', 1400, 2, dur * 0.3);
    return dur + 0.1;
  }

  // rocks knocking together
  clack(out, t) {
    this.clicks(out, t, 3 + Math.floor(Math.random() * 3), 0.25, 0.35);
    this.thump(out, t, 220, 120, 0.08, 0.25);
    return 0.4;
  }

  // the ground slam: a powerful impact with a rumbling tail
  slam(out, t) {
    this.thump(out, t, 62, 26, 0.9, 1);
    this.hiss(out, t, 0.6, 0.6, 'lowpass', 420);
    this.hiss(out, t + 0.05, 1.4, 0.25, 'lowpass', 140, 0.7, 0.2);
    this.clicks(out, t + 0.03, 8, 0.6, 0.3);
    return 1.6;
  }

  // a deep growl
  rumble(out, t) {
    this.hiss(out, t, 1.8, 0.45, 'lowpass', 110, 0.9, 0.6);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    o.frequency.value = 46;
    lfo.frequency.value = 7;
    lg.gain.value = 0.12;
    lfo.connect(lg).connect(g.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.9);
    lfo.stop(t + 1.9);
    return 1.9;
  }

  // small stones trickling down
  pebbles(out, t) {
    this.clicks(out, t, 7 + Math.floor(Math.random() * 5), 0.6, 0.18);
    return 0.8;
  }

  // ---- yeti ----

  // a heavy but padded footstep
  pad(out, t) {
    this.thump(out, t, 62, 34, 0.22, 0.55);
    this.hiss(out, t, 0.12, 0.18, 'lowpass', 300);
    return 0.3;
  }

  // a foot sinking into snow: a soft crunch
  snowStep(out, t) {
    this.thump(out, t, 70, 40, 0.16, 0.35);
    this.hiss(out, t, 0.18, 0.22, 'bandpass', 2600, 1.4, 0.02);
    this.clicks(out, t, 6, 0.12, 0.08);
    return 0.3;
  }

  // a deep breath out
  breath(out, t) {
    this.hiss(out, t, 1.0, 0.12, 'bandpass', 700, 0.7, 0.35);
    return 1.1;
  }

  // a light snore: a rumbling breath in
  snore(out, t) {
    this.hiss(out, t, 0.9, 0.16, 'lowpass', 260, 0.8, 0.4);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 58;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 1);
    return 1;
  }

  // a voiced sound: a buzzing tone through a mouth-like (formant) filter, its pitch going from f0 to f1
  voice(out, t, f0, f1, dur, vol, formant, rough = 0) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = formant;
    f.Q.value = 2.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    if (rough) this.hiss(out, t, dur, rough, 'bandpass', formant * 1.4, 1.2, 0.05);
  }

  // a short grunt
  grunt(out, t) {
    this.voice(out, t, 120, 95, 0.35, 0.5, 520, 0.08);
    return 0.45;
  }

  // joyful hoots, going up
  happy(out, t) {
    this.voice(out, t, 210, 330, 0.28, 0.4, 800);
    this.voice(out, t + 0.3, 240, 400, 0.32, 0.45, 900);
    return 0.7;
  }

  // the intimidating roar
  roar(out, t) {
    this.voice(out, t, 95, 70, 1.4, 0.7, 600, 0.35);
    this.voice(out, t + 0.02, 190, 140, 1.3, 0.25, 1100);
    this.hiss(out, t, 1.2, 0.2, 'lowpass', 180, 0.8, 0.2);
    return 1.5;
  }

  // fur rubbed / shaken
  furRub(out, t) {
    this.hiss(out, t, 0.35, 0.12, 'bandpass', 3200, 0.9, 0.08);
    return 0.4;
  }

  // a stone fist against a stone chest
  beat(out, t) {
    this.thump(out, t, 110, 60, 0.18, 0.7);
    this.hiss(out, t, 0.09, 0.3, 'lowpass', 700);
    this.clicks(out, t, 2, 0.05, 0.15);
    return 0.3;
  }
}
