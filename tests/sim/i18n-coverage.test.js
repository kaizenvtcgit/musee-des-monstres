import { describe, it, expect } from 'vitest';
import { fr } from '../../src/i18n/fr.js';
import { OBJECTIVES } from '../../src/sim/objectives.js';
import { SPECIES, LOCATIONS, HABITATS } from '../../src/config/species.js';

describe('French strings', () => {
  it('every objective, species, location and habitat has a string', () => {
    const keys = [
      ...OBJECTIVES.map((o) => `objective.${o.id}`),
      ...Object.keys(SPECIES).map((s) => `species.${s}`),
      ...Object.keys(LOCATIONS).map((l) => `location.${l}`),
      ...HABITATS.map((h) => `habitat.${h}`),
    ];
    for (const k of keys) expect(fr[k], k).toBeTypeOf('string');
  });

  it('bridge strings exist', () => {
    for (const k of ['tool.bridge', 'tool.bridgeHint', 'cost.bridge', 'error.bridgeTooShort', 'error.bridgeNoEnclosure', 'error.bridgeEnds', 'error.bridgeBlocked', 'error.underBridge']) {
      expect(fr[k], k).toBeTypeOf('string');
    }
  });

  it('no mojibake (broken accents) in strings', () => {
    for (const [k, v] of Object.entries(fr)) expect(v, k).not.toMatch(/Ã|Â|Å/);
  });
});
