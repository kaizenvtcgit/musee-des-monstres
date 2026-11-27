// Shape of an enclosure. An enclosure is one or several rectangles of tiles (`rects`): two enclosures
// of the same habitat built side by side merge into one (no fence between them), so the shape can be an
// L, a T... `x0, y0, x1, y1` stay the bounding box. Old saves have no `rects`: one rectangle, the box.

export function rectsOf(e) {
  return e.rects ?? [{ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 }];
}

export function containsTile(e, tx, ty) {
  return rectsOf(e).some((r) => tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1);
}

// Every tile of the enclosure, row by row inside each rectangle.
export function tilesOf(e) {
  const out = [];
  for (const r of rectsOf(e)) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push({ tx: x, ty: y });
  return out;
}

// Recomputes the bounding box from the rectangles.
export function fitBox(e) {
  const rs = rectsOf(e);
  e.x0 = Math.min(...rs.map((r) => r.x0));
  e.y0 = Math.min(...rs.map((r) => r.y0));
  e.x1 = Math.max(...rs.map((r) => r.x1));
  e.y1 = Math.max(...rs.map((r) => r.y1));
}

// A point inside the enclosure, near its middle: the middle of its biggest rectangle.
export function centerOf(e) {
  let best = null, area = -1;
  for (const r of rectsOf(e)) {
    const a = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (a > area) { area = a; best = r; }
  }
  return { x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2 };
}
