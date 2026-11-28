// Which way something placed on the map faces, in quarter turns q (0..3): its front (a stand's counter, a
// shelter's mouth) looks toward +y at 0, then -x at 1, -y at 2, +x at 3 (a quarter turn each time).

export const turns = (q) => (((Math.round(q) % 4) + 4) % 4);

// A tile offset (dx, dy) of something facing +y, turned by q quarter turns.
export function turnOffset(dx, dy, q) {
  for (let i = 0; i < turns(q); i++) [dx, dy] = [-dy, dx];
  return { dx: dx + 0, dy: dy + 0 }; // (+ 0: no -0)
}

// The same, back: an offset of the turned thing, in its own frame (facing +y).
export const unturnOffset = (dx, dy, q) => turnOffset(dx, dy, 4 - turns(q));

// The turn of the 3D view (radians around its vertical axis, +z being +y) for q quarter turns.
export const quarterAngle = (q) => (-turns(q) * Math.PI) / 2;

// The quarter turns that point the front of tiles x0..x1, y0..y1 toward the nearest path next to them (0 if none).
export function faceToPath(grid, x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let best = null;
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!grid.inBounds(x, y) || !grid.isPath(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d) best = { d, dx: x - cx, dy: y - cy };
    }
  }
  if (!best) return 0;
  // keep to the four sides
  return turns(-Math.round(Math.atan2(best.dx, best.dy) / (Math.PI / 2)));
}
