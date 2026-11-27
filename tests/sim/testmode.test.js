import { describe, it, expect } from 'vitest';
import { Wallet } from '../../src/sim/wallet.js';
import { isTestMode } from '../../src/testmode.js';
import { saveKey } from '../../src/save/storage.js';

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
