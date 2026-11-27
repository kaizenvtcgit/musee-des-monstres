// Path tool: a dragged path always stays a straight row or column of tiles, along the axis
// the pointer moved most, so it never wanders off sideways in the isometric view.
export function straightLine(start, end) {
  const dx = end.tx - start.tx, dy = end.ty - start.ty;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const n = alongX ? Math.abs(dx) : Math.abs(dy);
  const sx = alongX ? Math.sign(dx) : 0, sy = alongX ? 0 : Math.sign(dy);
  const cells = [];
  for (let i = 0; i <= n; i++) cells.push({ tx: start.tx + sx * i, ty: start.ty + sy * i });
  return cells;
}

// What laying this line costs: tiles for which isSkipped(tx, ty) is true (already a path,
// or not buildable) are not paid.
export function pathLineCost(cells, isSkipped, pricePerTile) {
  const tiles = cells.filter((c) => !isSkipped(c.tx, c.ty)).length;
  return { tiles, cost: tiles * pricePerTile };
}
