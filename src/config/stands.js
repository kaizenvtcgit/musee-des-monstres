// The snack stands the player can choose from (same price and earnings; only the look and name change).
// model: its 3D model (src/assets/3d/<model>.glb.json); front: turn (radians) that brings its counter to the
// model's +z side, which the 3D view then turns toward the nearest path.
export const SNACK_STANDS = {
  dragonGrill: { id: 'dragonGrill', model: 'stand-dragon-grill', front: 0 }, // its sign and dragon-head grill on +z
  krakenWaffles: { id: 'krakenWaffles', model: 'stand-kraken-waffles', front: 0 },
};

// The stand of a snack building: the one chosen when it was built; the stands of older saved games (built
// before there was a choice) keep the look they had, picked from their id.
export function standOf(building) {
  if (SNACK_STANDS[building.variant]) return SNACK_STANDS[building.variant];
  const n = Number(String(building.id).replace(/\D/g, '')) || 0;
  return n % 2 ? SNACK_STANDS.krakenWaffles : SNACK_STANDS.dragonGrill;
}
