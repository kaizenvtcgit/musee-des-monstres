export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = Array.from({ length: w * h }, () => ({ ground: 'grass', occupant: null, bridge: null, stair: null }));
    this.version = 0; // bumped on every change, lets the renderer redraw lazily
  }

  inBounds(tx, ty) {
    return Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  getTile(tx, ty) {
    return this.inBounds(tx, ty) ? this.tiles[ty * this.w + tx] : null;
  }

  setGround(tx, ty, ground) {
    this.getTile(tx, ty).ground = ground;
    this.version++;
  }

  setOccupant(tx, ty, id) {
    this.getTile(tx, ty).occupant = id;
    this.version++;
  }

  // A bridge (its id, or null) over an enclosure tile: the tile stays the enclosure's (the monsters
  // walk under it) and becomes walkable for visitors and keepers (src/sim/bridge.js).
  setBridge(tx, ty, id) {
    this.getTile(tx, ty).bridge = id;
    this.version++;
  }

  // The stairs of a bridge (its id): the path tile at one end of its deck, the only way on and off.
  setStair(tx, ty, id) {
    this.getTile(tx, ty).stair = id;
    this.version++;
  }

  // Whether someone may step from one tile to its neighbour as far as bridges go: onto or off a deck only
  // from its own deck or its stairs (never through its railing, never from one bridge to another).
  canStep(ax, ay, bx, by) {
    const a = this.getTile(ax, ay), b = this.getTile(bx, by);
    if (!a || !b) return false;
    if (!a.bridge && !b.bridge) return true;
    if (a.bridge && b.bridge) return a.bridge === b.bridge;
    return b.bridge ? a.stair === b.bridge : b.stair === a.bridge;
  }

  isBridge(tx, ty) {
    const t = this.getTile(tx, ty);
    return !!t && !!t.bridge;
  }

  // Where people walk: a path tile with nothing on it, or a bridge.
  isWalkable(tx, ty) {
    const t = this.getTile(tx, ty);
    return !!t && (!!t.bridge || (t.ground === 'path' && t.occupant === null));
  }

  isFree(tx, ty) {
    const t = this.getTile(tx, ty);
    return !!t && t.ground === 'grass' && t.occupant === null;
  }

  isPath(tx, ty) {
    const t = this.getTile(tx, ty);
    return !!t && t.ground === 'path' && !t.bridge;
  }

  neighbors4(tx, ty) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => ({ tx: tx + dx, ty: ty + dy }))
      .filter((p) => this.inBounds(p.tx, p.ty));
  }
}
