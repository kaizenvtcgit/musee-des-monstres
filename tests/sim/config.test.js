import { describe, it, expect } from 'vitest';
import { SPECIES, LOCATIONS, HABITATS } from '../../src/config/species.js';
import { BALANCE } from '../../src/config/balance.js';
import { t } from '../../src/i18n/index.js';
import { createRng } from '../../src/sim/rng.js';

describe('config', () => {
  it('every species habitat is one of the 5 habitats', () => {
    expect(HABITATS).toHaveLength(15);
    for (const s of Object.values(SPECIES)) expect(HABITATS).toContain(s.habitat);
    expect(Object.keys(SPECIES)).toHaveLength(5);
  });

  it('every location lists only existing species', () => {
    expect(Object.keys(LOCATIONS)).toHaveLength(5);
    for (const l of Object.values(LOCATIONS)) {
      for (const id of l.species) expect(SPECIES[id]).toBeDefined();
    }
  });

  it('balance has the start money from the spec', () => {
    expect(BALANCE.startMoney).toBe(5000);
    expect(BALANCE.hatcheryCapacity).toBe(3);
  });
});

describe('i18n', () => {
  it('t returns French string and interpolates', () => {
    expect(t('hud.money', { n: 12 })).toContain('12');
  });
  it('t returns key when missing', () => {
    expect(t('nope.key')).toBe('nope.key');
  });
});

describe('rng', () => {
  it('same seed gives same sequence in [0,1)', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
