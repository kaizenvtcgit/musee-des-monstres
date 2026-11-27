import Phaser from 'phaser';
import { createInitialWorld } from './sim/world.js';
import { GameScene } from './render/GameScene.js';
import { createUI } from './render/ui.js';
import { loadGame, startAutosave, useTestSave } from './save/storage.js';
import { isTestMode } from './testmode.js';

// test mode (http://localhost:5180/?test, development only): unlimited money, separate saved game
const testMode = isTestMode(window.location.search, import.meta.env.DEV);
useTestSave(testMode);

// resume the saved game if there is one
const saved = loadGame();
const world = saved ?? createInitialWorld(Math.floor(Math.random() * 1e9));
world.wallet.unlimited = testMode;
world.expeditionBase.instant = testMode;
world.hatchery.instant = testMode;
const ui = createUI(world, { resumed: !!saved, testMode });
startAutosave(world, () => ui.onSaved());

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#22351f', // dark forest green beyond the scenery ring
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  // load every image in one batch (the queue otherwise waits for game-loop ticks between batches)
  loader: { maxParallelDownloads: 64 },
  scene: [new GameScene(world, ui)],
});

// handy for debugging in the browser console
window.__museum = { world, game };
