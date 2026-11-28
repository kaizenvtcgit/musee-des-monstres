import Phaser from 'phaser';
import { createInitialWorld } from './sim/world.js';
import { GameScene } from './render/GameScene.js';
import { createUI } from './render/ui.js';
import { loadGame, startAutosave, useTestSave } from './save/storage.js';
import { t } from './i18n/index.js';
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

// Phaser runs the game, hidden (src/render/GameScene.js): it draws nothing, so a 1 px canvas, no input,
// no audio of its own (the sounds are synthesized: src/render/sound.js).
const game = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: 'game',
  width: 1,
  height: 1,
  banner: false,
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  audio: { noAudio: true },
  scene: [new GameScene(world, ui)],
});

// What the player sees: the park in 3D (three.js and the models are downloaded meanwhile).
import('./render3d/park3d.js')
  .then((m) => m.startPark3D(world, ui))
  .then((view) => { if (!view) ui.fatal(t('view3d.noWebgl')); })
  .catch((err) => {
    console.error(err);
    ui.fatal(t('view3d.noWebgl'));
  });

// handy for debugging in the browser console
window.__museum = { world, game };
