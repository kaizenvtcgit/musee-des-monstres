// Which enclosure decorations a monster walks over instead of going around them.
import { ENCLOSURE_DECOR, DECOR_HEIGHT } from '../config/decor.js';

// Height of each monster in metres, as drawn in the 3D view (src/render3d/park-scene.js, MONSTERS).
export const MONSTER_HEIGHT = { golem: 3.4, yeti: 3.0, dragonnet: 2.2, spectre: 2.5, kraken: 2.4 };

// A step over something up to about a third of its height (a knee); a floating ghost passes over all.
const STEP = 0.35;

export function canStepOver(decorType, speciesId, floats = false) {
  if (floats || ENCLOSURE_DECOR[decorType]?.low) return true;
  const h = DECOR_HEIGHT[decorType];
  const mh = MONSTER_HEIGHT[speciesId];
  return h != null && mh != null && h <= STEP * mh;
}
