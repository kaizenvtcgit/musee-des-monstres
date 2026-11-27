// Decorations placed inside an enclosure, by habitat. Each one makes the monsters of the enclosure
// happier and the enclosure more attractive to visitors (see BALANCE.decor*). Images: src/assets/decor/,
// made by scripts/render-model/render-decor.mjs.
export const ENCLOSURE_DECOR = {
  lavaRock: { id: 'lavaRock', habitat: 'lava', price: 150 },
  fumarole: { id: 'fumarole', habitat: 'lava', price: 200 },
  obsidian: { id: 'obsidian', habitat: 'lava', price: 250 },
  mossRocks: { id: 'mossRocks', habitat: 'water', price: 150 },
  reeds: { id: 'reeds', habitat: 'water', price: 100 },
  sunkenChest: { id: 'sunkenChest', habitat: 'water', price: 250 },
  gothicStatue: { id: 'gothicStatue', habitat: 'dark', price: 250 },
  lantern: { id: 'lantern', habitat: 'dark', price: 150 },
  glowMushrooms: { id: 'glowMushrooms', habitat: 'dark', price: 200 },
  mossStump: { id: 'mossStump', habitat: 'forest', price: 100 },
  fern: { id: 'fern', habitat: 'forest', price: 100 },
  deadTrunk: { id: 'deadTrunk', habitat: 'forest', price: 150 },
  iceBlock: { id: 'iceBlock', habitat: 'ice', price: 150 },
  snowyFir: { id: 'snowyFir', habitat: 'ice', price: 250 },
  frostRock: { id: 'frostRock', habitat: 'ice', price: 150 },
};

export const decorForHabitat = (habitat) => Object.values(ENCLOSURE_DECOR).filter((d) => d.habitat === habitat);
