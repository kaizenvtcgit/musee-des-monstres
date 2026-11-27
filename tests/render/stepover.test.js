import { describe, it, expect } from 'vitest';
import { canStepOver } from '../../src/render/stepover.js';
import { ENCLOSURE_DECOR, DECOR_HEIGHT } from '../../src/config/decor.js';

describe('canStepOver', () => {
  it('every decoration has a height', () => {
    for (const id of Object.keys(ENCLOSURE_DECOR)) expect(DECOR_HEIGHT[id], id).toBeGreaterThan(0);
  });
  it('the yeti steps over its rocks and ice blocks, not over a fir', () => {
    expect(canStepOver('frostRock', 'yeti')).toBe(true);
    expect(canStepOver('iceBlock', 'yeti')).toBe(true);
    expect(canStepOver('snowyFir', 'yeti')).toBe(false);
  });
  it('the dragon steps over a lava rock, not over a tall obsidian', () => {
    expect(canStepOver('lavaRock', 'dragonnet')).toBe(true);
    expect(canStepOver('obsidian', 'dragonnet')).toBe(false);
  });
  it('low decorations for everyone, and a floating ghost over anything', () => {
    expect(canStepOver('fern', 'kraken')).toBe(true);
    expect(canStepOver('gothicStatue', 'spectre', true)).toBe(true);
  });
});
