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

// Size of a decoration in the 3D view (src/render3d/park-scene.js): its model is drawn at one tile per model
// unit (2.5 m), times this factor for the few that came out of real size next to a visitor (1.75 m).
export const DECOR_SCALE = { deadTree: 2, lantern: 0.5, sunkenChest: 0.6, tombstone: 0.85, frozenShrub: 0.7 };

// Height of each decoration in metres, as drawn in the 3D view: a monster steps over the ones that are low
// for its own size (see src/render/stepover.js) and walks around the others.
export const DECOR_HEIGHT = {
  lavaRock: 0.96, fumarole: 0.63, obsidian: 1.68, mossRocks: 0.62, reeds: 2.41, sunkenChest: 0.53,
  gothicStatue: 2.49, lantern: 0.69, glowMushrooms: 0.88, mossStump: 0.58, fern: 0.43, deadTrunk: 0.23,
  iceBlock: 1.45, snowyFir: 2.88, frostRock: 0.96, charredStump: 0.54, smokingRock: 0.87, emberPile: 0.32,
  basaltColumns: 2.02, ochreRock: 0.78, stoneStack: 0.47, coral: 1.46, giantShell: 0.45, anemones: 0.76,
  jellyfish: 0.88, whaleStatue: 1.67, vents: 1.49, rottenTrunk: 0.62, roots: 0.73, wisps: 1.49,
  tombstone: 0.95, stoneCross: 1.62, deadTree: 5.74, brokenColumn: 1.75, horseStatue: 2.0, mossBlock: 1.0,
  amethyst: 2.2, aquamarine: 1.5, stalagmites: 1.63, frozenShrub: 1.55, frozenStump: 0.51, cairn: 1.5,
  snowRock: 1.41, iceSpikes: 1.8, expeditionFlag: 2.5,
};

// The shelter of each monster family (2 x 2 tiles), image src/assets/decor/shelter-<family>.png.
export const SHELTERS = {
  lava: 'volcanicLair', water: 'seaCave', dark: 'mausoleum', forest: 'mossMound', ice: 'iceCave',
};

export const decorForHabitat = (habitat) => Object.values(ENCLOSURE_DECOR).filter((d) => d.habitat === habitat);
