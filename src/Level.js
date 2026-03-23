// src/Level.js
// World container (WORLD layer).
//
// Responsibilities:
// - Build tilemap and static groups from level.tilemap
// - Spawn and manage world entities (Player, Boar, Leaf, Fire)
// - Apply world rules (gravity, fall reset, win condition)
// - Track world metrics (score, win flag) and handle reset logic
//
// Non-goals:
// - Does NOT control camera, parallax, or screen-space UI (VIEW layer)
// - Does NOT own global flow/state machine (Game does)
// - Does NOT load JSON files (LevelLoader does)
//
// Architectural notes:
// - Level is the “simulation” layer.
// - Entities own their own behavior; Level wires interactions and world rules.
// - Emits events via EventBus to decouple from Sound/UI/Debug systems.

import { PlayerEntity } from "./entities/PlayerEntity.js";
import { PlayerController } from "./world/PlayerController.js";
import { buildTilesAndGroups } from "./world/TileBuilder.js";
import {
  hookBoarSolids,
  cacheBoarSpawns,
  updateBoars,
  clearBoars,
  rebuildBoarsFromSpawns,
} from "./world/BoarSystem.js";
import { maybeRedrawHUD, redrawHUD } from "./world/HUDRenderer.js";

export class Level {
  constructor(pkg, assets, opts = {}) {
    this.pkg = pkg;
    this.assets = assets;
    this.hudGfx = opts.hudGfx || null;
    this.events = opts.events || null;

    this.levelData = pkg.level;
    this.tuning = pkg.tuning || {};
    this.worldCfg = pkg.world || {};
    this.tilesCfg = pkg.tiles || {};
    this.bounds = pkg.bounds || {};

    this.score = 0;
    this.won = false;
    this.elapsedMs = 0;

    this.ground = null;
    this.groundDeep = null;
    this.platformsL = null;
    this.platformsR = null;
    this.wallsL = null;
    this.wallsR = null;

    this.boar = null;
    this.leaf = null;
    this.fire = null;

    this.player = null;
    this.playerCtrl = null;

    this.leafSpawns = [];
    this.boarSpawns = [];

    this._lastScore = null;
    this._lastHealth = null;
    this._lastMaxHealth = null;

    this.WIN_SCORE = Number(this.worldCfg.winScore ?? this.levelData?.winScore ?? 15);
    this.GRAVITY = Number(this.worldCfg.gravity ?? this.levelData?.gravity ?? 10);
    this.FALL_RESET_MARGIN_TILES = Number(
      this.worldCfg.fallResetMarginTiles ?? this.levelData?.fallResetMarginTiles ?? 3,
    );

    // debug flags
    this.debugFlags = {
      moonGravity: false,
      invincible: false,
    };

    this._defaultGravity = this.GRAVITY;
    this._moonGravityValue = Math.max(1, this.GRAVITY * 0.35);

    this._playerInteractionsWired = false;
    this._boarFireWired = false;
    this._boarGroupBoundForPlayer = null;

    this._unsubs = [];
    this._installEventListeners();
  }

  _installEventListeners() {
    if (!this.events) return;
    this._unsubs.push(this.events.on("player:attackWindow", (info) => this._tryHitBoar(info)));
  }

