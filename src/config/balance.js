// Every tunable number of the game. Adjust here only.
export const BALANCE = {
  startMoney: 5000,
  pathCost: 10,
  enclosureCostPerTile: 50,
  decorationCost: 100,
  snackCost: 500,
  souvenirCost: 800,
  keeperHireCost: 300,
  keeperSalaryPerMin: 20,
  feedCost: 20,
  demolishRefund: 0.5,
  ticketPriceDefault: 20,
  ticketPriceRef: 20,
  visitorBaseIntervalSec: 8,
  expeditionCost: 500,
  rareChance: 0.1,
  rareAppealMult: 2,
  hatchTimeSec: 30,
  hatcheryCapacity: 3,
  escapeThreshold: 20,
  escapeMaxChancePerSec: 0.02,
  hungerPerMin: 10,
  snackPrice: 8,
  souvenirPrice: 15,
  decorationRadius: 3,
  // decorations inside an enclosure (src/config/decor.js), each one up to decorMaxCount:
  decorHappiness: 5, // + happiness points for its monsters
  decorAppeal: 0.1, // + 10 % appeal for the visitors
  decorWatch: 0.15, // + 15 % time spent watching
  decorMaxCount: 4,
  // shelter in an enclosure (a cave, a mausoleum...): the monster takes refuge in it now and then
  shelterCost: 600,
  shelterHappiness: 10, // + happiness points for the monsters of an enclosure that has one
  shelterMinArea: 6, // the enclosure must be big enough to keep room outside it
  shelterStay: [20, 45], // seconds spent in it
  shelterCooldown: [30, 60], // seconds before going back
  shelterEntranceAppeal: 0.6, // a monster resting at the entrance is still seen, a bit less
  maxSubstepSec: 0.1,
  breedTimeSec: 180,
  breedMinHappiness: 70,
  breedMaxHunger: 50,
  rareChanceFromRareParent: 0.5,
};
