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
  const decor = decorCount(enclosure) * BALANCE.decorHappiness + (enclosure?.shelter ? BALANCE.shelterHappiness : 0);
  return clamp(100 * habitatFactor * sizeFactor + decor - monster.hunger * 0.5, 0, 100);
}

// The shelter of an enclosure: now and then a monster takes refuge in it, alone, for a while: hidden inside
// ('inside') or resting at the entrance ('entrance'). More often, and more often hidden, when it is stressed
// (unhappy, or many visitors watching). `rng` is the world's, so a saved game goes on the same way.
export function updateShelter(monster, enclosure, watchers, dt, rng, monsters) {
  const sh = enclosure?.shelter;
  if (!sh) {
    monster.shelter = null;
    return;
  }
  // free the shelter if its occupant is gone (escaped, moved, sold...)
  if (sh.occupant) {
    const o = monsters.get(sh.occupant);
    if (!o || o.state !== 'enclosed' || o.enclosureId !== enclosure.id || !o.shelter) sh.occupant = null;
  }
  if (monster.shelter) {
    monster.shelterLeft -= dt;
    if (monster.shelterLeft > 0) return;
    monster.shelter = null;
    sh.occupant = null;
    const [a, b] = BALANCE.shelterCooldown;
    monster.shelterCooldown = a + rng() * (b - a);
    return;
  }
  if (sh.occupant) return;
  monster.shelterCooldown = (monster.shelterCooldown ?? rng() * 20) - dt;
  if (monster.shelterCooldown > 0) return;
  const stressed = monster.happiness < 50 || watchers >= 4;
  if (rng() >= (stressed ? 1 / 15 : 1 / 50) * dt) return;
  monster.shelter = rng() < (stressed ? 0.75 : 0.4) ? 'inside' : 'entrance';
  const [a, b] = BALANCE.shelterStay;
  monster.shelterLeft = a + rng() * (b - a);
  sh.occupant = monster.id;
}

export function updateMonster(monster, enclosure, watchers, dt) {
  const sp = SPECIES[monster.speciesId];
  monster.hunger = clamp(monster.hunger + (BALANCE.hungerPerMin * dt) / 60, 0, 100);
  const target = targetHappiness(monster, enclosure, watchers);
  // hidden in its shelter, it recovers twice as fast
  const step = ((sp.decayPerMin * dt) / 60) * (monster.shelter === 'inside' && monster.happiness < target ? 2 : 1);
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
