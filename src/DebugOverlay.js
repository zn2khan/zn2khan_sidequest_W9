// src/DebugOverlay.js
// Debug overlay (VIEW tool, driven by SYSTEM events).
//
// Responsibilities:
// - Render debug info in screen-space (camera.off())
// - Toggle visibility (typically via InputManager signal)
// - Log events from EventBus (including wildcard "*")
// - Display lightweight runtime state (score/health/flags/events)
//
// Non-goals:
// - Does NOT change world state, physics, or outcomes
// - Does NOT own input polling (InputManager does)
// - Does NOT subscribe to events directly (Game wires it)
//
// Architectural notes:
// - Game owns the EventBus and forwards events to DebugOverlay.log().
// - This file exists to support iteration + teaching architecture boundaries.

export class DebugOverlay {
  constructor() {
    this.enabled = false;
    this.lines = [];
    this.maxLines = 8;
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  log(evt) {
    if (!evt) return;
    const msg = `${evt.name}`;
    this.lines.unshift(msg);
    if (this.lines.length > this.maxLines) this.lines.length = this.maxLines;
  }

  draw({ game } = {}) {
    if (!this.enabled) return;

    camera.off();

    push();
    noStroke();
    fill(0, 160);
    rect(6, 6, 300, 160, 6);
    pop();

    fill(255);
    textSize(10);

    const lvl = game?.level || null;
    const score = lvl?.score ?? 0;

    const player = lvl?.player ?? lvl?.playerCtrl?.player ?? null;
    const hp = player?.health ?? "?";
    const maxHp = player?.maxHealth ?? "?";
    const dead = player?.dead ?? false;
    const won = lvl?.won ?? false;

    const moonGravity = lvl?.debugFlags?.moonGravity ?? false;
    const invincible = lvl?.debugFlags?.invincible ?? false;
    const gravityValue = world?.gravity?.y ?? "?";

    text(`DEBUG MENU (T to close)`, 12, 20);
    text(`1 = Moon Gravity: ${moonGravity ? "ON" : "OFF"}`, 12, 34);
    text(`2 = Invincible: ${invincible ? "ON" : "OFF"}`, 12, 46);

    text(`Score: ${score}`, 12, 62);
    text(`Health: ${hp}/${maxHp}`, 12, 74);
    text(`Won: ${won}  Dead: ${dead}`, 12, 86);
    text(`Gravity Y: ${gravityValue}`, 12, 98);

    let y = 114;
    for (const line of this.lines) {
      text(line, 12, y);
      y += 10;
    }

    camera.on();
  }
}