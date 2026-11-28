// Each monster can live in the three habitats of its family (its home habitat and two others).
export const HABITATS = [
  'lava', 'water', 'dark', 'forest', 'ice',
  'ash', 'basalt', 'reef', 'abyss', 'swamp', 'graveyard', 'ruins', 'crystal', 'tundra', 'summit',
];
export const HABITAT_FAMILY = {
  lava: 'lava', ash: 'lava', basalt: 'lava',
  water: 'water', reef: 'water', abyss: 'water',
  dark: 'dark', swamp: 'dark', graveyard: 'dark',
  forest: 'forest', ruins: 'forest', crystal: 'forest',
  ice: 'ice', tundra: 'ice', summit: 'ice',
};
export const HABITAT_FAMILIES = ['lava', 'water', 'dark', 'forest', 'ice'];
// Habitats the player can build. The others are ready (grounds, decorations, rules) but switched off for now:
// add them here to offer them again. Enclosures of a hidden habitat in a saved game keep working.
export const OFFERED_HABITATS = ['lava', 'water', 'dark', 'forest', 'ice'];
export const offeredHabitatsOfFamily = (family) => habitatsOfFamily(family).filter((h) => OFFERED_HABITATS.includes(h));
export const habitatsOfFamily = (family) => HABITATS.filter((h) => HABITAT_FAMILY[h] === family);
// How much more the visitors like a monster shown in this habitat (the rarer ones impress more).
export const HABITAT_APPEAL = { ash: 1.05, basalt: 1.1, reef: 1.1, abyss: 1.2, swamp: 1.05, graveyard: 1.1, ruins: 1.1, crystal: 1.2, tundra: 1.05, summit: 1.1 };
// Can this species live in this habitat?
export const habitatFits = (speciesId, habitat) => !!SPECIES[speciesId] && HABITAT_FAMILY[habitat] === SPECIES[speciesId].habitat;

export const SPECIES = {
  dragonnet: { id: 'dragonnet', habitat: 'lava', minArea: 6, appeal: 10, decayPerMin: 6, special: 'hotTemper' },
  kraken: { id: 'kraken', habitat: 'water', minArea: 12, appeal: 7, decayPerMin: 3, special: null },
  spectre: { id: 'spectre', habitat: 'dark', minArea: 6, appeal: 8, decayPerMin: 4, special: 'phases' },
  // speed: how fast it wanders when escaped (x the base speed); the golem is slow and heavy
  golem: { id: 'golem', habitat: 'forest', minArea: 4, appeal: 4, decayPerMin: 1.5, special: null, speed: 0.375 },
  yeti: { id: 'yeti', habitat: 'ice', minArea: 8, appeal: 7, decayPerMin: 3, special: 'lovesVisitors', speed: 0.56 }, // escaped: runs
};

export const LOCATIONS = {
  volcano: { id: 'volcano', species: ['dragonnet'], durationSec: 60 },
  lagoon: { id: 'lagoon', species: ['kraken'], durationSec: 90 },
  crypt: { id: 'crypt', species: ['spectre'], durationSec: 120 },
  ancientForest: { id: 'ancientForest', species: ['golem'], durationSec: 60 },
  glacier: { id: 'glacier', species: ['yeti'], durationSec: 180 },
};
