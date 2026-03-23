// main.js
// Sketch entry point (VIEW + orchestration layer).
//
// Responsibilities:
// - Load tuning.json and levels.json via LevelLoader
// - Preload assets (images, animations, audio, parallax layers)
// - Create Canvas and configure pixel-perfect rendering
// - Instantiate and wire core systems (Game + input/sound/debug)
// - Draw VIEW elements (background colour, parallax, HUD composite)
// - Own VIEW setup: canvas size, integer scaling, parallax draw, HUD composite
// - Boot the WORLD: load JSON, preload assets, create Game + systems
//
// Non-goals:
// - Does NOT implement gameplay rules (WORLD logic lives in Level/entities)
// - Does NOT manage camera logic inside world update (VIEW modules do)
// - Does NOT contain entity behavior or physics setup beyond global world settings
//
// Architectural notes:
// - main.js owns VIEW setup (canvas sizing, scaling, parallax, background colour).
// - Game owns WORLD orchestration (EventBus, Level lifecycle, system wiring).
// - world.autoStep = false for stable pixel rendering; world.step() happens during world update.
//
// Important:
// - This file is loaded as a JS module (type="module").
// - In module scope, p5 will NOT automatically find setup/draw.
//   We MUST attach setup/draw (and input callbacks) to window.
//
// Notes:
// - Browsers block audio autoplay. We unlock audio on the first click/key press.
//
// Dependencies (loaded in index.html before this file):
// - p5.js
// - p5.sound (optional but required for loadSound)
// - p5play

import { LevelLoader } from "./src/LevelLoader.js";
import { Game } from "./src/Game.js";
import { ParallaxBackground } from "./src/ParallaxBackground.js";
import { loadAssets } from "./src/AssetLoader.js";
import {
  applyIntegerScale,
  installResizeHandler,
} from "./src/utils/IntegerScale.js";

import { CameraController } from "./src/CameraController.js";
import { InputManager } from "./src/InputManager.js";
import { SoundManager } from "./src/SoundManager.js";
import { DebugOverlay } from "./src/DebugOverlay.js";

import { WinScreen } from "./src/ui/WinScreen.js";
import { LoseScreen } from "./src/ui/LoseScreen.js";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// p5 loadJSON is callback-based. This wrapper lets us use async/await reliably.
function loadJSONAsync(url) {
  return new Promise((resolve, reject) => {
    loadJSON(url, resolve, reject);
  });
}

// Browsers block audio until a user gesture.
// We unlock it once and never think about it again.
let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (typeof userStartAudio === "function") userStartAudio();
}

