// src/InputManager.js
// Input boundary (SYSTEM layer).
//
// Responsibilities:
// - Read keyboard state each frame
// - Provide a stable input snapshot object (holds + presses)
// - Centralize key mapping so WORLD code never touches kb directly
//
// Contract (what Game/Player expect):
// - left/right: held booleans
// - jumpPressed/attackPressed: edge-triggered booleans (true for 1 frame)
// - restartPressed/debugTogglePressed: edge-triggered booleans (true for 1 frame)
//
// Notes:
// - Requires p5play global `kb`

export class InputManager {
  constructor() {
    // previous frame DOWN states (for edge detection)
    this._prevDown = {
      jump: false,
      attack: false,
      restart: false,
      debugToggle: false,
    };

    // canonical snapshot (same object reused every frame)
    this._input = {
      // held
      left: false,
      right: false,

      // edge-triggered (true for 1 frame)
      jumpPressed: false,
      attackPressed: false,
      restartPressed: false,
      debugTogglePressed: false,
    };
  }

  update() {
    // If kb isn't ready yet (rare during boot), keep a safe "all false" snapshot.
    if (typeof kb === "undefined" || !kb) {
      this._input.left = false;
      this._input.right = false;
      this._input.jumpPressed = false;
      this._input.attackPressed = false;
      this._input.restartPressed = false;
      this._input.debugTogglePressed = false;
      return this._input;
    }

    // -----------------------
    // Holds
    // -----------------------
    const leftHeld = kb.pressing("a") || kb.pressing("left");
    const rightHeld = kb.pressing("d") || kb.pressing("right");

    // -----------------------
    // Down states (for edges)
    // Use kb.pressing for "is currently down", then edge-detect ourselves.
    // (Avoid kb.presses here to keep all edge logic in one place.)
    // -----------------------
    const jumpDown = kb.pressing("w") || kb.pressing("up");
    const attackDown = kb.pressing("space");
    const restartDown = kb.pressing("r");
    const debugToggleDown = kb.pressing("t");

    // -----------------------
    // Write snapshot
    // -----------------------
    this._input.left = leftHeld;
    this._input.right = rightHeld;

    this._input.jumpPressed = jumpDown && !this._prevDown.jump;
    this._input.attackPressed = attackDown && !this._prevDown.attack;
    this._input.restartPressed = restartDown && !this._prevDown.restart;
    this._input.debugTogglePressed = debugToggleDown && !this._prevDown.debugToggle;

    // -----------------------
    // Store prev DOWN states
    // -----------------------
    this._prevDown.jump = jumpDown;
    this._prevDown.attack = attackDown;
    this._prevDown.restart = restartDown;
    this._prevDown.debugToggle = debugToggleDown;

    return this._input;
  }

  // Game.js expects: inputSnap = this.input.input;
  get input() {
    return this._input;
  }
}
