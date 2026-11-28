import { BALANCE } from '../config/balance.js';
import { ENCLOSURE_DECOR } from '../config/decor.js';
import { HABITAT_FAMILY } from '../config/species.js';
import { rectsOf, containsTile, tilesOf, fitBox } from './enclosure.js';
import { turns, faceToPath } from './facing.js';
import { checkBridge } from './bridge.js';

const BUILDING_DEFS = {
  decoration: { size: 1, price: BALANCE.decorationCost },
  snack: { size: 1, price: BALANCE.snackCost },
  souvenir: { size: 1, price: BALANCE.souvenirCost },
  atm: { size: 1, price: BALANCE.atmCost }, // a cash machine (visitors walking past spend more: visitors.js)
  expeditionBase: { size: 3, price: 0 }, // a big military tent (older saved games: 2 x 2, see growBuilding)
  hatchery: { size: 2, price: 0 },
};

const fail = (reason) => ({ ok: false, reason });

// The buildings that can be turned once placed (the stands, the shop, the garden decorations).
export const ROTATABLE_BUILDINGS = new Set(['snack', 'souvenir', 'decoration']);

// Tiles per side of a shelter (shelters of older saved games, without a size, are 2 x 2).
export const shelterSize = (s) => (s && s.size) || 2;

// Price of an enclosure dragged between two corner tiles (any order): its area x the price per tile.
// Used both to build it and to show its price while dragging, so the two always match.
export function enclosurePrice(ax, ay, bx, by) {
  const area = (Math.abs(bx - ax) + 1) * (Math.abs(by - ay) + 1);
  return area * BALANCE.enclosureCostPerTile;
}

export class Builder {
  constructor(grid, wallet) {
    this.grid = grid;
    this.wallet = wallet;
    this.enclosures = new Map();
    this.buildings = new Map();
    this.nextId = 1;
    // Set by World: called with the monster ids when their enclosure is demolished.
    // Must return true if all of them could be moved away.
    this.onEnclosureEmptied = () => true;
    // Set by World: true when a moving entity (escaped monster) stands on the tile.
    this.isBlocked = () => false;
    // "tx,ty" of path tiles that cannot be demolished (the entrance).
    this.protectedTiles = new Set();
    // Set by World: called when enclosure `fromId` was merged into `toId` (its monsters move over).
    this.onEnclosuresMerged = () => {};
    // Bridges over enclosures (src/sim/bridge.js): id -> { id, deck: [{tx,ty}], stairs: [{tx,ty,dx,dy}], price }.
    this.bridges = new Map();
    // Set by World: called with a bridge just taken down (who stood on it gets off).
    this.onBridgeRemoved = () => {};
  }

  // A bridge along the trace drawn tile by tile (see checkBridge): its deck over the enclosures, paths on
  // the grass tiles of the trace.
  placeBridge(trace) {
    const r = checkBridge(this.grid, this, trace);
    if (!r.ok) return fail(r.reason);
    if (!this.wallet.spend(r.cost)) return fail('noMoney');
    for (const c of r.paths) this.grid.setGround(c.tx, c.ty, 'path');
    const id = `brg${this.nextId++}`;
    for (const c of r.deck) this.grid.setBridge(c.tx, c.ty, id);
    for (const s of r.stairs) this.grid.setStair(s.tx, s.ty, id);
    this.bridges.set(id, { id, deck: r.deck, stairs: r.stairs, price: r.deck.length * BALANCE.bridgeCostPerTile });
    return { ok: true, id, cost: r.cost };
  }

  // Takes the whole bridge down (paid back like the rest); the paths at its ends stay. Returns its deck size.
  removeBridge(id) {
    const b = this.bridges.get(id);
    if (!b) return 0;
    for (const c of b.deck) this.grid.setBridge(c.tx, c.ty, null);
    for (const s of b.stairs) this.grid.setStair(s.tx, s.ty, null);
    this.bridges.delete(id);
    this.wallet.earn(b.price * BALANCE.demolishRefund);
    this.onBridgeRemoved(b);
    return b.deck.length;
  }

  // The bridge whose deck or stairs are on this tile, or null.
  bridgeAt(tx, ty) {
    const id = this.grid.getTile(tx, ty)?.bridge;
    if (id) return this.bridges.get(id) ?? null;
    for (const b of this.bridges.values()) if (b.stairs.some((s) => s.tx === tx && s.ty === ty)) return b;
    return null;
  }

  placePath(tx, ty) {
    if (!this.grid.inBounds(tx, ty)) return fail('outOfBounds');
    if (!this.grid.isFree(tx, ty)) return fail('occupied');
    if (!this.wallet.spend(BALANCE.pathCost)) return fail('noMoney');
    this.grid.setGround(tx, ty, 'path');
    return { ok: true };
  }

