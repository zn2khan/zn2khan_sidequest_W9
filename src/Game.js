// src/Game.js
// Game orchestrator (WORLD coordinator + SYSTEM wiring).
//
// Responsibilities:
// - Own the EventBus instance (system messaging)
// - Own InputManager snapshot flow (kb boundary)
// - Wire SoundManager + DebugOverlay to EventBus events
// - Build and update the active Level (world container)
// - Handle restart and high-level flow (state machine as project grows)
//
// Non-goals:
// - Does NOT handle camera/parallax/background drawing (VIEW layer in main.js)
// - Does NOT contain per-entity behavior (Player/Boar/etc. own that logic)
// - Does NOT load JSON documents directly (LevelLoader does)
//
// Architectural notes:
// - Game sits between SYSTEM modules and WORLD simulation.
// - main.js remains the VIEW/orchestration layer for rendering setup.

import { EventBus } from "./EventBus.js";
import { Level } from "./Level.js";
import { HighScoreManager } from "./HighScoreManager.js";

export class Game {
  constructor(levelPkg, assets, opts = {}) {
    this.pkg = levelPkg;
    this.assets = assets;
    this.hudGfx = opts.hudGfx || null;

    // core systems
    this.events = new EventBus();

    // plug-in systems
    this.input = opts.inputManager || null;
    this.sound = opts.soundManager || null;
    this.debug = opts.debugOverlay || null;

    // highscores (SYSTEM)
    this.highScores = opts.highScores || new HighScoreManager();

    // world
    this.level = null;

    // high-level flow flags (WORLD-coordinator state)
    this.lost = false;

    // win/score UI state (VIEW reads these)
    this.won = false; // mirror of level.won but latched for UI convenience
    this.elapsedMs = 0; // mirror of level.elapsedMs (timer in Level)
    this.bestMs = null; // best time for this level id (if you also store per-level best)
    this.lastWinMs = null; // time you just finished with
    this.lastWinWasNewBest = false;

    // leaderboard UI state (top 5)
    this.topScores = []; // [{ name, ms }, ...]
    this.lastRank = null; // 0-4 if in top 5, else null

    // name-entry flow
    this.awaitingName = false; // if true, WinScreen should show name entry UI
    this.nameEntry = "AAA"; // editable 3 letters
    this._nameCursor = 0; // 0..2
    this._blink = 0;

    // internal guard so we submit highscores ONCE per win
    this._submittedWin = false;

    this._unsubs = [];
  }

  build() {
    this.level = new Level(this.pkg, this.assets, {
      hudGfx: this.hudGfx,
      events: this.events,
    });
    this.level.build();

    // for the background music
    this.sound.play("music");

    // init leaderboard snapshot
    this.topScores = this.highScores.getTop?.(5) ?? [];

    // optional per-level best (keep if your manager supports per-level keys; safe if null)
    const levelId = this._levelId();
    this.bestMs = this.highScores.getBestTime?.(levelId) ?? null;

    this._wireEventListeners();
    return this;
  }

  _levelId() {
    // Prefer an explicit id if you store one in levels.json.
    // Fall back to your known start id.
    return this.pkg?.level?.id ?? this.pkg?.level?.levelId ?? "ex5_level1";
  }

  _wireEventListeners() {
    // re-wire safely (one set of listeners per Game instance)
    this._unsubs.forEach((u) => u());
    this._unsubs = [];

    // -----------------------
    // WORLD flow listeners
    // -----------------------
    this._unsubs.push(
      this.events.on("player:died", () => {
        this.lost = true;
      })
    );

    // When the level is won, latch + submit time ONCE.
    this._unsubs.push(
      this.events.on("level:won", () => {
        this.won = true;

        // freeze the visible timer at win moment (Level should stop ticking too,
        // but this makes UI robust even if Level internals change)
        this.elapsedMs = Number(this.level?.elapsedMs ?? this.elapsedMs ?? 0);

        if (this._submittedWin) return;
        this._submittedWin = true;

        const t = Number(this.level?.elapsedMs ?? 0);
        this.lastWinMs = t;

        // Try to insert into global top-5 leaderboard
        if (typeof this.highScores.tryInsert === "function") {
          const res = this.highScores.tryInsert(t);
          this.topScores = res.top ?? this.topScores;
          this.lastRank = Number.isFinite(res.rank) ? res.rank : null;

          // If we made the board, enter name-entry mode
          if (this.lastRank !== null) {
            this.awaitingName = true;
            this.nameEntry = "AAA";
            this._nameCursor = 0;
            this._blink = 0;
          } else {
            this.awaitingName = false;
          }
        } else if (typeof this.highScores.submitTime === "function") {
          // Back-compat with your earlier per-level best API
          const levelId = this._levelId();
          const res = this.highScores.submitTime(levelId, t);
          this.bestMs = res.bestMs;
          this.lastWinWasNewBest = res.isNewBest;

          // also refresh board if available
          this.topScores = this.highScores.getTop?.(5) ?? this.topScores;
        }
      })
    );

    // Clear terminal flags when the level restarts
    this._unsubs.push(
      this.events.on("level:restarted", () => {
        this.lost = false;
        this.won = false;

        this._submittedWin = false;

        this.elapsedMs = 0;
        this.lastWinMs = null;
        this.lastWinWasNewBest = false;

        this.awaitingName = false;
        this.lastRank = null;
        this.nameEntry = "AAA";
        this._nameCursor = 0;
        this._blink = 0;

        // refresh snapshots
        this.topScores = this.highScores.getTop?.(5) ?? [];
        const levelId = this._levelId();
        this.bestMs = this.highScores.getBestTime?.(levelId) ?? null;
      })
    );

    // -----------------------
    // SYSTEM listeners (sound/debug)
    // -----------------------
    if (this.sound) {
      this._unsubs.push(
        this.events.on("leaf:collected", () => this.sound.play("leaf"))
      );
      this._unsubs.push(
        this.events.on("player:damaged", () => this.sound.play("hurt"))
      );
      this._unsubs.push(
        this.events.on("player:jumped", () => this.sound.play("jump"))
      );
      this._unsubs.push(
        this.events.on("level:won", () => this.sound.play("win"))
      );
      this._unsubs.push(
        this.events.on("boar:damaged", () => this.sound.play("hit"))
      );
    }

    if (this.debug) {
      this._unsubs.push(this.events.on("*", (evt) => this.debug.log?.(evt)));
    }
  }

