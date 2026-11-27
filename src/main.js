import Phaser from 'phaser';
import { createInitialWorld } from './sim/world.js';
import { GameScene } from './render/GameScene.js';
import { createUI } from './render/ui.js';
import { loadGame, startAutosave } from './save/storage.js';

// resume the saved game if there is one
const saved = loadGame();
const world = saved ?? createInitialWorld(Math.floor(Math.random() * 1e9));
const ui = createUI(world, { resumed: !!saved });
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

// The 3D view is the main view; Phaser keeps running hidden underneath for the simulation.
// (?2d in the address keeps the old 2D view, for checks.)
if (!new URLSearchParams(window.location.search).has('2d')) {
  import('./render3d/park3d.js')
    .then((m) => m.startPark3D(world, ui))
    .catch((err) => console.error(err)); // the 2D view stays
}

// handy for debugging in the browser console
window.__museum = { world, game };
