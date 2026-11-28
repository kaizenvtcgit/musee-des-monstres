// The snack stands the player can choose from (same price and earnings; only the look and name change).
// model: its 3D model (src/assets/3d/<model>.glb.json); front: turn (radians) that brings its counter to the
// model's +z side, which the 3D view then turns toward the nearest path. vendor: where its vendor stands, in
// metres from the stand's centre in the model's frame (x across, z toward the counter, y up: lower or higher
// than the ground so his chest is at the counter), and his turn (radians) from facing +z. He stands in a hollow
// carved behind a service window of the model (models/stand-*.glb); the rest of him is hidden in the stand.
// fire: live flames in its oven, { x, y (their base), z, w (width), h (height) } in metres in the same frame.
export const SNACK_STANDS = {
  dragonGrill: { id: 'dragonGrill', model: 'stand-dragon-grill', front: 0, vendor: { x: 0, y: 0.1, z: 0.9, turn: 0 }, fire: { x: 0, y: 1.04, z: 0, w: 0.95, h: 0.6 } }, // its sign and dragon-head grill on +z; its vendor at the counter, the head set back behind him
  krakenWaffles: { id: 'krakenWaffles', model: 'stand-kraken-waffles', front: 0, vendor: { x: -0.02, y: -0.25, z: 0.22, turn: 0 } }, // its vendor in the counter's window
};

// The looks of the Snack menu (src/render/ui.js SNACKS) and their stand.
const LOOKS = { waffles: 'krakenWaffles', grill: 'dragonGrill' };

// The stand of a snack building: the one chosen when it was built; the stands of older saved games (built
// before there was a choice) keep the look they had, picked from their id.
export function standOf(building) {
  if (SNACK_STANDS[building.variant]) return SNACK_STANDS[building.variant];
  if (LOOKS[building.look]) return SNACK_STANDS[LOOKS[building.look]]; // picked in the Snack menu by its look
  const n = Number(String(building.id).replace(/\D/g, '')) || 0;
  return n % 2 ? SNACK_STANDS.krakenWaffles : SNACK_STANDS.dragonGrill;
}
