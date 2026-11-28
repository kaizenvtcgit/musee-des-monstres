import { describe, it, expect } from 'vitest';
import { createInitialWorld } from '../../src/sim/world.js';
import { createVisitor, takeCash } from '../../src/sim/visitors.js';
import { BALANCE } from '../../src/config/balance.js';

describe('cash machine', () => {
  it('is a one-tile building at its price', () => {
    const w = createInitialWorld(1);
    const money = w.wallet.money;
    const r = w.builder.placeBuilding('atm', 18, 33);
    expect(r.ok).toBe(true);
    expect(w.wallet.money).toBe(money - BALANCE.atmCost);
    expect(w.builder.buildings.get(r.id)).toMatchObject({ type: 'atm', x0: 18, y0: 33, x1: 18, y1: 33 });
  });

  it('a visitor walking past it (next tile) takes cash, once; further away, no', () => {
    const w = createInitialWorld(1);
    w.builder.placeBuilding('atm', 19, 36);
    const v = createVisitor(w.entrance);
    v.tile = { tx: 20, ty: 38 };
    takeCash(v, w.ctx);
    expect(v.cash).toBeFalsy();
    v.tile = { tx: 20, ty: 36 };
    takeCash(v, w.ctx);
    expect(v.cash).toBe(true);
  });

  it('with cash, a visitor spends more at the stands', () => {
    const spend = (cash) => {
      const w = createInitialWorld(2);
      w.wallet.money = 1e5;
      const snack = w.builder.placeBuilding('snack', 19, 35).id;
      const v = createVisitor(w.entrance);
      v.cash = cash;
      Object.assign(v, { target: { kind: 'snack', id: snack, tile: { tx: 20, ty: 35 } }, path: [], tile: { tx: 20, ty: 35 }, pos: { x: 20, y: 35 } });
      w.visitors.push(v);
      const before = w.wallet.money;
      w.ctx.visitors.length = 0;
      w.ctx.visitors.push(v);
      // one tiny step: the visitor arrives at the snack and buys
      w.spawnTimer = -1e9;
      w.tick(0.01);
      return w.wallet.money - before;
    };
    expect(spend(true)).toBeCloseTo(BALANCE.snackPrice * BALANCE.atmSpendBonus, 0);
    expect(spend(false)).toBeCloseTo(BALANCE.snackPrice, 0);
  });
});
