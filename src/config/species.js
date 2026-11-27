export const HABITATS = ['lava', 'water', 'dark', 'forest', 'ice'];

export const SPECIES = {
  dragonnet: { id: 'dragonnet', habitat: 'lava', minArea: 6, appeal: 10, decayPerMin: 6, special: 'hotTemper' },
  kraken: { id: 'kraken', habitat: 'water', minArea: 12, appeal: 7, decayPerMin: 3, special: null },
  spectre: { id: 'spectre', habitat: 'dark', minArea: 6, appeal: 8, decayPerMin: 4, special: 'phases' },
  // speed: how fast it wanders when escaped (x the base speed); the golem is slow and heavy
  golem: { id: 'golem', habitat: 'forest', minArea: 4, appeal: 4, decayPerMin: 1.5, special: null, speed: 0.45 },
  yeti: { id: 'yeti', habitat: 'ice', minArea: 8, appeal: 7, decayPerMin: 3, special: 'lovesVisitors' },
};

export const LOCATIONS = {
  volcano: { id: 'volcano', species: ['dragonnet'], durationSec: 60 },
  lagoon: { id: 'lagoon', species: ['kraken'], durationSec: 90 },
  crypt: { id: 'crypt', species: ['spectre'], durationSec: 120 },
  ancientForest: { id: 'ancientForest', species: ['golem'], durationSec: 60 },
  glacier: { id: 'glacier', species: ['yeti'], durationSec: 180 },
};