  destroy() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
  }

  // -----------------------
  // debug helpers
  // -----------------------

  _applyGravitySetting() {
    world.gravity.y = this.debugFlags.moonGravity
      ? this._moonGravityValue
      : this._defaultGravity;
  }

  setMoonGravityEnabled(enabled) {
    this.debugFlags.moonGravity = !!enabled;
    this._applyGravitySetting();

    this.events?.emit("debug:moonGravityToggled", {
      enabled: this.debugFlags.moonGravity,
      gravity: world.gravity.y,
    });
  }

  toggleMoonGravity() {
    this.setMoonGravityEnabled(!this.debugFlags.moonGravity);
  }

  setInvincibleEnabled(enabled) {
    this.debugFlags.invincible = !!enabled;

    this.events?.emit("debug:invincibleToggled", {
      enabled: this.debugFlags.invincible,
    });
  }

  toggleInvincible() {
    this.setInvincibleEnabled(!this.debugFlags.invincible);
  }

  // -----------------------
  // ani safety helpers
  // -----------------------

  _setAniSafe(sprite, name) {
    if (!sprite?.anis || !sprite.anis[name]) return false;
    sprite.ani = name;
    return true;
  }

  _setAniFrame0Safe(sprite, name) {
    if (!this._setAniSafe(sprite, name)) return false;
    if (sprite.ani) sprite.ani.frame = 0;
    return true;
  }

  // -----------------------
  // build / loop
  // -----------------------

  build() {
    this._applyGravitySetting();
    this.elapsedMs = 0;

    buildTilesAndGroups(this);

    this.player = new PlayerEntity(this.pkg, this.assets);
    this.player.buildSprites();
    this.playerCtrl = new PlayerController(this.player, { events: this.events });

    this._cacheLeafSpawns();
    cacheBoarSpawns(this);

    this._wirePlayerInteractionsOnce();
    this._wireBoarFireRuleOnce();
    this._rebindPlayerBoarCollide();
    hookBoarSolids(this);

    this._lastScore = this._lastHealth = this._lastMaxHealth = null;
    maybeRedrawHUD(this);

    return this;
  }

  update({ input }) {
    const playerDead = this.player?.dead === true;

    this._applyGravitySetting();

    if (!this.won && !playerDead) {
      this.elapsedMs += deltaTime;
    }

    if (!playerDead && !this.won) {
      updateBoars(this);
    } else if (this.boar) {
      for (const e of this.boar) e.vel.x = 0;
    }

    this.playerCtrl.update({
      input,
      solids: this._solids(),
      bounds: this.bounds,
      won: this.won,
    });

    this._preStepPhysicsSanity();

    world.step();

    this._fallResetIfNeeded();

    maybeRedrawHUD(this);
  }

  drawWorld() {
    allSprites.draw();
  }

  restart() {
    this.won = false;
    this.score = 0;
    this.elapsedMs = 0;

    this._applyGravitySetting();

    this.playerCtrl.reset();

    for (const item of this.leafSpawns) {
      const s = item.s;
      s.x = item.x;
      s.y = item.y;
      s.active = true;
      s.visible = true;
      s.removeColliders();
    }

    clearBoars(this);
    rebuildBoarsFromSpawns(this);

    this._boarFireWired = false;
    this._wireBoarFireRuleOnce();

    this._rebindPlayerBoarCollide();
    hookBoarSolids(this);

    this._lastScore = this._lastHealth = this._lastMaxHealth = null;
    maybeRedrawHUD(this);

    this.events?.emit("level:restarted");
  }

  // -----------------------
  // interactions
  // -----------------------

  _wirePlayerInteractionsOnce() {
    if (this._playerInteractionsWired) return;
    this._playerInteractionsWired = true;

    const p = this.playerCtrl.sprite;

    p.overlaps(this.leaf, (playerSprite, leafSprite) => this._rescueLeaf(playerSprite, leafSprite));

    p.overlaps(this.fire, (playerSprite, fireSprite) => {
      if (this.debugFlags.invincible) return;
      this.playerCtrl.damageFromX(fireSprite.x);
    });
  }

  _wireBoarFireRuleOnce() {
    if (this._boarFireWired) return;
    if (!this.boar || !this.fire) return;

    this._boarFireWired = true;
    this.boar.overlaps(this.fire, (boarSprite) => {
      if (boarSprite.dead || boarSprite.dying) return;
      boarSprite.hp = 0;
      boarSprite.dying = true;
      boarSprite.knockTimer = 0;
      boarSprite.vel.x = 0;
    });
  }

  _rebindPlayerBoarCollide() {
    const p = this.playerCtrl?.sprite;
    const g = this.boar;
    if (!p || !g) return;

    if (this._boarGroupBoundForPlayer === g) return;
    this._boarGroupBoundForPlayer = g;

    p.collides(g, (playerSprite, boarSprite) => {
      if (boarSprite.dying || boarSprite.dead) return;
      if (this.debugFlags.invincible) return;
      this.playerCtrl.damageFromX(boarSprite.x);
    });
  }

  _rescueLeaf(playerSprite, leafSprite) {
    if (!leafSprite.active) return;

    leafSprite.active = false;
    leafSprite.visible = false;
    leafSprite.removeColliders();

    this.score++;
    this.events?.emit("leaf:collected", { score: this.score, winScore: this.WIN_SCORE });

    if (this.score >= this.WIN_SCORE) {
      this.won = true;

      playerSprite.vel.x = 0;
      playerSprite.vel.y = 0;

      this.events?.emit("level:won", {
        score: this.score,
        winScore: this.WIN_SCORE,
        elapsedMs: this.elapsedMs,
      });
    }
  }

  _tryHitBoar({ facing, x, y }) {
    if (!this.boar) return;
    if (this.player.attackHitThisSwing) return;

    const rangeX = Number(this.tuning.player?.attackRangeX ?? 20);
    const rangeY = Number(this.tuning.player?.attackRangeY ?? 16);

    const playerFeetY = y + (this.playerCtrl.sprite?.h ?? 12) / 2;

    for (const e of this.boar) {
      if (e.dead || e.dying) continue;

      const dx = e.x - x;
      if (Math.sign(dx) !== facing) continue;

      if (Math.abs(dx) > rangeX + (e.w ?? e.width ?? 18) / 2) continue;

      const boarFeetY = e.y + (e.h ?? e.height ?? 12) / 2;
      if (Math.abs(boarFeetY - playerFeetY) > rangeY + 10) continue;

      this._damageBoar(e, facing);

      this.player.markAttackHit();
      return;
    }
  }

  _damageBoar(e, facingDir) {
    if (e.dead || e.dying) return;

    const flashFrames = Number(this.tuning.boar?.flashFrames ?? 5);
    const knockFrames = Number(this.tuning.boar?.knockFrames ?? 7);
    const knockX = Number(this.tuning.boar?.knockbackX ?? 1.2);
    const knockY = Number(this.tuning.boar?.knockbackY ?? 1.6);

    e.hp = Math.max(0, (e.hp ?? Number(this.tuning.boar?.hp ?? 3)) - 1);
    e.flashTimer = flashFrames;

    this.events?.emit("boar:damaged", { hp: e.hp, x: e.x, y: e.y });

    if (e.hp <= 0) {
      e.dying = true;
      e.vel.x = 0;

      e.collider = "none";
      e.removeColliders();

      this._setAniFrame0Safe(e, "throwPose");

      this.events?.emit("boar:died", { x: e.x, y: e.y });
      return;
    }

    e.knockTimer = knockFrames;
    e.vel.x = facingDir * knockX;
    e.vel.y = -knockY;

    this._setAniFrame0Safe(e, "throwPose");
  }

  // -----------------------
  // helpers
  // -----------------------

  _cacheLeafSpawns() {
    this.leafSpawns = [];
    for (const s of this.leaf) {
      s.active = true;
      this.leafSpawns.push({ s, x: s.x, y: s.y });
    }
  }

  _solids() {
    return {
      ground: this.ground,
      groundDeep: this.groundDeep,
      platformsL: this.platformsL,
      platformsR: this.platformsR,
      wallsL: this.wallsL,
      wallsR: this.wallsR,
    };
  }

  _fallResetIfNeeded() {
    const tileH = Number(this.levelData?.tiles?.tileH ?? this.tilesCfg?.tileH ?? 24);
    const p = this.playerCtrl.sprite;
    const playerDead = this.player?.dead === true;

    if (!playerDead && !this.won && p.y > this.bounds.levelH + tileH * this.FALL_RESET_MARGIN_TILES) {
      p.x = this.player.startX;
      p.y = this.player.startY;
      p.vel.x = 0;
      p.vel.y = 0;
    }
  }

  _preStepPhysicsSanity() {
    for (const s of allSprites) {
      if (!s) continue;

      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
        console.warn("[SANITY] removing sprite with bad position:", { x: s.x, y: s.y });
        s.remove?.();
        continue;
      }

      if ("w" in s && (!Number.isFinite(s.w) || s.w <= 0)) {
        console.warn("[SANITY] removing sprite with bad width:", { w: s.w, x: s.x, y: s.y });
        s.remove?.();
        continue;
      }

      if ("h" in s && (!Number.isFinite(s.h) || s.h <= 0)) {
        console.warn("[SANITY] removing sprite with bad height:", { h: s.h, x: s.x, y: s.y });
        s.remove?.();
        continue;
      }

      if (s.body) {
        const p = s.body.getPosition?.();
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          console.warn("[SANITY] removing sprite with bad body position:", { p });
          s.remove?.();
        }
      }
    }
  }

  redrawHUD() {
    redrawHUD(this);
  }
}