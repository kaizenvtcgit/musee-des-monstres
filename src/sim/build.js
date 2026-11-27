import { BALANCE } from '../config/balance.js';
import { ENCLOSURE_DECOR } from '../config/decor.js';
import { HABITAT_FAMILY } from '../config/species.js';

const BUILDING_DEFS = {
  decoration: { size: 1, price: BALANCE.decorationCost },
  snack: { size: 1, price: BALANCE.snackCost },
  souvenir: { size: 1, price: BALANCE.souvenirCost },
  expeditionBase: { size: 2, price: 0 },
  hatchery: { size: 2, price: 0 },
};

const fail = (reason) => ({ ok: false, reason });

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
    const price = area * BALANCE.enclosureCostPerTile;
    if (!this.wallet.spend(price)) return fail('noMoney');
    const id = `enc${this.nextId++}`;
    this.enclosures.set(id, {
      id, x0, y0, x1, y1, habitat, area, price, monsterIds: [], speciesId: null, breedTimer: 0, decor: [],
    });
    this.#fillRect(x0, y0, x1, y1, id);
    return { ok: true, id };
  }

  // A decoration (src/config/decor.js) on a tile inside an enclosure of its habitat, one per tile.
  placeDecor(tx, ty, type) {
    const def = ENCLOSURE_DECOR[type];
    const tile = this.grid.getTile(tx, ty);
    if (!def || !tile) return fail('outOfBounds');
    const e = tile.occupant && this.enclosures.get(tile.occupant);
    if (!e) return fail('notInEnclosure');
    if (e.habitat !== def.habitat) return fail('wrongDecorHabitat');
    e.decor ??= [];
    if (e.decor.some((d) => d.tx === tx && d.ty === ty) || this.shelterAt(tx, ty)) return fail('occupied');
    if (!this.wallet.spend(def.price)) return fail('noMoney');
    const id = `dec${this.nextId++}`;
    e.decor.push({ id, type, tx, ty, price: def.price });
    this.grid.version++; // redraw
    return { ok: true, id, enclosureId: e.id };
  }

  // A shelter (cave, mausoleum... see SHELTERS) on 2 x 2 tiles of an enclosure, from (tx, ty) to (tx + 1, ty + 1);
  // one per enclosure. Its entrance faces +y (down-left on screen).
  placeShelter(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    if (!tile) return fail('outOfBounds');
    const e = tile.occupant && this.enclosures.get(tile.occupant);
    if (!e) return fail('notInEnclosure');
    if (e.shelter) return fail('hasShelter');
    if (e.area < BALANCE.shelterMinArea) return fail('enclosureTooSmall');
    if (tx + 1 > e.x1 || ty + 1 > e.y1) return fail('shelterOutside');
    for (const d of e.decor ?? []) if (d.tx >= tx && d.tx <= tx + 1 && d.ty >= ty && d.ty <= ty + 1) return fail('occupied');
    if (!this.wallet.spend(BALANCE.shelterCost)) return fail('noMoney');
    e.shelter = { id: `she${this.nextId++}`, family: HABITAT_FAMILY[e.habitat], tx, ty, price: BALANCE.shelterCost, occupant: null };
    this.grid.version++; // redraw
    return { ok: true, id: e.shelter.id, enclosureId: e.id };
  }

  // The shelter covering this tile, with its enclosure, or null.
  shelterAt(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    const e = tile && tile.occupant && this.enclosures.get(tile.occupant);
    const s = e && e.shelter;
    return s && tx >= s.tx && tx <= s.tx + 1 && ty >= s.ty && ty <= s.ty + 1 ? { shelter: s, enclosure: e } : null;
  }

  // The decoration on this tile, with its enclosure, or null.
  decorAt(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    const e = tile && tile.occupant && this.enclosures.get(tile.occupant);
    const d = e && (e.decor ?? []).find((x) => x.tx === tx && x.ty === ty);
    return d ? { decor: d, enclosure: e } : null;
  }

  // opts.free: no cost (initial world); opts.fixed: cannot be demolished.
  placeBuilding(type, tx, ty, opts = {}) {
    const def = BUILDING_DEFS[type];
    const x1 = tx + def.size - 1, y1 = ty + def.size - 1;
    if (!this.grid.inBounds(tx, ty) || !this.grid.inBounds(x1, y1)) return fail('outOfBounds');
    if (!this.#rectFree(tx, ty, x1, y1)) return fail('occupied');
    const price = opts.free ? 0 : def.price;
    if (!this.wallet.spend(price)) return fail('noMoney');
    const id = `${type}${this.nextId++}`;
    this.buildings.set(id, { id, type, x0: tx, y0: ty, x1, y1, price, fixed: !!opts.fixed });
    this.#fillRect(tx, ty, x1, y1, id);
    return { ok: true, id };
  }

  demolish(tx, ty) {
    const tile = this.grid.getTile(tx, ty);
    if (!tile) return fail('outOfBounds');
    const id = tile.occupant;
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
      this.enclosures.delete(id);
      this.#fillRect(e.x0, e.y0, e.x1, e.y1, null);
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
    for (let y = e.y0 - 1; y <= e.y1 + 1; y++) {
      for (let x = e.x0 - 1; x <= e.x1 + 1; x++) {
        const inside = x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1;
        const corner = (x < e.x0 || x > e.x1) && (y < e.y0 || y > e.y1);
        if (inside || corner) continue;
        if (this.grid.isPath(x, y) && !seen.has(`${x},${y}`)) {
          seen.add(`${x},${y}`);
          out.push({ tx: x, ty: y });
        }
      }
    }
    return out.sort((a, b) => a.tx - b.tx || a.ty - b.ty);
  }

  touchesPath(id) {
    return this.accessTiles(id).length > 0;
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
