// src/WinScreen.js
// Win overlay screen (VIEW layer).
//
// Responsibilities:
// - Render win-state overlay in screen-space (camera.off())
// - Display completion message + relevant stats (time, score, leaderboard)
// - Provide prompts for restart / submission actions (UI only)
//
// Non-goals:
// - Does NOT modify world state directly (Game/Level do)
// - Does NOT compute high scores (HighScoreManager does)
// - Does NOT poll kb directly (InputManager → Game)
//
// Architectural notes:
// - Game decides when to show WinScreen (based on Level.won).
// - Keeps UI rendering separate from gameplay simulation.

export class WinScreen {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;

    // Bitmap font config (same charmap used in Level HUD)
    this.FONT_COLS = pkg.tuning?.hud?.fontCols ?? 19;
    this.CELL = pkg.tuning?.hud?.cell ?? 30;

    this.FONT_SCALE = pkg.tuning?.hud?.fontScale ?? 1 / 3;
    this.GLYPH_W = this.CELL * this.FONT_SCALE;

    this.FONT_CHARS =
      pkg.tuning?.hud?.fontChars ??
      " !\"#$%&'()*+,-./0123456789:;<=>?@" +
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
        "abcdefghijklmnopqrstuvwxyz{|}~";
  }

  // Accepts extra fields (best/last) but won’t break if you don’t pass them yet.
  draw({ elapsedMs, bestMs = null, lastWinMs = null, lastWinWasNewBest = false } = {}) {
    const viewW = this.pkg.view?.viewW ?? this.pkg.view?.w ?? 240;
    const viewH = this.pkg.view?.viewH ?? this.pkg.view?.h ?? 192;

    // IMPORTANT:
    // camera.off()/on() must be paired every frame, even if an error happens.
    camera.off();
    try {
      drawingContext.imageSmoothingEnabled = false;

      push();
      noStroke();
      fill(0, 120);
      rect(0, 0, viewW, viewH);
      pop();

      const msg1 = "YOU WIN!";
      const msg2 = `TIME ${formatTimeMs(elapsedMs ?? 0)}`;

      const showBest = Number.isFinite(bestMs) && bestMs >= 0;
      const bestLine = showBest ? `BEST ${formatTimeMs(bestMs)}` : "";

      // Optional “NEW BEST!” line if you want it
      const newBestLine = lastWinWasNewBest ? "NEW BEST!" : "";

      const msg3 = "Press R to restart";

      const x1 = Math.round((viewW - msg1.length * this.GLYPH_W) / 2);
      const x2 = Math.round((viewW - msg2.length * this.GLYPH_W) / 2);
      const x3 = Math.round((viewW - msg3.length * this.GLYPH_W) / 2);

      const y1 = Math.round(viewH / 2 - 44);
      const y2 = Math.round(viewH / 2 - 22);
      const yBest = Math.round(viewH / 2 + 0);
      const yNew = Math.round(viewH / 2 + 18);
      const y3 = Math.round(viewH / 2 + 38);

      this._drawOutlined(window, msg1, x1, y1, "#00e5ff");
      this._drawOutlined(window, msg2, x2, y2, "#ffdc00");

      if (bestLine) {
        const xBest = Math.round((viewW - bestLine.length * this.GLYPH_W) / 2);
        this._drawOutlined(window, bestLine, xBest, yBest, "#ffffff");
      }

      if (newBestLine) {
        const xNew = Math.round((viewW - newBestLine.length * this.GLYPH_W) / 2);
        this._drawOutlined(window, newBestLine, xNew, yNew, "#00ff7a");
      }

      this._drawOutlined(window, msg3, x3, y3, "#ffffff");
    } finally {
      camera.on();
      noTint();
    }
  }

  _drawBitmap(g, str, x, y, scale = this.FONT_SCALE) {
    if (!this.assets.fontImg) return;

    str = String(str);
    const dw = this.CELL * scale;
    const dh = this.CELL * scale;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const idx = this.FONT_CHARS.indexOf(ch);
      if (idx === -1) continue;

      const col = idx % this.FONT_COLS;
      const row = Math.floor(idx / this.FONT_COLS);

      const sx = col * this.CELL;
      const sy = row * this.CELL;

      g.image(
        this.assets.fontImg,
        Math.round(x + i * dw),
        Math.round(y),
        dw,
        dh,
        sx,
        sy,
        this.CELL,
        this.CELL,
      );
    }
  }

  _drawOutlined(g, str, x, y, fillHex) {
    g.tint("#000000");
    this._drawBitmap(g, str, x - 1, y);
    this._drawBitmap(g, str, x + 1, y);
    this._drawBitmap(g, str, x, y - 1);
    this._drawBitmap(g, str, x, y + 1);

    g.tint(fillHex);
    this._drawBitmap(g, str, x, y);

    g.noTint();
  }
}

function formatTimeMs(ms) {
  ms = Number(ms) || 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const hh = Math.floor((ms % 1000) / 10);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const hs = String(hh).padStart(2, "0");
  return `${mm}:${ss}.${hs}`;
}