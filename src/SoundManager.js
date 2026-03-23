// src/SoundManager.js
// Audio playback (SYSTEM layer).
//
// Responsibilities:
// - Load sound assets during preload() (via loadSound)
// - Play sounds by key (SFX/music)
// - Provide a simple abstraction so gameplay code never touches audio directly
//
// Non-goals:
// - Does NOT subscribe to EventBus directly (Game wires events → play())
// - Does NOT decide when events happen (WORLD logic emits events)
// - Does NOT manage UI
//
// Architectural notes:
// - Game connects EventBus events (leaf:collected, player:damaged, etc.) to SoundManager.play().
// - This keeps audio concerns isolated from gameplay and supports easy swapping/muting.
import {loadSoundAsync} from "./AssetLoader.js";
export class SoundManager {
  constructor() {
    this.sfx = {};
  }

  async load(name, path) {
    this.sfx[name] = await loadSoundAsync(path);
  }

  play(name) {
    this.sfx[name]?.play();
  }
}