  update() {
    let inputSnap = null;

    if (this.input) {
      this.input.update();
      inputSnap = this.input.input;
    } else {
      inputSnap = {
        left: kb.pressing("left"),
        right: kb.pressing("right"),
        jumpPressed: kb.presses("up"),
        attackPressed: kb.presses("space"),
        restartPressed: kb.presses("r"),
        debugTogglePressed: kb.presses("t"),
      };
    }

    if (inputSnap?.debugTogglePressed && this.debug) {
      this.debug.toggle();
    }

    // Always advance WORLD (keeps physics + animation normal).
    // Level should stop its internal timer when won/dead.
    this.level.update({ input: inputSnap });

    // Mirror timer + win state for VIEW convenience
    // - If won/lost, keep elapsedMs frozen at the last value we latched.
    const levelElapsed = Number(this.level?.elapsedMs ?? 0);
    const levelWon = this.level?.won === true;

    const dead = this.lost === true || this.level?.player?.dead === true;
    const terminal = levelWon || dead || this.won;

    if (!terminal) {
      this.elapsedMs = levelElapsed;
    } else if (!Number.isFinite(this.elapsedMs)) {
      this.elapsedMs = levelElapsed;
    }

    this.won = levelWon || this.won === true;

    // -----------------------
    // Name-entry controls (only after a qualifying win)
    // -----------------------
    if (this.awaitingName) {
      this._blink = (this._blink + 1) % 60;

      // While entering name, we still allow restart (R) but we DON'T want
      // gameplay input (jump/attack) to do anything special.
      // Use:
      // - Left/Right to move cursor
      // - Up/Down to change letter
      // - Attack (Space) to confirm (or Jump)
      if (inputSnap?.left) this._nameCursor = Math.max(0, this._nameCursor - 1);
      if (inputSnap?.right)
        this._nameCursor = Math.min(2, this._nameCursor + 1);

      if (inputSnap?.jumpPressed) this._cycleNameChar(-1);
      if (inputSnap?.attackPressed) this._cycleNameChar(+1);

      // Confirm with Enter if you add it later; for now use RestartPressed? No—R is restart.
      // We'll confirm when the player presses SPACE while holding SHIFT is messy.
      // Instead: confirm when BOTH jumpPressed and attackPressed happen same frame is unlikely.
      // So: confirm on "debugTogglePressed" (T) as a stand-in, or add enter in InputManager.
      // We'll use T here to confirm (it’s unused during win screen).
      if (inputSnap?.debugTogglePressed) {
        this._commitNameEntry();
      }
    }

    // Restart only allowed from terminal states (win/lose)
    if (inputSnap?.restartPressed && (this.won || dead)) {
      this.restart();
    }
  }

  _cycleNameChar(dir) {
    // dir: +1 or -1
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const idx = this._nameCursor;
    const cur = this.nameEntry[idx] ?? "A";
    const at = Math.max(0, chars.indexOf(cur));
    const next = (at + dir + chars.length) % chars.length;
    this.nameEntry =
      this.nameEntry.substring(0, idx) +
      chars[next] +
      this.nameEntry.substring(idx + 1);
  }

  _commitNameEntry() {
    if (this.lastRank === null) {
      this.awaitingName = false;
      return;
    }
    if (typeof this.highScores.setNameAt === "function") {
      this.highScores.setNameAt(this.lastRank, this.nameEntry);
      this.topScores = this.highScores.getTop?.(5) ?? this.topScores;
    }
    this.awaitingName = false;
  }

  draw({ drawHudFn } = {}) {
    this.level.drawWorld();
    drawHudFn?.();

    if (this.debug) this.debug.draw?.({ game: this });
  }

  restart() {
    // reset coordinator flags immediately
    this.lost = false;
    this.won = false;

    this._submittedWin = false;

    this.elapsedMs = 0;
    this.lastWinMs = null;
    this.lastWinWasNewBest = false;

    this.awaitingName = false;
    this.lastRank = null;
    this.nameEntry = "AAA";
    this._nameCursor = 0;
    this._blink = 0;

    this.level.restart();

    // refresh leaderboard snapshot
    this.topScores = this.highScores.getTop?.(5) ?? this.topScores;
  }
}
