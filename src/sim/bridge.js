// Bridges over enclosures (docs/superpowers/specs/2026-11-28-ponts-design.md). A bridge is drawn freely,
// tile by tile (extendTrace), then checked (checkBridge). Its deck runs from the first to the last enclosure
// tile of the trace; the tile just before and just after are its stairs (plain paths on the ground).
import { BALANCE } from '../config/balance.js';
import { ENCLOSURE_DECOR } from '../config/decor.js';

const isNeighbour = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) === 1;
const same = (a, b) => a.tx === b.tx && a.ty === b.ty;
const cell = ({ tx, ty }) => ({ tx, ty });

// The trace with `tile` added (a neighbour of its last tile), or its last tile taken off (back onto the
// one before), or unchanged (anything else: not a neighbour, already in the trace).
export function extendTrace(trace, tile) {
  if (!trace.length) return [cell(tile)];
  if (trace.length >= 2 && same(trace[trace.length - 2], tile)) return trace.slice(0, -1);
  if (!isNeighbour(trace[trace.length - 1], tile) || trace.some((c) => same(c, tile))) return trace;
  return [...trace, cell(tile)];
}

// The trace drawn on to `tile`, filling the tiles a fast pointer skipped (one step at a time, along the
// longer side first). Back onto a tile of the trace: shortened to it. Stops before crossing itself.
export function traceToward(trace, tile) {
  if (!trace.length) return [cell(tile)];
  const i = trace.findIndex((c) => same(c, tile));
  if (i >= 0) return trace.slice(0, i + 1);
  let t = trace;
  for (let guard = 0; guard < 400 && !same(t[t.length - 1], tile); guard++) {
    const last = t[t.length - 1];
    const dx = Math.sign(tile.tx - last.tx), dy = Math.sign(tile.ty - last.ty);
    const steps = Math.abs(tile.tx - last.tx) >= Math.abs(tile.ty - last.ty)
      ? [{ tx: last.tx + dx, ty: last.ty }, { tx: last.tx, ty: last.ty + dy }]
      : [{ tx: last.tx, ty: last.ty + dy }, { tx: last.tx + dx, ty: last.ty }];
    const next = steps.find((c) => !same(c, last) && !t.some((x) => same(x, c)));
    if (!next) break;
    t = [...t, next];
  }
  return t;
}

// Whether the bridge can be built along `trace`, and what it would lay:
// { ok: true, deck, paths, stairs, cost } or { ok: false, reason, bad }.
// paths: the grass tiles of the trace, which get a path (under the deck too, between two enclosures).
export function checkBridge(grid, builder, trace) {
  const fail = (reason, bad = []) => ({ ok: false, reason, bad: bad.map(cell) });
  if (trace.length < 3) return fail('bridgeTooShort');
  const enclosureAt = (c) => {
    const t = grid.getTile(c.tx, c.ty);
    return (t && t.occupant && builder.enclosures.get(t.occupant)) || null;
  };
  const inside = trace.map((c) => !!enclosureAt(c));
  const first = inside.indexOf(true), last = inside.lastIndexOf(true);
  if (first < 0) return fail('bridgeNoEnclosure');
  const ends = [trace[0], trace[trace.length - 1]].filter((c) => enclosureAt(c) || !grid.isWalkable(c.tx, c.ty) && !grid.isFree(c.tx, c.ty));
  if (ends.length) return fail('bridgeEnds', ends);
  const bad = trace.filter((c) => {
    const t = grid.getTile(c.tx, c.ty);
    if (!t || t.bridge) return true;
    const e = enclosureAt(c);
    if (!e) return !grid.isFree(c.tx, c.ty) && !(t.ground === 'path' && t.occupant === null);
    if (builder.shelterAt(c.tx, c.ty)) return true;
    const d = (e.decor ?? []).find((x) => x.tx === c.tx && x.ty === c.ty);
    return !!d && !ENCLOSURE_DECOR[d.type]?.low;
  });
  if (bad.length) return fail('bridgeBlocked', bad);
  const deck = trace.slice(first, last + 1).map(cell);
  const toward = (s, d) => ({ tx: s.tx, ty: s.ty, dx: d.tx - s.tx, dy: d.ty - s.ty });
  const stairs = [toward(trace[first - 1], trace[first]), toward(trace[last + 1], trace[last])];
  const paths = trace.filter((c) => grid.isFree(c.tx, c.ty)).map(cell);
  const cost = deck.length * BALANCE.bridgeCostPerTile + paths.filter((c) => !deck.some((d) => same(c, d))).length * BALANCE.pathCost;
  return { ok: true, deck, paths, stairs, cost };
}

// Height (m) of a point (tile coordinates, tile centres on whole numbers) for someone walking there:
// the deck height on a bridge, rising up its stairs, 0 elsewhere.
export function bridgeHeightAt(bridges, x, y) {
  const tx = Math.round(x), ty = Math.round(y);
  let h = 0;
  for (const b of bridges) {
    if (b.deck.some((c) => c.tx === tx && c.ty === ty)) return BALANCE.bridgeDeckHeight;
    for (const s of b.stairs) {
      if (s.tx !== tx || s.ty !== ty) continue;
      const u = (x - tx) * s.dx + (y - ty) * s.dy; // -0.5 (outer edge) .. 0.5 (against the deck)
      h = Math.max(h, BALANCE.bridgeDeckHeight * Math.min(1, Math.max(0, u + 0.5)));
    }
  }
  return h;
}
