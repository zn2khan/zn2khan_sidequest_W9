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
    this.won = false;
    this.elapsedMs = 0;
    this.bestMs = null;
    this.lastWinMs = null;
    this.lastWinWasNewBest = false;

    // leaderboard UI state (top 5)
    this.topScores = [];
    this.lastRank = null;

    // name-entry flow
    this.awaitingName = false;
    this.nameEntry = "AAA";
    this._nameCursor = 0;
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
    this.sound?.play("music");

    // init leaderboard snapshot
    const levelId = this._levelId();
    this.topScores = this.highScores.getTop?.(levelId) ?? [];

    // optional per-level best
    this.bestMs = this.highScores.getBestTime?.(levelId) ?? null;

    this._wireEventListeners();
    return this;
  }

  _levelId() {
    return this.pkg?.level?.id ?? this.pkg?.level?.levelId ?? "ex5_level1";
  }

  _wireEventListeners() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];

    this._unsubs.push(
      this.events.on("player:died", () => {
        this.lost = true;
      })
    );

    this._unsubs.push(
      this.events.on("level:won", () => {
        this.won = true;
        this.elapsedMs = Number(this.level?.elapsedMs ?? this.elapsedMs ?? 0);

        if (this._submittedWin) return;
        this._submittedWin = true;

        const t = Number(this.level?.elapsedMs ?? 0);
        this.lastWinMs = t;

        const levelId = this._levelId();

        if (typeof this.highScores.submit === "function") {
          const qualifies = this.highScores.qualifies?.(levelId, t) ?? true;

          if (qualifies) {
            const res = this.highScores.submit(levelId, "___", t);
            this.topScores = res.top ?? this.topScores;
            this.lastRank = Number.isFinite(res.rank) ? res.rank : null;

            if (this.lastRank !== null) {
              this.awaitingName = true;
              this.nameEntry = "AAA";
              this._nameCursor = 0;
              this._blink = 0;
            } else {
              this.awaitingName = false;
            }
          } else {
            this.awaitingName = false;
          }

          this.bestMs = this.highScores.getBestTime?.(levelId) ?? this.bestMs;
        }
      })
    );

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

        const levelId = this._levelId();
        this.topScores = this.highScores.getTop?.(levelId) ?? [];
        this.bestMs = this.highScores.getBestTime?.(levelId) ?? null;
      })
    );

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
        moonGravityTogglePressed: kb.presses("1"),
        invincibleTogglePressed: kb.presses("2"),
      };
    }

    if (inputSnap?.debugTogglePressed && this.debug) {
      this.debug.toggle();
    }

    // Debug cheats only work while the debug menu is visible
    if (this.debug?.enabled && this.level) {
      if (inputSnap?.moonGravityTogglePressed) {
        this.level.toggleMoonGravity();
      }

      if (inputSnap?.invincibleTogglePressed) {
        this.level.toggleInvincible();
      }
    }

    this.level.update({ input: inputSnap });

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

    if (this.awaitingName) {
      this._blink = (this._blink + 1) % 60;

      if (inputSnap?.left) this._nameCursor = Math.max(0, this._nameCursor - 1);
      if (inputSnap?.right) this._nameCursor = Math.min(2, this._nameCursor + 1);

      if (inputSnap?.jumpPressed) this._cycleNameChar(-1);
      if (inputSnap?.attackPressed) this._cycleNameChar(+1);

      if (inputSnap?.debugTogglePressed) {
        this._commitNameEntry();
      }
    }

    if (inputSnap?.restartPressed && (this.won || dead)) {
      this.restart();
    }
  }

  _cycleNameChar(dir) {
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

    const levelId = this._levelId();

    if (typeof this.highScores.setNameAt === "function") {
      this.highScores.setNameAt(levelId, this.lastRank, this.nameEntry);
      this.topScores = this.highScores.getTop?.(levelId) ?? this.topScores;
    }

    this.awaitingName = false;
  }

  draw({ drawHudFn } = {}) {
    this.level.drawWorld();
    drawHudFn?.();

    if (this.debug) this.debug.draw?.({ game: this });
  }

  restart() {
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

    const levelId = this._levelId();
    this.topScores = this.highScores.getTop?.(levelId) ?? this.topScores;
  }
}