  placeEnclosure(ax, ay, bx, by, habitat) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    if (!this.grid.inBounds(x0, y0) || !this.grid.inBounds(x1, y1)) return fail('outOfBounds');
    if (x1 - x0 < 1 || y1 - y0 < 1) return fail('tooSmall');
    if (!this.#rectFree(x0, y0, x1, y1)) return fail('occupied');
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    const price = enclosurePrice(ax, ay, bx, by);
    if (!this.wallet.spend(price)) return fail('noMoney');
    const id = `enc${this.nextId++}`;
    const e = {
      id, x0, y0, x1, y1, rects: [{ x0, y0, x1, y1 }], habitat, area, price, monsterIds: [], speciesId: null, breedTimer: 0, decor: [],
    };
    this.enclosures.set(id, e);
    this.#fillRect(x0, y0, x1, y1, id);
    // enclosures of the same habitat sharing a side with it become one enclosure (the oldest keeps its id)
    const touching = this.#sameHabitatNeighbours(e);
    if (!touching.length) return { ok: true, id };
    const [into, ...rest] = touching.sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
    for (const other of [...rest, e]) this.#merge(other, into);
    return { ok: true, id: into.id, merged: true };
  }

  // Enclosures of e's habitat (and compatible species) that share at least one tile side with e.
  #sameHabitatNeighbours(e) {
    const found = new Map();
    for (const { tx, ty } of tilesOf(e)) {
      for (const n of this.grid.neighbors4(tx, ty)) {
        const id = this.grid.getTile(n.tx, n.ty).occupant;
        const o = id && id !== e.id && this.enclosures.get(id);
        if (!o || o.habitat !== e.habitat) continue;
        found.set(id, o);
      }
    }
    // never two species in one enclosure
    const species = new Set([...found.values()].map((o) => o.speciesId).filter(Boolean));
    if (species.size > 1) return [];
    return [...found.values()];
  }

  // Moves everything of `from` (tiles, monsters, decorations, shelter, cost) into `into`.
  #merge(from, into) {
    into.rects = [...rectsOf(into), ...rectsOf(from)];
    fitBox(into);
    into.area += from.area;
    into.price += from.price;
    into.monsterIds.push(...from.monsterIds);
    into.speciesId ??= from.speciesId;
    into.breedTimer = Math.max(into.breedTimer ?? 0, from.breedTimer ?? 0);
    into.decor = [...(into.decor ?? []), ...(from.decor ?? [])];
    if (from.shelter) {
      if (into.shelter) this.wallet.earn(from.shelter.price); // one shelter per enclosure: the other is paid back
      else into.shelter = from.shelter;
    }
    for (const r of rectsOf(from)) this.#fillRect(r.x0, r.y0, r.x1, r.y1, into.id);
    this.enclosures.delete(from.id);
    this.onEnclosuresMerged(from.id, into.id);
  }

  // A decoration (src/config/decor.js) on a tile inside an enclosure of its habitat, one per tile.
  // `rot`: which way it faces (quarter turns, src/sim/facing.js); none: as it comes.
  placeDecor(tx, ty, type, rot = null) {
    const def = ENCLOSURE_DECOR[type];
    const tile = this.grid.getTile(tx, ty);
    if (!def || !tile) return fail('outOfBounds');
    const e = tile.occupant && this.enclosures.get(tile.occupant);
    if (!e) return fail('notInEnclosure');
    if (e.habitat !== def.habitat) return fail('wrongDecorHabitat');
    e.decor ??= [];
    if (e.decor.some((d) => d.tx === tx && d.ty === ty) || this.shelterAt(tx, ty)) return fail('occupied');
    if (!def.low && this.grid.isBridge(tx, ty)) return fail('underBridge');
    if (!this.wallet.spend(def.price)) return fail('noMoney');
    const id = `dec${this.nextId++}`;
    const d = { id, type, tx, ty, price: def.price };
    if (rot != null) d.rot = turns(rot);
    e.decor.push(d);
    this.grid.version++; // redraw
    return { ok: true, id, enclosureId: e.id };
  }

  // A shelter (cave, mausoleum... see SHELTERS) on size x size tiles of an enclosure, from (tx, ty);
  // one per enclosure. Its entrance faces +y, turned by `rot` quarter turns (src/sim/facing.js).
  placeShelter(tx, ty, rot = 0) {
    const n = BALANCE.shelterSize;
    const tile = this.grid.getTile(tx, ty);
    if (!tile) return fail('outOfBounds');
    const e = tile.occupant && this.enclosures.get(tile.occupant);
    if (!e) return fail('notInEnclosure');
    if (e.shelter) return fail('hasShelter');
    if (e.area < BALANCE.shelterMinArea) return fail('enclosureTooSmall');
    // every one of its n x n tiles in the enclosure (a merged enclosure is not always a rectangle)
    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) if (!containsTile(e, tx + dx, ty + dy)) return fail('shelterOutside');
    for (const d of e.decor ?? []) if (d.tx >= tx && d.tx < tx + n && d.ty >= ty && d.ty < ty + n) return fail('occupied');
    for (let dx = 0; dx < n; dx++) for (let dy = 0; dy < n; dy++) if (this.grid.isBridge(tx + dx, ty + dy)) return fail('underBridge');
    if (!this.wallet.spend(BALANCE.shelterCost)) return fail('noMoney');
    e.shelter = { id: `she${this.nextId++}`, family: HABITAT_FAMILY[e.habitat], tx, ty, size: n, rot: turns(rot ?? 0), price: BALANCE.shelterCost, occupant: null };
    this.grid.version++; // redraw
    return { ok: true, id: e.shelter.id, enclosureId: e.id };
  }

  // The shelter covering this tile, with its enclosure, or null.
  shelterAt(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    const e = tile && tile.occupant && this.enclosures.get(tile.occupant);
    const s = e && e.shelter;
    const n = shelterSize(s);
    return s && tx >= s.tx && tx < s.tx + n && ty >= s.ty && ty < s.ty + n ? { shelter: s, enclosure: e } : null;
  }

  // The decoration on this tile, with its enclosure, or null.
  decorAt(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    const e = tile && tile.occupant && this.enclosures.get(tile.occupant);
    const d = e && (e.decor ?? []).find((x) => x.tx === tx && x.ty === ty);
    return d ? { decor: d, enclosure: e } : null;
  }

  // opts.free: no cost (initial world); opts.fixed: cannot be demolished.
  // opts.look: which one it is, picked in the menus (a garden decoration: 'parkBench', 'trashCan'...;
  // a snack: 'waffles' or 'grill'); without it (older games), the look is picked from its id.
  placeBuilding(type, tx, ty, opts = {}) {
    const def = BUILDING_DEFS[type];
    const x1 = tx + def.size - 1, y1 = ty + def.size - 1;
    if (!this.grid.inBounds(tx, ty) || !this.grid.inBounds(x1, y1)) return fail('outOfBounds');
    if (!this.#rectFree(tx, ty, x1, y1)) return fail('occupied');
    const price = opts.free ? 0 : def.price;
    if (!this.wallet.spend(price)) return fail('noMoney');
    const id = `${type}${this.nextId++}`;
    const b = { id, type, x0: tx, y0: ty, x1, y1, price, fixed: !!opts.fixed };
    if (opts.variant) b.variant = opts.variant; // which snack stand (src/config/stands.js)
    if (opts.rot != null) b.rot = turns(opts.rot); // which way it faces (src/sim/facing.js)
    if (opts.look) b.look = opts.look;
    this.buildings.set(id, b);
    this.#fillRect(tx, ty, x1, y1, id);
    return { ok: true, id };
  }

  // Turns a placed stand, shop or garden decoration a quarter turn (src/sim/facing.js). One placed before
  // there was a choice starts from the way it was drawn: facing its path.
  rotateBuilding(id) {
    const b = this.buildings.get(id);
    if (!b || !ROTATABLE_BUILDINGS.has(b.type)) return fail('cannotRotate');
    const from = b.rot ?? faceToPath(this.grid, b.x0, b.y0, b.x1, b.y1);
    b.rot = turns(from + 1);
    this.grid.version++; // redraw
    return { ok: true, id, rot: b.rot };
  }

  demolish(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    if (!tile) return fail('outOfBounds');
    const id = tile.occupant;
    // a bridge goes first (its deck or one of its stairs), before what is under it
    const bridge = this.bridgeAt(tx, ty);
    if (bridge) {
      this.removeBridge(bridge.id);
      return { ok: true, id: bridge.id };
    }
    // a decoration goes first, before its enclosure
    const found = this.decorAt(tx, ty);
    if (found) {
      found.enclosure.decor = found.enclosure.decor.filter((d) => d !== found.decor);
      this.wallet.earn(found.decor.price * BALANCE.demolishRefund);
      this.grid.version++;
      return { ok: true, id: found.decor.id };
    }
    const sheltered = this.shelterAt(tx, ty);
    if (sheltered) {
      sheltered.enclosure.shelter = null; // its occupant comes out (updateShelter)
      this.wallet.earn(sheltered.shelter.price * BALANCE.demolishRefund);
      this.grid.version++;
      return { ok: true, id: sheltered.shelter.id };
    }
    if (id && this.enclosures.has(id)) {
      const e = this.enclosures.get(id);
      if (e.monsterIds.length && !this.onEnclosureEmptied([...e.monsterIds])) return fail('enclosureNotEmpty');
      e.monsterIds = [];
      // the bridges over it come down first
      for (const br of [...this.bridges.values()]) if (br.deck.some((c) => containsTile(e, c.tx, c.ty))) this.removeBridge(br.id);
      this.enclosures.delete(id);
      for (const r of rectsOf(e)) this.#fillRect(r.x0, r.y0, r.x1, r.y1, null);
      const decorPrice = (e.decor ?? []).reduce((s, d) => s + d.price, 0) + (e.shelter?.price ?? 0);
      this.wallet.earn((e.price + decorPrice) * BALANCE.demolishRefund);
      return { ok: true, id };
    }
    if (id && this.buildings.has(id)) {
      const b = this.buildings.get(id);
      if (b.fixed) return fail('notDemolishable');
      this.buildings.delete(id);
      this.#fillRect(b.x0, b.y0, b.x1, b.y1, null);
      this.wallet.earn(b.price * BALANCE.demolishRefund);
      return { ok: true, id };
    }
    if (tile.ground === 'path') {
      if (this.protectedTiles.has(`${tx},${ty}`)) return fail('notDemolishable');
      this.grid.setGround(tx, ty, 'grass');
      this.wallet.earn(BALANCE.pathCost * BALANCE.demolishRefund);
      return { ok: true };
    }
    return fail('nothing');
  }

  entity(id) {
    return this.enclosures.get(id) || this.buildings.get(id) || null;
  }

  // Path tiles adjacent to the entity, in row order.
  accessTiles(id) {
    const e = this.entity(id);
    if (!e) return [];
    const out = [];
    const seen = new Set();
    // the tiles touching a side of the entity (not only a corner)
    const tiles = this.enclosures.has(id) ? tilesOf(e) : tilesOf({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 });
    const own = (x, y) => (this.enclosures.has(id) ? containsTile(e, x, y) : x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1);
    for (const t of tiles) {
      for (const [x, y] of [[t.tx + 1, t.ty], [t.tx - 1, t.ty], [t.tx, t.ty + 1], [t.tx, t.ty - 1]]) {
        if (own(x, y) || seen.has(`${x},${y}`)) continue;
        seen.add(`${x},${y}`);
        if (this.grid.isPath(x, y)) out.push({ tx: x, ty: y });
      }
      // an enclosure is also watched from the bridges over it
      if (this.enclosures.has(id) && this.grid.isBridge(t.tx, t.ty)) out.push({ tx: t.tx, ty: t.ty });
    }
    return out.sort((a, b) => a.tx - b.tx || a.ty - b.ty);
  }

  touchesPath(id) {
    return this.accessTiles(id).length > 0;
  }

  // A fixed building of an older saved game smaller than it is now (the expedition base was 2 x 2) grows to its
  // size: in place if the tiles around are free, otherwise it moves to the nearest free spot. Kept as it is
  // if there is no room anywhere. Returns true if it changed.
  growBuilding(b) {
    const n = BUILDING_DEFS[b.type]?.size;
    if (!n || b.x1 - b.x0 + 1 >= n) return false;
    const freeFor = (x0, y0) => {
      if (!this.grid.inBounds(x0, y0) || !this.grid.inBounds(x0 + n - 1, y0 + n - 1)) return false;
      for (let y = y0; y < y0 + n; y++) {
        for (let x = x0; x < x0 + n; x++) {
          const t = this.grid.getTile(x, y);
          if (t.occupant === b.id) continue;
          if (!this.grid.isFree(x, y) || this.isBlocked(x, y)) return false;
        }
      }
      return true;
    };
    // the squares that contain it first, then the others from the nearest
    let spot = null, best = Infinity;
    for (let y0 = 0; y0 < this.grid.h; y0++) {
      for (let x0 = 0; x0 < this.grid.w; x0++) {
        const covers = x0 <= b.x0 && y0 <= b.y0 && x0 + n - 1 >= b.x1 && y0 + n - 1 >= b.y1;
        const d = covers ? -1 : Math.hypot(x0 - b.x0, y0 - b.y0);
        if (d < best && freeFor(x0, y0)) { best = d; spot = { x0, y0 }; }
      }
    }
    if (!spot) return false;
    this.#fillRect(b.x0, b.y0, b.x1, b.y1, null);
    Object.assign(b, { x0: spot.x0, y0: spot.y0, x1: spot.x0 + n - 1, y1: spot.y0 + n - 1 });
    this.#fillRect(b.x0, b.y0, b.x1, b.y1, b.id);
    return true;
  }

  #rectFree(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (!this.grid.isFree(x, y) || this.isBlocked(x, y)) return false;
    }
    return true;
  }

  #fillRect(x0, y0, x1, y1, id) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.grid.setOccupant(x, y, id);
  }
}
