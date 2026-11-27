import { SPECIES, habitatFits } from '../config/species.js';
import { BALANCE } from '../config/balance.js';

let nextMonsterId = 1;

// Saved games: new ids must not reuse the ones already in the loaded game.
export function reserveMonsterIds(n) {
  nextMonsterId = Math.max(nextMonsterId, n + 1);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createMonster(speciesId, { rare = false } = {}) {
  return {
    id: `mon${nextMonsterId++}`,
    speciesId,
    rare,
    happiness: 70,
    hunger: 0,
    state: 'stored', // 'enclosed' | 'escaped' | 'stored'
    enclosureId: null,
    pos: { x: 0, y: 0 }, // tile units, float
    wanderTarget: null,
  };
}

// Decorations of an enclosure that count for its bonuses (the first BALANCE.decorMaxCount).
export function decorCount(enclosure) {
  return Math.min(enclosure?.decor?.length ?? 0, BALANCE.decorMaxCount);
}

export function targetHappiness(monster, enclosure, watchers) {
  const sp = SPECIES[monster.speciesId];
  const habitatFactor = habitatFits(monster.speciesId, enclosure.habitat) ? 1 : 0.3;
  const count = Math.max(1, enclosure.monsterIds ? enclosure.monsterIds.length : 1);
  const sizeFactor = Math.min(1, enclosure.area / (sp.minArea * count));
  const decor = decorCount(enclosure) * BALANCE.decorHappiness;
  return clamp(100 * habitatFactor * sizeFactor + decor - monster.hunger * 0.5, 0, 100);
}

export function updateMonster(monster, enclosure, watchers, dt) {
  const sp = SPECIES[monster.speciesId];
  monster.hunger = clamp(monster.hunger + (BALANCE.hungerPerMin * dt) / 60, 0, 100);
  const target = targetHappiness(monster, enclosure, watchers);
  const step = (sp.decayPerMin * dt) / 60;
  if (monster.happiness < target) monster.happiness = Math.min(target, monster.happiness + step);
  else monster.happiness = Math.max(target, monster.happiness - step);
  if (sp.special === 'lovesVisitors' && watchers >= 3) monster.happiness += (5 * dt) / 60;
  monster.happiness = clamp(monster.happiness, 0, 100);
}

export function escapeChancePerSec(monster) {
  const h = monster.happiness;
  if (h >= BALANCE.escapeThreshold) return 0;
  const base = ((BALANCE.escapeThreshold - h) / BALANCE.escapeThreshold) * BALANCE.escapeMaxChancePerSec;
  return SPECIES[monster.speciesId].special === 'phases' ? base * 2 : base;
}

export function feed(monster) {
  monster.hunger = 0;
}

export function appeal(monster) {
  const sp = SPECIES[monster.speciesId];
  return sp.appeal * (monster.rare ? BALANCE.rareAppealMult : 1) * (monster.happiness / 100);
}
