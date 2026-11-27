import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';
import { Wallet } from '../../src/sim/wallet.js';
import { Builder } from '../../src/sim/build.js';
import { BALANCE } from '../../src/config/balance.js';
import { ENCLOSURE_DECOR, decorForHabitat } from '../../src/config/decor.js';
import { HABITATS } from '../../src/config/species.js';
import { createMonster, targetHappiness, decorCount } from '../../src/sim/monsters.js';
import { createInitialWorld } from '../../src/sim/world.js';
import { serializeWorld, deserializeWorld } from '../../src/sim/save.js';
import { fr } from '../../src/i18n/fr.js';

function setup(money = 10000) {
  const grid = new Grid(20, 20);
  const wallet = new Wallet(money);
  const b = new Builder(grid, wallet);
  const lava = b.placeEnclosure(2, 2, 5, 5, 'lava').id;
  return { grid, wallet, b, lava };
}

describe('enclosure decorations', () => {
  it('every habitat has three decorations, each with a name', () => {
    for (const h of HABITATS) expect(decorForHabitat(h)).toHaveLength(3);
    for (const id of Object.keys(ENCLOSURE_DECOR)) expect(fr[`decor.${id}`], id).toBeTypeOf('string');
  });

  it('is placed inside an enclosure of its habitat and costs its price', () => {
    const { b, wallet, lava } = setup();
    const before = wallet.money;
    const r = b.placeDecor(3, 3, 'lavaRock');
    expect(r.ok).toBe(true);
    expect(wallet.money).toBe(before - ENCLOSURE_DECOR.lavaRock.price);
    expect(b.enclosures.get(lava).decor).toHaveLength(1);
  });

  it('is refused outside an enclosure, in another habitat, twice on a tile or without money', () => {
    const { b } = setup();
    expect(b.placeDecor(10, 10, 'lavaRock').reason).toBe('notInEnclosure');
    expect(b.placeDecor(3, 3, 'reeds').reason).toBe('wrongDecorHabitat');
    b.placeDecor(3, 3, 'lavaRock');
    expect(b.placeDecor(3, 3, 'obsidian').reason).toBe('occupied');
    const poor = setup();
    poor.wallet.money = 0; // after building the enclosure
    expect(poor.b.placeDecor(3, 3, 'lavaRock').reason).toBe('noMoney');
  });

  it('demolishing a decorated tile removes the decoration first, not the enclosure', () => {
    const { b, wallet, lava } = setup();
    b.placeDecor(3, 3, 'obsidian');
    const before = wallet.money;
    expect(b.demolish(3, 3).ok).toBe(true);
    expect(b.enclosures.has(lava)).toBe(true);
    expect(b.enclosures.get(lava).decor).toHaveLength(0);
    expect(wallet.money).toBe(before + ENCLOSURE_DECOR.obsidian.price * BALANCE.demolishRefund);
  });

  it('demolishing the enclosure also refunds half of its decorations', () => {
    const { b, wallet, lava } = setup();
    const encPrice = b.enclosures.get(lava).price;
    b.placeDecor(3, 3, 'lavaRock');
    const before = wallet.money;
    b.demolish(2, 2);
    expect(b.enclosures.has(lava)).toBe(false);
    expect(wallet.money).toBe(before + (encPrice + ENCLOSURE_DECOR.lavaRock.price) * BALANCE.demolishRefund);
  });

  it('makes the monsters happier, up to decorMaxCount decorations', () => {
    const { b, lava } = setup();
    const e = b.enclosures.get(lava);
    const m = createMonster('dragonnet');
    m.hunger = 60; // a hungry monster is below 100: the bonus shows
    const base = targetHappiness(m, e, 0);
    b.placeDecor(3, 3, 'lavaRock');
    expect(targetHappiness(m, e, 0)).toBe(base + BALANCE.decorHappiness);
    for (const [x, y] of [[4, 3], [3, 4], [4, 4], [5, 5], [2, 2]]) b.placeDecor(x, y, 'fumarole');
    expect(decorCount(e)).toBe(BALANCE.decorMaxCount);
    expect(targetHappiness(m, e, 0)).toBe(base + BALANCE.decorMaxCount * BALANCE.decorHappiness);
  });

  it('is kept in a saved game', () => {
    const w = createInitialWorld(3);
    const enc = [...w.builder.enclosures.values()][0]; // the forest enclosure of the start
    expect(w.builder.placeDecor(enc.x0, enc.y0, 'fern').ok).toBe(true);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect([...loaded.builder.enclosures.values()][0].decor.map((d) => d.type)).toEqual(['fern']);
  });
});

describe('low decorations', () => {
  it('the small plants and logs can be walked over, the big pieces cannot', () => {
    const low = Object.values(ENCLOSURE_DECOR).filter((d) => d.low).map((d) => d.id).sort();
    expect(low).toEqual([
      'anemones', 'deadTrunk', 'emberPile', 'fern', 'frozenShrub', 'frozenStump', 'glowMushrooms', 'jellyfish',
      'mossStump', 'reeds', 'roots', 'rottenTrunk', 'wisps',
    ]);
  });
});

describe('habitat families', () => {
  it('each monster can live in the three habitats of its family, and is happy there', async () => {
    const { habitatsOfFamily, habitatFits, SPECIES: S } = await import('../../src/config/species.js');
    const { placeMonsterInEnclosure } = await import('../../src/sim/expeditions.js');
    for (const sp of Object.values(S)) {
      const homes = habitatsOfFamily(sp.habitat);
      expect(homes).toHaveLength(3);
      for (const h of homes) {
        const enc = { id: 'e', habitat: h, x0: 0, y0: 0, x1: 4, y1: 4, area: 25, monsterIds: [], speciesId: null, decor: [] };
        const m = createMonster(sp.id);
        expect(placeMonsterInEnclosure(m, enc).ok).toBe(true);
        expect(targetHappiness(m, enc, 0)).toBe(100);
      }
      expect(habitatFits(sp.id, sp.habitat === 'lava' ? 'reef' : 'ash')).toBe(false);
    }
  });

  it('showing monsters in different habitats raises the reputation', async () => {
    const { computeReputation } = await import('../../src/sim/reputation.js');
    const base = { avgSatisfaction: 0.5, speciesCount: 2, escapesLast5Min: 0 };
    expect(computeReputation({ ...base, habitatVariety: 1 })).toBeCloseTo(computeReputation(base));
    expect(computeReputation({ ...base, habitatVariety: 4 })).toBeCloseTo(computeReputation(base) + 0.3);
  });
});