// Prevent the browser from stealing keys (space/arrows) for scrolling.
function preventKeysThatScroll(evt) {
  const k = (evt?.key ?? "").toLowerCase();
  const scrollKeys = [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  if (scrollKeys.includes(k)) {
    evt.preventDefault?.();
    return false;
  }
  return true;
}

// ------------------------------------------------------------
// State (WORLD + VIEW glue)
// ------------------------------------------------------------

let game; // WORLD orchestrator (updates + draws world)
let parallax; // VIEW background parallax
let hudGfx; // VIEW overlay buffer (screen-space)

let tuningDoc; // Data: tuning.json
let levelPkg; // Data package from LevelLoader (level + view + world + tiles)
let assets; // Preloaded assets bundle

let cameraController; // VIEW: follow + clamp camera to world bounds
let inputManager; // SYSTEM: keyboard snapshot
let soundManager; // SYSTEM: audio registry
let debugOverlay; // VIEW/SYSTEM: debug UI

let winScreen;
let loseScreen;
let parallaxLayers = []; // Preloaded parallax layer defs [{ img, factor }, ...]

// Make URLs absolute so they can’t accidentally resolve relative to /src/...
const LEVELS_URL = new URL("./data/levels.json", window.location.href).href;
const TUNING_URL = new URL("./data/tuning.json", window.location.href).href;

// This must match a level id in levels.json
const START_LEVEL_ID = "ex5_level1";

// Boot flags
let bootStarted = false;
let bootDone = false;

// ------------------------------------------------------------
// Boot pipeline (async) — runs from setup()
// ------------------------------------------------------------

async function boot() {
  console.log("BOOT: start");

  // --- Data ---
  tuningDoc = await loadJSONAsync(TUNING_URL);

  const loader = new LevelLoader(tuningDoc);
  levelPkg = await loader.load(LEVELS_URL, START_LEVEL_ID);

  // --- Assets (images/animations/etc.) ---
  assets = await loadAssets(levelPkg, tuningDoc);

  // --- Audio registry ---
  // (AudioContext may still be locked until the user clicks/presses a key.)
  soundManager = new SoundManager();

  //Load sounds
  await soundManager.load("hit", "./assets/sfx/hitEnemy.wav");
  await soundManager.load("leaf", "./assets/sfx/leafCollect.wav");
  await soundManager.load("jump", "./assets/sfx/jump.wav");
  await soundManager.load("music", "./assets/sfx/music.wav");
  await soundManager.load("hurt", "./assets/sfx/receiveDamage.wav");

  // --- Parallax layer defs (VIEW) ---
  const defs = levelPkg.level?.view?.parallax ?? [];
  parallaxLayers = defs
    .map((d) => ({
      img: loadImage(d.img),
      factor: Number(d.speed ?? 0),
    }))
    .filter((l) => l.img);

  // Now that all data is ready, build the WORLD + VIEW runtime.
  initRuntime();

  bootDone = true;
  console.log("BOOT: done");
}

// ------------------------------------------------------------
// Runtime init (sync) — called after boot() finishes
// ------------------------------------------------------------

function initRuntime() {
  const { viewW, viewH } = levelPkg.view;

  // Resize the tiny placeholder canvas created in setup().
  resizeCanvas(viewW, viewH);

  // Pixel art: never smooth, never retina-scale the main canvas.
  pixelDensity(1);
  noSmooth();
  drawingContext.imageSmoothingEnabled = false;

  // Keep timing stable (p5play anims feel best when p5 is targeting 60).
  frameRate(60);

  // Pixel-perfect scaling to fill the browser window by integer multiples.
  applyIntegerScale(viewW, viewH);
  installResizeHandler(viewW, viewH);

  // Sprite rendering
  allSprites.pixelPerfect = true;

  // Physics: manual step for stable pixel rendering
  world.autoStep = false;

  // HUD buffer (screen-space)
  hudGfx = createGraphics(viewW, viewH);
  hudGfx.noSmooth();
  hudGfx.pixelDensity(1);

  // Systems
  inputManager = new InputManager();
  debugOverlay = new DebugOverlay();

  // WORLD
  game = new Game(levelPkg, assets, {
    hudGfx,
    inputManager,
    soundManager,
    debugOverlay,
  });
  game.build();

  // UI overlays
  winScreen = new WinScreen(levelPkg, assets);
  loseScreen = new LoseScreen(levelPkg, assets);

  // VIEW: camera follow + clamp
  cameraController = new CameraController(levelPkg);
  cameraController.setTarget(game.level.playerCtrl.sprite);
  cameraController.reset();

  // IMPORTANT: subscribe ONCE (not in draw)
  game.events.on("level:restarted", () => {
    cameraController?.reset();
  });

  // VIEW: parallax background renderer
  parallax = new ParallaxBackground(parallaxLayers);

  loop();
}

// ------------------------------------------------------------
// p5 lifecycle (module-safe)
// ------------------------------------------------------------

function setup() {
  // Create a tiny placeholder canvas immediately so p5 is happy,
  // then pause the loop until our async boot finishes.
  new Canvas(10, 10, "pixelated");
  pixelDensity(1);
  noLoop();

  if (bootStarted) return;
  bootStarted = true;

  boot().catch((err) => {
    console.error("BOOT FAILED:", err);
    // loop stays stopped so the sketch doesn't spam errors
  });
}

function draw() {
  if (!bootDone || !levelPkg || !game) return;

  const viewW = levelPkg.view.viewW;
  const viewH = levelPkg.view.viewH;

  // Background colour is per-level in levels.json: level.view.background
  const bg = levelPkg.level?.view?.background ?? [69, 61, 79];
  background(bg[0], bg[1], bg[2]);

  // Parallax uses camera.x from previous frame (fine with manual stepping)
  parallax?.draw({
    cameraX: camera.x || 0,
    viewW,
    viewH,
  });

  // WORLD update (includes physics step)
  game.update();

  // VIEW: camera follow + clamp (after update so player position is current)
  cameraController?.update({
    viewW,
    viewH,
    levelW: game.level.bounds.levelW,
    levelH: game.level.bounds.levelH,
  });
  cameraController?.applyToP5Camera();

  // WORLD draw + HUD composite
  game.draw({
    drawHudFn: () => {
      // camera.off()/on() MUST be paired even if something throws.
      camera.off();
      try {
        drawingContext.imageSmoothingEnabled = false;
        imageMode(CORNER);
        image(hudGfx, 0, 0);
      } finally {
        camera.on();
        noTint(); // prevent tint leaking into world next frame
      }
    },
  });

  // -----------------------------
  // VIEW flow gates
  // -----------------------------
  const won = game?.won === true || game?.level?.won === true;
  const dead = game?.lost === true || game?.level?.player?.dead === true;

  // Prefer Game mirror
  const elapsedMs = Number(game?.elapsedMs ?? game?.level?.elapsedMs ?? 0);

  // These overlay draw calls already guard camera.off/on internally,
  // but we keep them outside of any camera.off scope here.
  if (won) winScreen?.draw({ elapsedMs, game });
  if (dead) loseScreen?.draw({ elapsedMs, game });
}

// ------------------------------------------------------------
// Optional input callbacks (audio unlock feels invisible)
// ------------------------------------------------------------

function mousePressed() {
  unlockAudioOnce();
}

function keyPressed(evt) {
  unlockAudioOnce();
  return preventKeysThatScroll(evt);
}

// Extra safety: prevent scrolling even if p5 doesn’t route a key event you expect.
window.addEventListener(
  "keydown",
  (e) => {
    const k = (e.key ?? "").toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
    }
  },
  { passive: false }
);

// ------------------------------------------------------------
// IMPORTANT: expose p5 entrypoints in module scope
// ------------------------------------------------------------

window.setup = setup;
window.draw = draw;
window.mousePressed = mousePressed;
window.keyPressed = keyPressed;
