// Decorations placed inside an enclosure, by habitat. Each one makes the monsters of the enclosure
// happier and the enclosure more attractive to visitors (see BALANCE.decor*). Images: src/assets/decor/,
// made by scripts/render-model/render-decor.mjs.
// low: small and low (plants, a log...): the monsters walk over it instead of going around.
// smoke: smoke rises from it.
export const ENCLOSURE_DECOR = {
  lavaRock: { id: 'lavaRock', habitat: 'lava', price: 150 },
  fumarole: { id: 'fumarole', habitat: 'lava', price: 200, smoke: true },
  obsidian: { id: 'obsidian', habitat: 'lava', price: 250 },
  mossRocks: { id: 'mossRocks', habitat: 'water', price: 150 },
  reeds: { id: 'reeds', habitat: 'water', price: 100, low: true },
  sunkenChest: { id: 'sunkenChest', habitat: 'water', price: 250 },
  gothicStatue: { id: 'gothicStatue', habitat: 'dark', price: 250 },
  lantern: { id: 'lantern', habitat: 'dark', price: 150 },
  glowMushrooms: { id: 'glowMushrooms', habitat: 'dark', price: 200, low: true },
  mossStump: { id: 'mossStump', habitat: 'forest', price: 100, low: true },
  fern: { id: 'fern', habitat: 'forest', price: 100, low: true },
  deadTrunk: { id: 'deadTrunk', habitat: 'forest', price: 150, low: true },
  iceBlock: { id: 'iceBlock', habitat: 'ice', price: 150 },
  snowyFir: { id: 'snowyFir', habitat: 'ice', price: 250 },
  frostRock: { id: 'frostRock', habitat: 'ice', price: 150 },
  // the second and third habitat of each monster
  charredStump: { id: 'charredStump', habitat: 'ash', price: 150 },
  smokingRock: { id: 'smokingRock', habitat: 'ash', price: 200, smoke: true },
  emberPile: { id: 'emberPile', habitat: 'ash', price: 150, low: true },
  basaltColumns: { id: 'basaltColumns', habitat: 'basalt', price: 250 },
  ochreRock: { id: 'ochreRock', habitat: 'basalt', price: 150 },
  stoneStack: { id: 'stoneStack', habitat: 'basalt', price: 150 },
  coral: { id: 'coral', habitat: 'reef', price: 200 },
  giantShell: { id: 'giantShell', habitat: 'reef', price: 200 },
  anemones: { id: 'anemones', habitat: 'reef', price: 100, low: true },
  jellyfish: { id: 'jellyfish', habitat: 'abyss', price: 250, low: true },
  whaleStatue: { id: 'whaleStatue', habitat: 'abyss', price: 300 },
  vents: { id: 'vents', habitat: 'abyss', price: 200 },
  rottenTrunk: { id: 'rottenTrunk', habitat: 'swamp', price: 150, low: true },
  roots: { id: 'roots', habitat: 'swamp', price: 100, low: true },
  wisps: { id: 'wisps', habitat: 'swamp', price: 200, low: true },
  tombstone: { id: 'tombstone', habitat: 'graveyard', price: 150 },
  stoneCross: { id: 'stoneCross', habitat: 'graveyard', price: 150 },
  deadTree: { id: 'deadTree', habitat: 'graveyard', price: 200 },
  brokenColumn: { id: 'brokenColumn', habitat: 'ruins', price: 200 },
  horseStatue: { id: 'horseStatue', habitat: 'ruins', price: 300 },
  mossBlock: { id: 'mossBlock', habitat: 'ruins', price: 150 },
  amethyst: { id: 'amethyst', habitat: 'crystal', price: 250 },
  aquamarine: { id: 'aquamarine', habitat: 'crystal', price: 250 },
  stalagmites: { id: 'stalagmites', habitat: 'crystal', price: 150 },
  frozenShrub: { id: 'frozenShrub', habitat: 'tundra', price: 100, low: true },
  frozenStump: { id: 'frozenStump', habitat: 'tundra', price: 100, low: true },
  cairn: { id: 'cairn', habitat: 'tundra', price: 150 },
  snowRock: { id: 'snowRock', habitat: 'summit', price: 150 },
  iceSpikes: { id: 'iceSpikes', habitat: 'summit', price: 200 },
  expeditionFlag: { id: 'expeditionFlag', habitat: 'summit', price: 150 },
};

// The shelter of each monster family (2 x 2 tiles), image src/assets/decor/shelter-<family>.png.
export const SHELTERS = {
  lava: 'volcanicLair', water: 'seaCave', dark: 'mausoleum', forest: 'mossMound', ice: 'iceCave',
};

export const decorForHabitat = (habitat) => Object.values(ENCLOSURE_DECOR).filter((d) => d.habitat === habitat);
