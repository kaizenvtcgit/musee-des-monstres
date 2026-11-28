import { describe, it, expect } from 'vitest';
import { canStepOver } from '../../src/render/stepover.js';
import { ENCLOSURE_DECOR, DECOR_HEIGHT } from '../../src/config/decor.js';

describe('canStepOver', () => {
  it('every decoration has a height', () => {
    for (const id of Object.keys(ENCLOSURE_DECOR)) expect(DECOR_HEIGHT[id], id).toBeGreaterThan(0);
  });
  it('the yeti (3 m) steps over a frost rock (1 m), not over an ice block (1.45 m) nor a fir', () => {
    expect(canStepOver('frostRock', 'yeti')).toBe(true);
    expect(canStepOver('iceBlock', 'yeti')).toBe(false);
    expect(canStepOver('snowyFir', 'yeti')).toBe(false);
  });
  it('the dragon (2.2 m) steps over a fumarole, not over a lava rock (1 m) nor a tall obsidian', () => {
    expect(canStepOver('fumarole', 'dragonnet')).toBe(true);
    expect(canStepOver('lavaRock', 'dragonnet')).toBe(false);
    expect(canStepOver('obsidian', 'dragonnet')).toBe(false);
  });
  it('low decorations for everyone, and a floating ghost over anything', () => {
    expect(canStepOver('fern', 'kraken')).toBe(true);
    expect(canStepOver('gothicStatue', 'spectre', true)).toBe(true);
  });
});
