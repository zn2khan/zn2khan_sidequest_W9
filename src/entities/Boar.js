// src/entities/Boar.js
// Enemy controller (WORLD entity).
//
// Responsibilities:
// - Create and configure boar sprites from tilemap spawns ("b")
// - Run boar AI each frame (patrol + probe-based turning)
// - Manage probes (front/foot/ground) for terrain and hazard sensing
// - Handle damage, knockback, flash, death animation, and removal
// - Expose simple API to Level (update/reset hooks as needed)
//
// Non-goals:
// - Does NOT reduce player health directly (Level wires collision → Player.takeDamageFromX)
// - Does NOT modify score or win state (Level does)
// - Does NOT control camera/parallax or draw screen-space UI (VIEW layer)
// - Does NOT play sounds directly (emit events; Game wires SoundManager)
//
// Architectural notes:
// - Boar owns AI + combat state (hp, knock timers, probes, death state).
// - Level owns the world rules and manages group creation/spawns.
// - Boar emits events via EventBus (boar:damaged, boar:died) for sound/debug/UI decoupling.

export class BoarController {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;
    this.tuning = pkg.tuning || {};
    this.bounds = pkg.bounds || {};

    // assigned later
    this.group = null;
    this.solids = null;
    this.leaf = null;
    this.fire = null;
    this.wallsL = null;
    this.wallsR = null;

    // tuning defaults (match monolith)
    const b = this.tuning.boar || {};
    this.W = b.w ?? 18;
    this.H = b.h ?? 12;
    this.SPEED = b.speed ?? 0.6;
    this.HP = b.hp ?? 3;

    this.KNOCK_FRAMES = b.knockFrames ?? 7;
    this.KNOCK_X = b.knockbackX ?? 1.2;
    this.KNOCK_Y = b.knockbackY ?? 1.6;
    this.FLASH_FRAMES = b.flashFrames ?? 5;

    this.TURN_COOLDOWN = b.turnCooldown ?? 12;

