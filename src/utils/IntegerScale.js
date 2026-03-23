// src/utils/IntegerScale.js
// Pixel-perfect scaling helpers (VIEW layer).
//
// Responsibilities:
// - Apply integer scaling so pixel art stays crisp
// - Resize canvas display size while keeping internal resolution fixed
// - Install resize handler for responsive window scaling
//
// Non-goals:
// - Does NOT affect world state, physics, or entities
// - Does NOT draw game content
//
// Architectural notes:
// - main.js calls applyIntegerScale() once and installs a resize handler.
// - Complements "pixelated" canvas mode and manual physics stepping (world.autoStep = false).

export function applyIntegerScale(viewW, viewH) {
  const c = document.querySelector("canvas");
  if (!c) return;

  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / viewW, window.innerHeight / viewH)));
  c.style.width = viewW * scale + "px";
  c.style.height = viewH * scale + "px";
}

export function installResizeHandler(viewW, viewH) {
  window.addEventListener("resize", () => applyIntegerScale(viewW, viewH));
}
