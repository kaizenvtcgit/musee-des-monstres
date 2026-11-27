// Where the game is saved: the browser's local storage (one save per browser).
// Every access is guarded: storage can be missing or refused (private mode, blocked site data).
import { serializeWorld, deserializeWorld } from '../sim/save.js';

const KEY = 'musee-des-monstres:save';
export const AUTOSAVE_SEC = 20;

let enabled = true;

// The saved game, or null if there is none or it cannot be read.
export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserializeWorld(JSON.parse(raw)) : null;
  } catch (err) {
    console.warn('Saved game ignored:', err);
    return null;
  }
}

// Returns true when the game was written.
export function saveGame(world) {
  if (!enabled) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(serializeWorld(world)));
    return true;
  } catch (err) {
    console.warn('Could not save the game:', err);
    return false;
  }
}

// Erases the save and stops saving (the page is about to restart a new game).
export function eraseGame() {
  enabled = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to erase
  }
}

// Saves every AUTOSAVE_SEC seconds and when the player leaves the page; onSaved() after each save.
export function startAutosave(world, onSaved = () => {}) {
  const save = () => { if (saveGame(world)) onSaved(); };
  setInterval(save, AUTOSAVE_SEC * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('pagehide', save);
}
