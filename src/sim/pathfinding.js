// BFS over 4-neighbours. Returns the tiles from `from` (excluded) to `to` (included),
// [] if from equals to, null if unreachable. The goal tile is always enterable.
export function findPath(grid, from, to, { allowGrass = false } = {}) {
  if (!grid.inBounds(to.tx, to.ty)) return null;
  if (from.tx === to.tx && from.ty === to.ty) return [];
  const key = (x, y) => y * grid.w + x;
  const goal = key(to.tx, to.ty);
  const walkable = (x, y) => {
    if (key(x, y) === goal) return true;
    const t = grid.getTile(x, y);
    if (t?.bridge) return true;
    if (!t || t.occupant !== null) return false;
    return allowGrass || t.ground === 'path';
  };
  const prev = new Map([[key(from.tx, from.ty), -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const n of grid.neighbors4(cur.tx, cur.ty)) {
      const k = key(n.tx, n.ty);
      if (prev.has(k) || !walkable(n.tx, n.ty)) continue;
      prev.set(k, key(cur.tx, cur.ty));
      if (k === goal) return rebuild(prev, goal, grid.w);
      queue.push(n);
    }
  }
  return null;
}

// BFS over free tiles (grass or path, not occupied) to the closest tile matching
// isGoal(tx, ty). Returns the steps like findPath, or null if none is reachable.
export function findNearest(grid, from, isGoal) {
  if (isGoal(from.tx, from.ty)) return [];
  const key = (x, y) => y * grid.w + x;
  const prev = new Map([[key(from.tx, from.ty), -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const n of grid.neighbors4(cur.tx, cur.ty)) {
      const k = key(n.tx, n.ty);
      const t = grid.getTile(n.tx, n.ty);
      if (prev.has(k) || (t.occupant !== null && !t.bridge)) continue;
      prev.set(k, key(cur.tx, cur.ty));
      if (isGoal(n.tx, n.ty)) return rebuild(prev, k, grid.w);
      queue.push(n);
    }
  }
  return null;
}

function rebuild(prev, goal, w) {
  const out = [];
  let k = goal;
  while (prev.get(k) !== -1) {
    out.push({ tx: k % w, ty: Math.floor(k / w) });
    k = prev.get(k);
  }
  return out.reverse();
}
