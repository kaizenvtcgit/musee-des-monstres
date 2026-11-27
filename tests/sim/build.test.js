import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder, enclosurePrice } from '../../src/sim/build.js';

function setup(money = 5000) {
  const grid = new Grid(40, 40);
  const wallet = new Wallet(money);
  return { grid, wallet, builder: new Builder(grid, wallet) };
}

describe('Wallet', () => {
  it('spend refuses when not enough or negative', () => {
    const w = new Wallet(100);
    expect(w.spend(150)).toBe(false);
    expect(w.spend(60)).toBe(true);
    expect(w.money).toBe(40);
    w.charge(50);
    expect(w.money).toBe(-10);
    expect(w.canAfford(0)).toBe(false);
  });
});

describe('Builder', () => {
  it('placePath spends pathCost and sets ground', () => {
    const { grid, wallet, builder } = setup();
    expect(builder.placePath(5, 5).ok).toBe(true);
    expect(wallet.money).toBe(4990);
    expect(grid.getTile(5, 5).ground).toBe('path');
  });

  it('placing on occupied tile refuses and keeps money', () => {
    const { wallet, builder } = setup();
    builder.placeBuilding('decoration', 3, 3);
    const before = wallet.money;
    expect(builder.placePath(3, 3)).toEqual({ ok: false, reason: 'occupied' });
    expect(builder.placeBuilding('snack', 3, 3)).toEqual({ ok: false, reason: 'occupied' });
    expect(wallet.money).toBe(before);
  });

  it('placing on an existing path refuses for a building', () => {
    const { builder } = setup();
    builder.placePath(4, 4);
    expect(builder.placeBuilding('decoration', 4, 4).ok).toBe(false);
    expect(builder.placePath(4, 4)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('placing out of bounds refuses and keeps money', () => {
    const { wallet, builder } = setup();
    expect(builder.placePath(-1, 0)).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(builder.placeEnclosure(38, 38, 40, 40, 'lava')).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(wallet.money).toBe(5000);
  });

  it('enclosure 3x2 costs 300 and has area 6', () => {
    const { grid, wallet, builder } = setup();
    const r = builder.placeEnclosure(2, 2, 4, 3, 'lava');
    expect(r.ok).toBe(true);
    expect(wallet.money).toBe(4700);
    const e = builder.enclosures.get(r.id);
    expect(e.area).toBe(6);
    expect(grid.getTile(4, 3).occupant).toBe(r.id);
  });

  it('enclosure corners may be given in any order', () => {
    const { builder } = setup();
    const r = builder.placeEnclosure(4, 3, 2, 2, 'ice');
    expect(builder.enclosures.get(r.id)).toMatchObject({ x0: 2, y0: 2, x1: 4, y1: 3 });
  });

  it('enclosurePrice is exactly what placing the enclosure costs, in any drag direction', () => {
    const { wallet, builder } = setup();
    expect(enclosurePrice(5, 7, 2, 3)).toBe(4 * 5 * 50);
    const before = wallet.money;
    builder.placeEnclosure(5, 7, 2, 3, 'lava');
    expect(before - wallet.money).toBe(enclosurePrice(5, 7, 2, 3));
  });

  it('enclosure smaller than 2x2 refused', () => {
    const { builder } = setup();
    expect(builder.placeEnclosure(2, 2, 2, 5, 'lava')).toEqual({ ok: false, reason: 'tooSmall' });
  });

  it('enclosure overlapping something refused, nothing spent', () => {
    const { wallet, builder } = setup();
    builder.placePath(3, 3);
    expect(builder.placeEnclosure(2, 2, 4, 4, 'lava')).toEqual({ ok: false, reason: 'occupied' });
    expect(wallet.money).toBe(4990);
  });

  it('purchase refused when money negative', () => {
    const { wallet, builder } = setup();
    wallet.charge(5010);
    expect(builder.placePath(1, 1)).toEqual({ ok: false, reason: 'noMoney' });
  });

  it('demolish refunds 50 %', () => {
    const { wallet, builder, grid } = setup();
    builder.placeBuilding('decoration', 6, 6);
    expect(wallet.money).toBe(4900);
    expect(builder.demolish(6, 6).ok).toBe(true);
    expect(wallet.money).toBe(4950);
    expect(grid.isFree(6, 6)).toBe(true);
  });

  it('demolish a path refunds half and turns it back to grass', () => {
    const { wallet, builder, grid } = setup();
    builder.placePath(1, 1);
    builder.demolish(1, 1);
    expect(wallet.money).toBe(4995);
    expect(grid.getTile(1, 1).ground).toBe('grass');
  });

  it('demolish empty tile refused', () => {
    const { builder } = setup();
    expect(builder.demolish(9, 9)).toEqual({ ok: false, reason: 'nothing' });
  });

  it('demolish occupied enclosure refused when hook returns false; allowed when true', () => {
    const { builder, grid } = setup();
    const r = builder.placeEnclosure(2, 2, 3, 3, 'lava');
    builder.enclosures.get(r.id).monsterIds = ['m1', 'm2'];
    builder.onEnclosureEmptied = () => false;
    expect(builder.demolish(2, 2)).toEqual({ ok: false, reason: 'enclosureNotEmpty' });
    expect(builder.enclosures.has(r.id)).toBe(true);
    let got = null;
    builder.onEnclosureEmptied = (ids) => { got = ids; return true; };
    expect(builder.demolish(3, 3).ok).toBe(true);
    expect(got).toEqual(['m1', 'm2']);
    expect(builder.enclosures.has(r.id)).toBe(false);
    expect(grid.isFree(2, 2)).toBe(true);
  });

  it('2x2 buildings occupy 4 tiles; fixed buildings cannot be demolished', () => {
    const { builder, grid } = setup();
    const r = builder.placeBuilding('hatchery', 10, 10, { free: true, fixed: true });
    expect(r.ok).toBe(true);
    expect(grid.getTile(11, 11).occupant).toBe(r.id);
    expect(builder.demolish(11, 10)).toEqual({ ok: false, reason: 'notDemolishable' });
  });

  it('touchesPath true only when a border tile is next to a path', () => {
    const { builder } = setup();
    const r = builder.placeEnclosure(2, 2, 3, 3, 'lava');
    expect(builder.touchesPath(r.id)).toBe(false);
    builder.placePath(5, 2);
    expect(builder.touchesPath(r.id)).toBe(false);
    builder.placePath(4, 2);
    expect(builder.touchesPath(r.id)).toBe(true);
    const s = builder.placeBuilding('snack', 4, 3);
    expect(builder.touchesPath(s.id)).toBe(true);
  });

  it('accessTiles lists path tiles next to an entity', () => {
    const { builder } = setup();
    const r = builder.placeEnclosure(2, 2, 3, 3, 'lava');
    builder.placePath(4, 2);
    builder.placePath(4, 3);
    expect(builder.accessTiles(r.id)).toEqual([{ tx: 4, ty: 2 }, { tx: 4, ty: 3 }]);
  });
});