    this.PROBE_FORWARD = b.probeForward ?? 10;
    this.PROBE_FRONT_Y = b.probeFrontY ?? 10;
    this.PROBE_HEAD_Y = b.probeHeadY ?? 0;
    this.PROBE_SIZE = b.probeSize ?? 4;
  }

  /**
   * Attach probes and initialize each boar sprite in the existing group.
   * @param {Group} boarGroup
   * @param {Object} refs
   * @param {Object} refs.solids - { ground, groundDeep, platformsL, platformsR }
   * @param {Group} refs.leaf
   * @param {Group} refs.fire
   * @param {Group} refs.wallsL
   * @param {Group} refs.wallsR
   */
  initFromGroup(boarGroup, refs) {
    this.group = boarGroup;

    this.solids = refs.solids;
    this.leaf = refs.leaf;
    this.fire = refs.fire;
    this.wallsL = refs.wallsL;
    this.wallsR = refs.wallsR;

    // Collide with solids/walls (turning rule via collision + probe logic)
    this._hookSolids();

    // Ensure boars die in fire (world rule)
    if (this.fire) {
      this.group.overlaps(this.fire, (e) => this.dieInFire(e));
    }

    for (const e of this.group) this._initOne(e);
  }

  _hookSolids() {
    if (!this.group || !this.solids) return;
    const { ground, groundDeep, platformsL, platformsR } = this.solids;

    this.group.collides(ground);
    this.group.collides(groundDeep);
    this.group.collides(platformsL);
    this.group.collides(platformsR);

    if (this.wallsL) this.group.collides(this.wallsL);
    if (this.wallsR) this.group.collides(this.wallsR);
  }

  _initOne(e) {
    e.physics = "dynamic";
    e.rotationLock = true;

    e.w = this.W;
    e.h = this.H;

    e.friction = 0;
    e.bounciness = 0;

    e.hp = e.hp ?? this.HP;

    this._attachProbes(e);

    // choose a safe direction BEFORE first movement
    e.dir = e.dir === 1 || e.dir === -1 ? e.dir : random([-1, 1]);
    this._fixSpawnEdgeCase(e);

    e.wasDanger = false;

    e.flashTimer = 0;
    e.knockTimer = 0;
    e.turnTimer = 0;

    e.dead = false;
    e.dying = false;
    e.deathStarted = false;
    e.deathFrameTimer = 0;

    e.vanishTimer = 0;
    e.holdX = e.x;
    e.holdY = e.y;

    e.mirror.x = e.dir === -1;
    e.ani = "run";
  }

  // -------------------------
  // Public API
  // -------------------------
  update({ won = false, levelW = this.bounds.levelW } = {}) {
    if (!this.group) return;

    if (won) {
      for (const e of this.group) e.vel.x = 0;
      return;
    }

    for (const e of this.group) this._updateOne(e, levelW);
  }

  /**
   * Called by Level wiring (boar overlaps fire).
   */
  dieInFire(e) {
    if (e.dead || e.dying) return;
    e.hp = 0;
    e.dying = true;
    e.knockTimer = 0;
    e.vel.x = 0;
  }

  /**
   * Optional helper you can call from Player instead of mutating boar fields directly.
   * This mirrors monolith behavior.
   */
  takeHit(e, facingDir) {
    if (e.dead || e.dying) return;

    e.hp = max(0, (e.hp ?? this.HP) - 1);
    e.flashTimer = this.FLASH_FRAMES;

    if (e.hp <= 0) {
      e.dying = true;
      e.vel.x = 0;
      e.collider = "none";
      e.removeColliders();
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    e.knockTimer = this.KNOCK_FRAMES;
    e.vel.x = facingDir * this.KNOCK_X;
    e.vel.y = -this.KNOCK_Y;

    e.ani = "throwPose";
    e.ani.frame = 0;
  }

  // -------------------------
  // Internals (AI)
  // -------------------------
  _updateOne(e, levelW) {
    this._updateProbes(e);
    this._updateGroundProbe(e);

    // timers
    if (e.flashTimer > 0) e.flashTimer--;
    if (e.knockTimer > 0) e.knockTimer--;
    if (e.turnTimer > 0) e.turnTimer--;

    // tint flash when hit
    e.tint = e.flashTimer > 0 ? "#ff5050" : "#ffffff";

    const grounded = this._grounded(e);

    // dying behavior: wait until grounded to start death
    if (!e.dead && e.dying && grounded) {
      e.dead = true;
      e.deathStarted = false;
    }

    if (e.dying && !e.dead) {
      e.vel.x = 0;
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    // start death once, then freeze + animate + remove
    if (e.dead && !e.deathStarted) {
      e.deathStarted = true;

      e.holdX = e.x;
      e.holdY = e.y;

      e.vel.x = 0;
      e.vel.y = 0;

      e.collider = "none";
      e.removeColliders();

      e.x = e.holdX;
      e.y = e.holdY;

      e.ani = "death";
      e.ani.frame = 0;

      e.deathFrameTimer = 0;
      e.vanishTimer = 24;
      e.visible = true;
    }

    if (e.dead) {
      e.x = e.holdX;
      e.y = e.holdY;

      const frames = this.assets.boarAnis?.death?.frames ?? 4;
      const delayFrames = this.assets.boarAnis?.death?.frameDelay ?? 16;
      const msPerFrame = (delayFrames * 1000) / 60;

      e.deathFrameTimer += deltaTime;
      const f = Math.floor(e.deathFrameTimer / msPerFrame);
      e.ani.frame = Math.min(frames - 1, f);

      if (f >= frames - 1) {
        if (e.vanishTimer > 0) {
          e.visible = Math.floor(e.vanishTimer / 3) % 2 === 0;
          e.vanishTimer--;
        } else {
          e.footProbe?.remove();
          e.frontProbe?.remove();
          e.groundProbe?.remove();
          e.remove();
        }
      }
      return;
    }

    // knockback overrides patrol
    if (e.knockTimer > 0) {
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    // if not grounded, don’t patrol
    if (!grounded) {
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    // default direction if missing
    if (e.dir !== 1 && e.dir !== -1) e.dir = random([-1, 1]);

    // world bounds safety
    if (e.x < e.w / 2) this._turn(e, 1);
    if (e.x > levelW - e.w / 2) this._turn(e, -1);

    // probe-based turning rules
    const noGroundAhead = !this._frontHasGround(e);
    const frontHitsLeaf = this.leaf ? e.frontProbe.overlapping(this.leaf) : false;
    const frontHitsFire = this.fire ? e.frontProbe.overlapping(this.fire) : false;
    const frontHitsWall = this._frontHitsWall(e);
    const headSeesFire = this.fire ? e.footProbe.overlapping(this.fire) : false;

    const dangerNow = noGroundAhead || frontHitsLeaf || frontHitsFire || frontHitsWall || headSeesFire;

    if (e.turnTimer === 0 && this._shouldTurnNow(e, dangerNow)) {
      this._turn(e, -e.dir);
      this._updateProbes(e);
      return;
    }

    // patrol
    e.vel.x = e.dir * this.SPEED;
    e.mirror.x = e.dir === -1;
    e.ani = "run";
  }

  _shouldTurnNow(e, dangerNow) {
    const risingEdge = dangerNow && !e.wasDanger;
    e.wasDanger = dangerNow;
    return risingEdge;
  }

  _turn(e, newDir) {
    if (e.turnTimer > 0) return;
    e.dir = newDir;
    e.turnTimer = this.TURN_COOLDOWN;

    // nudge away from obstacle + kill sideways bounce
    e.x += e.dir * 6;
    e.vel.x = 0;
  }

  // -------------------------
  // Probes
  // -------------------------
  _placeProbe(p, x, y) {
    p.x = x;
    p.y = y;
  }

  _attachProbes(e) {
    e.footProbe = new Sprite(-9999, -9999, this.PROBE_SIZE, this.PROBE_SIZE);
    e.footProbe.collider = "none";
    e.footProbe.sensor = true;
    e.footProbe.visible = false;
    e.footProbe.layer = 999;

    e.frontProbe = new Sprite(-9999, -9999, this.PROBE_SIZE, this.PROBE_SIZE);
    e.frontProbe.collider = "none";
    e.frontProbe.sensor = true;
    e.frontProbe.visible = false;
    e.frontProbe.layer = 999;

    e.groundProbe = new Sprite(-9999, -9999, this.PROBE_SIZE, this.PROBE_SIZE);
    e.groundProbe.collider = "none";
    e.groundProbe.sensor = true;
    e.groundProbe.visible = false;
    e.groundProbe.layer = 999;
  }

  _updateProbes(e) {
    const forwardX = e.x + e.dir * this.PROBE_FORWARD;
    this._placeProbe(e.frontProbe, forwardX, e.y + this.PROBE_FRONT_Y);
    this._placeProbe(e.footProbe, forwardX, e.y - this.PROBE_HEAD_Y);
  }

  _updateGroundProbe(e) {
    if (!e.groundProbe) return;
    this._placeProbe(e.groundProbe, e.x, e.y + e.h / 2 + 4);
  }

  _frontHasGround(e) {
    const p = e.frontProbe;
    const s = this.solids;
    return (
      p.overlapping(s.ground) ||
      p.overlapping(s.groundDeep) ||
      p.overlapping(s.platformsL) ||
      p.overlapping(s.platformsR)
    );
  }

  _frontHitsWall(e) {
    const p = e.frontProbe;
    const hitL = this.wallsL ? p.overlapping(this.wallsL) : false;
    const hitR = this.wallsR ? p.overlapping(this.wallsR) : false;
    return hitL || hitR;
  }

  _grounded(e) {
    const p = e.groundProbe;
    const s = this.solids;
    return (
      p.overlapping(s.ground) ||
      p.overlapping(s.groundDeep) ||
      p.overlapping(s.platformsL) ||
      p.overlapping(s.platformsR)
    );
  }

  _groundAheadForDir(e, dir) {
    const old = e.dir;
    e.dir = dir;
    this._updateProbes(e);

    const ok = this._frontHasGround(e);

    e.dir = old;
    return ok;
  }

  _fixSpawnEdgeCase(e) {
    const leftOk = this._groundAheadForDir(e, -1);
    const rightOk = this._groundAheadForDir(e, 1);

    if (leftOk && !rightOk) e.dir = -1;
    else if (rightOk && !leftOk) e.dir = 1;

    this._updateProbes(e);
    e.vel.x = 0;
    e.turnTimer = 0;
    e.wasDanger = false;
  }
}
