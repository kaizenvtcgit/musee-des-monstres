import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder } from '../../src/sim/build.js';
import { createMonster } from '../../src/sim/monsters.js';
import { createRng } from '../../src/sim/rng.js';
import { spawnIntervalSec, createVisitor, updateVisitor, scare } from '../../src/sim/visitors.js';

// A path line along y = 10 from x = 0 to x = 15, entrance at (0,10).
function setup() {
  const grid = new Grid(20, 20);
  const wallet = new Wallet(100000);
  const builder = new Builder(grid, wallet);
  for (let x = 0; x <= 15; x++) builder.placePath(x, 10);
  const monsters = new Map();
  const ctx = { grid, builder, monsters, entrance: { tx: 0, ty: 10 }, wallet, rng: createRng(3) };
  return ctx;
}

function addEnclosure(ctx, x0, y0, x1, y1, species = 'golem', habitat = 'forest') {
  const r = ctx.builder.placeEnclosure(x0, y0, x1, y1, habitat);
  const m = createMonster(species);
  m.state = 'enclosed';
  m.enclosureId = r.id;
  ctx.builder.enclosures.get(r.id).monsterIds = [m.id];
  ctx.builder.enclosures.get(r.id).speciesId = species;
  ctx.monsters.set(m.id, m);
  return r.id;
}

function run(v, ctx, seconds, until) {
  for (let i = 0; i < seconds * 10; i++) {
    updateVisitor(v, ctx, 0.1);
    if (until && until(v)) return i / 10;
  }
  return null;
}

describe('spawnIntervalSec', () => {
  it('matches the spec formula', () => {
    expect(spawnIntervalSec(0, 20)).toBe(16);
    expect(spawnIntervalSec(5, 20)).toBeCloseTo(2.67, 2);
    expect(spawnIntervalSec(0, 40)).toBe(32);
  });
});

describe('visitors', () => {
  it('walks to a path-adjacent enclosure and watches it', () => {
    const ctx = setup();
    const id = addEnclosure(ctx, 8, 8, 9, 9);
    const v = createVisitor(ctx.entrance);
    const t = run(v, ctx, 30, (x) => x.state === 'watching');
    expect(t).not.toBeNull();
    expect(v.target.id).toBe(id);
  });

  it('never chooses an enclosure that does not touch a path', () => {
    const ctx = setup();
    const id = addEnclosure(ctx, 2, 2, 3, 3);
    const v = createVisitor(ctx.entrance);
    const seen = new Set();
    run(v, ctx, 200, (x) => { if (x.target) seen.add(x.target.id); return x.state === 'gone'; });
    expect(seen.has(id)).toBe(false);
    expect(v.state).toBe('gone');
  });

  it('scare makes the visitor flee and leave', () => {
    const ctx = setup();
    addEnclosure(ctx, 12, 8, 13, 9);
    const v = createVisitor(ctx.entrance);
    run(v, ctx, 6);
    const before = v.satisfaction;
    scare(v);
    expect(v.state).toBe('fleeing');
    expect(v.mood).toBe('scared');
    expect(v.satisfaction).toBeCloseTo(Math.max(0, before - 0.5));
    expect(run(v, ctx, 30, (x) => x.state === 'gone')).not.toBeNull();
  });

  it('re-paths when the path ahead is demolished and still leaves within 80 s', () => {
    const ctx = setup();
    addEnclosure(ctx, 12, 8, 13, 9);
    // detour: y = 12 from x = 4 to x = 12, linked by x = 4 and x = 12 columns
    for (let x = 4; x <= 12; x++) ctx.builder.placePath(x, 12);
    ctx.builder.placePath(4, 11);
    ctx.builder.placePath(12, 11);
    const v = createVisitor(ctx.entrance);
    run(v, ctx, 2);
    ctx.builder.demolish(8, 10);
    const t = run(v, ctx, 80, (x) => x.state === 'watching');
    expect(t).not.toBeNull();
    // now cut everything between the visitor and the entrance: it must still get out
    ctx.builder.demolish(4, 11);
    ctx.builder.demolish(3, 10);
    let stuck = 0;
    for (let i = 0; i < 3000 && v.state !== 'gone'; i++) {
      const px = v.pos.x, py = v.pos.y;
      updateVisitor(v, ctx, 0.1);
      stuck = px === v.pos.x && py === v.pos.y && v.state !== 'watching' ? stuck + 0.1 : 0;
      expect(stuck).toBeLessThan(30);
    }
    expect(v.state).toBe('gone');
  });

  it('review #1: demolishing the exact tile a visitor heads to does not freeze it', () => {
    const ctx = setup();
    addEnclosure(ctx, 8, 8, 9, 9);
    const v = createVisitor(ctx.entrance);
    run(v, ctx, 1);
    const goal = v.target.tile;
    ctx.builder.demolish(goal.tx, goal.ty);
    const t = run(v, ctx, 60, (x) => x.state === 'gone' || x.state === 'watching');
    expect(t).not.toBeNull();
  });

  it('a hungry visitor goes to the snack and pays 8', () => {
    const ctx = setup();
    ctx.builder.placeBuilding('snack', 5, 9);
    const v = createVisitor(ctx.entrance);
    v.age = 151; // hungry
    const money = ctx.wallet.money;
    expect(run(v, ctx, 30, (x) => x.ate)).not.toBeNull();
    expect(ctx.wallet.money).toBe(money + 8);
  });

  it('a visitor with nothing to see leaves bored', () => {
    const ctx = setup();
    const v = createVisitor(ctx.entrance);
    run(v, ctx, 5);
    expect(['leaving', 'gone']).toContain(v.state);
  });
});

describe('watching from a bridge', () => {
  it('gives the bonus', () => {
    const gain = (onBridge) => {
      const ctx = setup();
      const id = addEnclosure(ctx, 5, 6, 8, 9, 'golem', 'forest');
      ctx.builder.placePath(4, 7);
      ctx.builder.placePath(9, 7);
      expect(ctx.builder.placeBridge([4, 5, 6, 7, 8, 9].map((tx) => ({ tx, ty: 7 }))).ok).toBe(true);
      const tile = onBridge ? { tx: 6, ty: 7 } : { tx: 6, ty: 10 };
      const v = createVisitor(tile);
      v.satisfaction = 0;
      v.target = { kind: 'enclosure', id, tile };
      v.path = [];
      updateVisitor(v, ctx, 0.1);
      expect(v.state).toBe('watching');
      return v.satisfaction;
    };
    expect(gain(true)).toBeCloseTo(gain(false) * 1.25, 5);
  });
});
