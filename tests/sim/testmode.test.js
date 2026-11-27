import { describe, it, expect } from 'vitest';
import { Wallet } from '../../src/sim/wallet.js';
import { isTestMode } from '../../src/testmode.js';
import { saveKey } from '../../src/save/storage.js';
import { ExpeditionBase } from '../../src/sim/expeditions.js';

describe('unlimited wallet (test mode)', () => {
  it('can always pay, and paying or salaries never lower the money', () => {
    const w = new Wallet(100);
    w.unlimited = true;
    expect(w.canAfford(1e9)).toBe(true);
    expect(w.spend(5000)).toBe(true);
    w.charge(300);
    expect(w.money).toBe(100);
  });

  it('a normal wallet is unchanged', () => {
    const w = new Wallet(100);
    expect(w.canAfford(150)).toBe(false);
    expect(w.spend(60)).toBe(true);
    expect(w.money).toBe(40);
  });
});

describe('instant expeditions (test mode)', () => {
  it('the team is back with its egg on the very next update', () => {
    const base = new ExpeditionBase();
    base.instant = true;
    expect(base.start('glacier', new Wallet(5000)).ok).toBe(true); // normally 180 s
    const egg = base.update(0.01, () => 0.5);
    expect(egg).toMatchObject({ speciesId: 'yeti' });
    expect(base.active).toBeNull();
  });

  it('an expedition already away (saved game) comes back at once too', () => {
    const base = new ExpeditionBase();
    base.start('crypt', new Wallet(5000)); // 120 s, started before the test mode was on
    base.instant = true;
    expect(base.update(0.01, () => 0.5)).toMatchObject({ speciesId: 'spectre' });
  });

  it('a normal expedition still takes its time', () => {
    const base = new ExpeditionBase();
    base.start('glacier', new Wallet(5000));
    expect(base.update(0.01, () => 0.5)).toBeNull();
  });
});

describe('isTestMode', () => {
  it('needs ?test in the address, and only while developing (never in the published game)', () => {
    expect(isTestMode('?test', true)).toBe(true);
    expect(isTestMode('?a=1&test', true)).toBe(true);
    expect(isTestMode('', true)).toBe(false);
    expect(isTestMode('?test', false)).toBe(false);
    expect(isTestMode('?testing', true)).toBe(false);
  });
});

describe('save slots', () => {
  it('the test game is saved apart from the real one', () => {
    expect(saveKey(false)).toBe('musee-des-monstres:save');
    expect(saveKey(true)).not.toBe(saveKey(false));
  });
});
