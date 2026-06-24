// main.js
// Scene setup + game orchestration for CHAOS GOMOKU 3D.
// The authoritative state lives in Game (gameLogic.js). Meshes are rebuilt from
// it; mesh positions are NEVER treated as game state.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Game, N, PLAYER, AI, opp, SKILLS, SKILL_BY_ID, DIFFS } from './gameLogic.js';
import { chooseMove, chooseSkill, THINK_MSGS, AI_DIALOGUE, pick } from './ai.js';
import { Effects } from './effects.js';
import { UI, PLACE_TEXTS } from './ui.js';
import { IntroSequence } from './intro.js';
import { A11yBoard } from './a11yBoard.js';
import { Sound } from './audio.js';
import { applyAction, place } from './ChaosGomoku3D.js';
import { NPC_AVATARS, NPC_CHARACTERS, getCharacter } from './characters.js';
import { CharacterSelect } from './characterSelect.js';
import { RenderScheduler, ResultTimer } from './renderScheduler.js';

const DEBUG = (() => {
  try {
    return /(?:^|[?&])debug=1(?:&|$)/.test(window.location.search) ||
      window.localStorage.getItem('cg3d_debug') === '1';
  } catch (e) {
    return false;
  }
})();   // dev-only debug panel: add ?debug=1 or localStorage cg3d_debug=1
const MAX_DPR = 1.5;
const CONTROL_DAMPING_MS = 260;
const DECORATIVE_PULSE_MS = 1200;

// ---- palette (matches the pixel-art UI) -------------------------------------
const COLORS = {
  bg: 0x2a0e16, wood: 0x8a5a2c, woodDark: 0x5c3a1c, woodEdge: 0x6e4524,
  grid: 0x3a2414, cream: 0xf6e7c8, red: 0xc0392b, gold: 0xe2b04a,
  dust: 0xcdba93, smoke: 0x9a8f86, black: 0x14101a, white: 0xece0c8, hoshi: 0x2c1a0e,
};

const SPACING = 1.0;
const SURFACE_Y = 0;                 // board top sits at y = 0
const HALF = (N - 1) / 2;            // 7
const GRID_Y = SURFACE_Y + 0.02;     // grid sticks float just above the surface
const STAR_Y = SURFACE_Y + 0.028;    // star points sit just above the grid
const PIECE_R = 0.46;                // stone radius (close to the 1.0 grid spacing)
const PIECE_FLAT = 0.42;             // vertical squish -> flattened Go-stone shape
const REST_Y = SURFACE_Y + PIECE_R * PIECE_FLAT + 0.02; // stone bottom just clears the board

// Single camera preset — used for initial load, restart, and Reset Camera.
const CAMERA_PRESET = {
  position: new THREE.Vector3(8.4, 11.4, 12.4),  // elevated three-quarter view
  target: new THREE.Vector3(0, 0, 0),
  minDistance: 11,
  maxDistance: 30,
  minPolar: 0.22,
  maxPolar: 1.30,                                 // never rotates under the board
  fov: 45,
};

// ============================================================================
// Audio (Web Audio API, generated — no asset files)
// ============================================================================

// ============================================================================
// Game controller
// ============================================================================
class ChaosGomoku3D {
  constructor() {
    this.game = new Game();
    this.sound = new Sound();
    this.pieces = new Map();        // "r,c" -> mesh
    this.inputLocked = true;        // true during anim / AI / menus
    this.pendingSkill = null;       // id of targeted skill awaiting a victim
    this.highlighted = [];          // enemy meshes glowing during targeting
    this._touched = [];             // every mesh whose material we changed for targeting
    this.hoverCell = null;
    this.lastAI = null;
    this.aiDepth = 0;
    this._camToken = 0;             // cancels stale Reset Camera animations
    this.reduced = this._loadReduced();  // accessibility: reduced motion/effects

    // ---- game mode + controllers (centralized; see helpers below) ----
    this.mode = this._loadMode();        // 'ai' | 'local'
    this.selection = null;               // UI-only character selection (not game state)
    this._pendingMode = 'ai';
    this._pendingDifficulty = 'medium';
    this._handoffOn = this._loadHandoff();
    this._aiGen = 0;                     // bumped to cancel any in-flight AI turn
    this._handoffTimer = null;
    this._introDummies = [];             // throwaway meshes used in the intro preview
    this._hidden = document.hidden;
    this._controlsInteracting = false;
    this._controlsActiveUntil = 0;
    this._pulseUntil = 0;
    this._resultTimer = new ResultTimer();
    this._matchGen = 0;
    this.perf = { renderTimes: [], lastRenderCalls: 0 };

    this._initThree();
    this._initBoard();
    this._initRenderScheduler();
    this._makeSkillIcons();      // render real 3D props -> icon thumbnails
    this._initInput();
    this._initUI();
    this._initA11y();
    this.intro = new IntroSequence(this._introCtx());
    this.invalidateShadows();

    this.ui.setSkillIcons(this.skillIconURL);
    this.ui.showScreen('splash');
    this.ui.setSoundButton(this.sound.on);
    this.ui.setVolume(this.sound.volume);
    this.ui.setReducedButton(this.reduced);
    this.ui.setHandoffButton(this._handoffOn);
    this.ui.setMode(this.mode);
    this.fx.reduced = this.reduced;
  }

  // ---- mode + controller helpers (single source of mode logic) -------------
  _loadMode() { try { const m = localStorage.getItem('cg3d_mode'); return m === 'local' ? 'local' : 'ai'; } catch (e) { return 'ai'; } }
  _persistMode() { try { localStorage.setItem('cg3d_mode', this.mode); } catch (e) {} }
  _loadHandoff() { try { return localStorage.getItem('cg3d_handoff') !== '0'; } catch (e) { return true; } }
  _persistHandoff() { try { localStorage.setItem('cg3d_handoff', this._handoffOn ? '1' : '0'); } catch (e) {} }

  // The board never cares who controls a side; these helpers decide behavior.
  getPlayerControllerType(side) { return (side === AI && this.mode === 'ai') ? 'ai' : 'human'; }
  isHumanControlled(side) { return this.getPlayerControllerType(side) === 'human'; }
  shouldRunAI() { return this.mode === 'ai'; }
  getPlayerDisplayName(side) {
    if (this.mode === 'local') return side === PLAYER ? 'PLAYER ONE' : 'PLAYER TWO';
    return side === PLAYER ? 'LOCAL MEAT COMPUTER' : 'PROFESSOR BEEP-BOOP';
  }
  _sideColorWord(side) { return side === PLAYER ? 'black' : 'white'; }
  // whose skill tray to show at the bottom (the active human in local mode)
  _traySide() { return this.mode === 'local' ? this.game.current : PLAYER; }

  _loadReduced() {
    try {
      const saved = localStorage.getItem('cg3d_reduced');
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch (e) { /* ignore */ }
    // default to the OS preference if the user hasn't chosen
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  _setReduced(v) {
    this.reduced = v;
    this.fx.reduced = v;
    try { localStorage.setItem('cg3d_reduced', v ? '1' : '0'); } catch (e) {}
    document.body.classList.toggle('reduced-motion', v);
    this.ui.setReducedButton(v);
  }

  // ---- Three.js scaffolding -------------------------------------------------
  _initThree() {
    const host = document.getElementById('scene-host');
    this.host = host;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);
    scene.fog = new THREE.Fog(COLORS.bg, 34, 78);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA_PRESET.fov, host.clientWidth / host.clientHeight, 0.1, 200);
    camera.position.copy(CAMERA_PRESET.position);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = CAMERA_PRESET.minDistance;
    controls.maxDistance = CAMERA_PRESET.maxDistance;
    controls.maxPolarAngle = CAMERA_PRESET.maxPolar;   // never go under the board
    controls.minPolarAngle = CAMERA_PRESET.minPolar;
    controls.target.copy(CAMERA_PRESET.target);
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('start', () => {
      this._controlsInteracting = true;
      this._controlsActiveUntil = performance.now() + CONTROL_DAMPING_MS;
      this.invalidate();
    });
    controls.addEventListener('change', () => {
      this._controlsActiveUntil = performance.now() + CONTROL_DAMPING_MS;
      this.invalidate();
    });
    controls.addEventListener('end', () => {
      this._controlsInteracting = false;
      this._controlsActiveUntil = performance.now() + CONTROL_DAMPING_MS;
      this.invalidate();
    });
    this.controls = controls;

    // lights
    const hemi = new THREE.HemisphereLight(0xfff0d6, 0x3a1c12, 0.55);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffd9a0, 1.15);
    dir.position.set(10, 18, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1; dir.shadow.camera.far = 60;
    dir.shadow.camera.left = -12; dir.shadow.camera.right = 12;
    dir.shadow.camera.top = 12; dir.shadow.camera.bottom = -12;
    dir.shadow.bias = -0.0006;
    scene.add(dir);
    scene.add(dir.target); dir.target.position.set(0, 0, 0);
    this.lights = { dir, hemi };

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);

    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this._onVisibilityChange());
  }

  _onResize() {
    const host = this.host;
    if (!host.clientWidth) return;
    this.camera.aspect = host.clientWidth / host.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.invalidate();
  }

  _initRenderScheduler() {
    this._renderScheduler = new RenderScheduler({
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
      isHidden: () => this._hidden || document.hidden,
      onFrame: (frame) => this._frame(frame),
    });
    this.invalidate();
  }

  invalidate() {
    if (this._renderScheduler) this._renderScheduler.invalidate();
  }

  invalidateShadows() {
    if (this.renderer && this.renderer.shadowMap) this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  _startDecorativePulse(duration = DECORATIVE_PULSE_MS) {
    this._pulseUntil = Math.max(this._pulseUntil, performance.now() + duration);
    this.invalidate();
  }

  _onVisibilityChange() {
    this._hidden = document.hidden;
    if (!this._renderScheduler) return;
    if (this._hidden) {
      this._controlsInteracting = false;
      this._controlsActiveUntil = 0;
    }
    this._renderScheduler.setHidden(this._hidden);
    if (!this._hidden) this.invalidateShadows();
  }

  // ---- board geometry -------------------------------------------------------
  _initBoard() {
    const group = new THREE.Group();
    this.boardGroup = group;
    this.scene.add(group);

    // ---- wooden platform: darker outer frame, lighter inset playing field ----
    const size = (N + 1) * SPACING;
    const thickness = 1.2;
    const platGeo = new RoundedBoxGeometry(size, thickness, size, 3, 0.28);
    const platMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1c, roughness: 0.9, metalness: 0.04 }); // dark frame
    const plat = new THREE.Mesh(platGeo, platMat);
    plat.position.y = SURFACE_Y - thickness / 2;
    plat.receiveShadow = true;
    group.add(plat);

    // lighter center surface so the grid + pieces read clearly against it
    const fieldGeo = new RoundedBoxGeometry((N - 0.1) * SPACING, 0.16, (N - 0.1) * SPACING, 2, 0.1);
    const fieldMat = new THREE.MeshStandardMaterial({ color: 0xa9712f, roughness: 0.86, metalness: 0.03 });
    const field = new THREE.Mesh(fieldGeo, fieldMat);
    field.position.y = SURFACE_Y - 0.05;
    field.receiveShadow = true;
    group.add(field);

    // ---- real 15x15 grid built from thin box "sticks" (WebGL line width is
    // unreliable, so we use geometry). Decorative -> excluded from raycasts. ----
    const gridGroup = new THREE.Group();
    const span = (N - 1) * SPACING;                 // 14 units between outer lines
    const gridMat = new THREE.MeshStandardMaterial({ color: 0x2a1708, roughness: 0.95, metalness: 0 });
    const lineW = 0.045, lineH = 0.05;
    const rowGeo = new THREE.BoxGeometry(span, lineH, lineW); // runs along X
    const colGeo = new THREE.BoxGeometry(lineW, lineH, span); // runs along Z
    for (let i = 0; i < N; i++) {
      const p = (i - HALF) * SPACING;
      const row = new THREE.Mesh(rowGeo, gridMat); row.position.set(0, GRID_Y, p);
      const col = new THREE.Mesh(colGeo, gridMat); col.position.set(p, GRID_Y, 0);
      row.receiveShadow = col.receiveShadow = true;
      gridGroup.add(row, col);
    }
    gridGroup.traverse((o) => { o.raycast = () => {}; });  // never block gameplay raycasts
    group.add(gridGroup);
    this._gridGroup = gridGroup; this._gridMat = gridMat; this._platMat = platMat;

    // ---- star points (hoshi), aligned to intersections via boardToWorld ----
    const hoshiGeo = new THREE.CircleGeometry(0.13, 16);
    const hoshiMat = new THREE.MeshBasicMaterial({ color: COLORS.hoshi });
    this._starDots = []; this._starMat = hoshiMat;
    for (const [r, c] of [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]) {
      const dot = new THREE.Mesh(hoshiGeo, hoshiMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.copy(this.boardToWorld(r, c, STAR_Y));
      dot.raycast = () => {};
      group.add(dot);
      this._starDots.push(dot);
    }

    // ---- shared stone geometry + base materials (cloned per stone) ----
    // a flattened sphere reads as a rounded Go stone; the flatten is baked into
    // the geometry so per-stone mesh.scale stays uniform (squash animation works).
    this.pieceGeo = new THREE.SphereGeometry(PIECE_R, 30, 18);
    this.pieceGeo.scale(1, PIECE_FLAT, 1);
    // black: subtle warm rim via emissive so it doesn't vanish into the burgundy
    this.matBlack = new THREE.MeshStandardMaterial({ color: 0x17121d, roughness: 0.34, metalness: 0.28, emissive: 0x2a2230, emissiveIntensity: 0.35 });
    // white: warm ivory, not pure white
    this.matWhite = new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: 0.4, metalness: 0.05, emissive: 0x000000 });

    // ---- hover ghost: a translucent stone + a soft pulsing ring ----
    const ghost = new THREE.Group();
    const ghostMat = new THREE.MeshStandardMaterial({ color: 0x2a2230, transparent: true, opacity: 0.4, emissive: COLORS.gold, emissiveIntensity: 0.25, roughness: 0.4 });
    const ghostStone = new THREE.Mesh(this.pieceGeo, ghostMat);
    ghostStone.position.y = REST_Y;
    const ghostRingMat = new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const ghostRing = new THREE.Mesh(new THREE.RingGeometry(PIECE_R + 0.07, PIECE_R + 0.2, 28), ghostRingMat);
    ghostRing.rotation.x = -Math.PI / 2; ghostRing.position.y = GRID_Y + 0.002;
    ghost.add(ghostStone, ghostRing);
    ghost.visible = false;
    ghost.traverse((o) => { o.raycast = () => {}; });
    this.ghost = ghost; this._ghostRingMat = ghostRingMat; this._ghostMat = ghostMat;
    group.add(ghost);

    // ---- latest-move marker: a subtle gold ring around the newest stone ----
    const lastMat = new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const lastMarker = new THREE.Mesh(new THREE.RingGeometry(PIECE_R + 0.06, PIECE_R + 0.16, 28), lastMat);
    lastMarker.rotation.x = -Math.PI / 2; lastMarker.position.y = GRID_Y + 0.004;
    lastMarker.visible = false; lastMarker.raycast = () => {};
    this.lastMarker = lastMarker; this._lastMarkerMat = lastMat;
    group.add(lastMarker);

    // effects system
    this.fx = new Effects({
      THREE, scene: this.scene, camera: this.camera, controls: this.controls,
      renderer: this.renderer, boardGroup: this.boardGroup, lights: this.lights,
      cellToWorld: (r, c, y) => this.cellToWorld(r, c, y), surfaceY: SURFACE_Y,
      colors: COLORS, sound: this.sound, invalidate: () => this.invalidate(),
    });
  }

  // Render each skill's REAL in-game 3D prop (same geometry + materials the
  // effects use) to a small transparent PNG, used as the card + tutorial icon.
  // Runs once at startup with a throwaway offscreen renderer.
  _makeSkillIcons() {
    this.skillIconURL = {};
    let r;
    try {
      const SIZE = 112;
      r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setSize(SIZE, SIZE); r.setPixelRatio(1);
      r.setClearColor(0x000000, 0);
      r.shadowMap.enabled = false;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfff0d6, 0x3a1c12, 0.8));
      const dir = new THREE.DirectionalLight(0xffe0b0, 1.25); dir.position.set(4, 7, 6); scene.add(dir);
      const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

      const T = THREE, C = COLORS;
      const stone = (side) => new T.Mesh(this.pieceGeo, (side === PLAYER ? this.matBlack : this.matWhite).clone());
      const mat = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: o.r ?? 0.55, metalness: o.m ?? 0.1, transparent: !!o.t, opacity: o.o ?? 1, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, side: o.side ?? T.FrontSide });

      // each builder returns { group, cam:[x,y,z], target:[x,y,z] }
      const builders = {
        yeet: () => {
          const g = new T.Group();
          const s = stone(AI); g.add(s);
          const beam = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 2.6, 10), mat(C.red, { t: true, o: 0.8, e: C.red, ei: 0.6 }));
          beam.position.y = 1.7; g.add(beam);
          return { group: g, cam: [1.7, 1.7, 2.7], target: [0, 0.7, 0] };
        },
        finders: () => {
          const g = new T.Group();
          g.add(stone(AI));
          const cone = new T.Mesh(new T.ConeGeometry(0.95, 2.0, 16, 1, true), mat(C.gold, { t: true, o: 0.4, e: C.gold, ei: 0.4, side: T.DoubleSide }));
          cone.position.y = 1.35; g.add(cone);
          return { group: g, cam: [1.9, 1.5, 2.7], target: [0, 0.6, 0] };
        },
        spring: () => {
          // the actual low-poly broom: wood handle + gold head
          const g = new T.Group();
          const handle = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 3.0, 8), mat(C.wood, { r: 0.8 }));
          const head = new T.Mesh(new T.BoxGeometry(1.5, 0.55, 0.85), mat(C.gold, { r: 0.65 }));
          head.position.set(0, -1.5, 0); g.add(handle, head);
          g.rotation.z = 0.5;
          return { group: g, cam: [0, 0, 4.4], target: [0, 0, 0] };
        },
        zero: () => {
          const g = new T.Group();
          const cm = mat(0x9fd8ff, { t: true, o: 0.82, r: 0.2, e: 0x224466, ei: 0.6 });
          const specs = [[-0.7, 0.9, 5], [0.7, 1.3, 6], [0, 1.7, 7]];
          for (const [x, h, seg] of specs) { const c = new T.Mesh(new T.ConeGeometry(0.42, h, seg), cm.clone()); c.position.set(x, h / 2 - 0.4, 0); g.add(c); }
          return { group: g, cam: [0.3, 0.9, 3.2], target: [0, 0.4, 0] };
        },
        ctrlz: () => {
          const g = new T.Group();
          const s = stone(AI); s.material.transparent = true; s.material.opacity = 0.55; s.position.y = 0.5; g.add(s);
          const ring = new T.Mesh(new T.RingGeometry(0.5, 0.66, 24), mat(C.gold, { t: true, o: 0.9, e: C.gold, ei: 0.5, side: T.DoubleSide }));
          ring.rotation.x = -Math.PI / 2; ring.position.y = -0.2; g.add(ring);
          return { group: g, cam: [1.6, 1.4, 2.6], target: [0, 0.3, 0] };
        },
        corporate: () => {
          const g = new T.Group();
          const b = stone(PLAYER); b.position.x = -0.55; const w = stone(AI); w.position.x = 0.55; g.add(b, w);
          const am = mat(C.gold, { r: 0.4, m: 0.5, e: 0x442200, ei: 0.6 });
          const a1 = new T.Mesh(new T.ConeGeometry(0.28, 0.8, 4), am.clone()); a1.rotation.z = -Math.PI / 2; a1.position.set(0.2, 0.9, 0); g.add(a1);
          const a2 = new T.Mesh(new T.ConeGeometry(0.28, 0.8, 4), am.clone()); a2.rotation.z = Math.PI / 2; a2.position.set(-0.2, -0.9, 0); g.add(a2);
          return { group: g, cam: [0, 0.3, 3.4], target: [0, 0, 0] };
        },
        flip: () => {
          const g = new T.Group();
          const board = new T.Mesh(new RoundedBoxGeometry(3.0, 0.45, 3.0, 2, 0.14), mat(C.wood, { r: 0.85 }));
          board.rotation.set(-0.55, 0.4, 0.25); g.add(board);
          const s1 = stone(PLAYER); s1.position.set(-0.6, 1.4, 0.2); const s2 = stone(AI); s2.position.set(0.7, 1.9, -0.3);
          g.add(s1, s2);
          return { group: g, cam: [0, 1.1, 4.6], target: [0, 0.3, 0] };
        },
      };

      for (const id of Object.keys(builders)) {
        const { group, cam: cp, target } = builders[id]();
        scene.add(group);
        cam.position.set(cp[0], cp[1], cp[2]);
        cam.lookAt(new T.Vector3(target[0], target[1], target[2]));
        r.render(scene, cam);
        this.skillIconURL[id] = r.domElement.toDataURL('image/png');
        scene.remove(group);
        group.traverse((o) => { if (o.geometry && o.geometry !== this.pieceGeo) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
      }
      dir.dispose && dir.dispose();
    } catch (e) {
      this.skillIconURL = {};   // fall back to SVG icons if WebGL capture fails
    } finally {
      if (r) r.dispose();
    }
  }

  // Single source of truth for board <-> world. Used by the grid, star points,
  // hover ghost, click targets, piece placement, and skill effects.
  cellToWorld(r, c, y = REST_Y) {
    return new THREE.Vector3((c - HALF) * SPACING, y, (r - HALF) * SPACING);
  }
  boardToWorld(row, col, y = REST_Y) { return this.cellToWorld(row, col, y); }
  worldToCell(point) {
    const c = Math.round(point.x / SPACING + HALF);
    const r = Math.round(point.z / SPACING + HALF);
    return { r, c };
  }

  // ---- input ----------------------------------------------------------------
  _initInput() {
    const dom = this.renderer.domElement;
    this._down = null; this._moved = 0; this._placing = false; this._dragging = false;
    const THRESH = 6; // px — movement above this counts as a camera drag, not a click

    dom.addEventListener('pointerdown', (e) => {
      this._placing = (e.button === 0);   // only left button can place/select
      this._down = { x: e.clientX, y: e.clientY };
      this._moved = 0; this._dragging = false;
    });
    dom.addEventListener('pointermove', (e) => {
      if (this._down) {
        this._moved = Math.max(this._moved, Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y));
        if (this._moved >= THRESH) this._dragging = true;   // freeze hover while orbiting
      }
      this._updateHover(e);
    });
    dom.addEventListener('pointerup', (e) => {
      const wasClick = this._placing && this._moved < THRESH;   // a drag never places
      this._down = null; this._placing = false; this._dragging = false;
      if (wasClick) this._onBoardClick(e);
    });
    dom.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this._setGhostVisible(false);
    });
    // right-drag pans; don't let the browser context menu interrupt it
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    // Escape cancels targeting
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pendingSkill) this._cancelTargeting();
    });
  }

  _ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  _updateHover(e) {
    if (this._hidden || document.hidden) return;
    const now = e.timeStamp || performance.now();
    if (this._lastHoverEventAt && now - this._lastHoverEventAt < 16) return;
    this._lastHoverEventAt = now;
    // show the ghost only when the player can actually place a piece
    if (this.inputLocked || this.pendingSkill || this._dragging ||
        this.game.phase !== 'place' || !this.isHumanControlled(this.game.current) ||
        this.game.placedThisTurn || this.game.isOver()) {
      this._setGhostVisible(false); this.hoverCell = null; return;
    }
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) { this._setGhostVisible(false); this.hoverCell = null; return; }
    const { r, c } = this.worldToCell(hit);
    if (this.game.isEmpty(r, c)) {
      this._setGhostVisible(true, r, c);
      this.hoverCell = { r, c };
    } else {
      this._setGhostVisible(false); this.hoverCell = null;
    }
  }

  _setGhostVisible(visible, r = null, c = null) {
    if (!this.ghost) return;
    let changed = this.ghost.visible !== visible;
    if (visible && r !== null && c !== null) {
      const w = this.boardToWorld(r, c, 0);
      if (this.ghost.position.x !== w.x || this.ghost.position.z !== w.z) changed = true;
      this.ghost.position.set(w.x, 0, w.z);   // ghost children carry their own Y offsets
    }
    this.ghost.visible = visible;
    if (changed) {
      if (visible) this._startDecorativePulse();
      else this.invalidate();
    }
  }

  _onBoardClick(e) {
    if (this.inputLocked) return;
    const ndc = this._ndc(e);
    this.raycaster.setFromCamera(ndc, this.camera);

    // targeting mode: pick an enemy piece (opponent of the ACTIVE side)
    if (this.pendingSkill) {
      const foe = opp(this.game.current);
      const hits = this.raycaster.intersectObjects([...this.pieces.values()], false);
      const enemy = hits.find((h) => h.object.userData.side === foe);
      if (enemy) this._useTargetedSkill(this.pendingSkill, enemy.object.userData);
      return;
    }

    // normal placement — only the active human side may place
    if (!this.isHumanControlled(this.game.current) || this.game.phase !== 'place' || this.game.placedThisTurn) return;
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return;
    const { r, c } = this.worldToCell(hit);
    if (!this.game.isEmpty(r, c)) return;
    this._playerPlace(r, c);
  }

  // ---- UI wiring ------------------------------------------------------------
  _initUI() {
    this.ui = new UI({
      onShowModes: () => { this.sound.play('click'); this.ui.showScreen('mode'); },
      onSplashStart: () => { this.sound.play('click'); this._onSplashStart(); },
      onModeAI: () => { this.sound.play('click'); this.ui.showScreen('difficulty'); },
      onModeLocal: () => { this.sound.play('click'); this._chooseCharactersThen('local'); },
      onBackModes: () => { this.sound.play('click'); this.ui.showScreen('mode'); },
      onShowHowto: () => { this.sound.play('click'); this._runOrientation(); },
      onBackMenu: () => { this.sound.play('click'); this.ui.showScreen('menu'); },
      onBackMenu: () => { this.sound.play('click'); this.ui.showScreen('menu'); },
      onChooseDifficulty: (d) => { this.sound.play('click'); this._chooseCharactersThen('ai', d); },
      onSkill: (id) => this._onSkillClicked(id),
      onCancelTarget: () => this._cancelTargeting(),
      onEndTurn: () => this._endActiveTurn(),
      onResetCamera: () => this._resetCamera(),
      onRestart: () => this._restartMatch(),
      onMainMenu: () => this._toMenu(),
      onToggleSound: () => { this.sound.setOn(!this.sound.on); this.ui.setSoundButton(this.sound.on); },
      onVolume: (v) => this.sound.setVolume(v),
      onToggleReduced: () => { this._setReduced(!this.reduced); },
      onToggleHandoff: () => { this._handoffOn = !this._handoffOn; this._persistHandoff(); this.ui.setHandoffButton(this._handoffOn); },
      onTutNext: () => this._tutNext(),
      onTutBack: () => this._tutBack(),
      onTutSkip: () => this._tutExit(true),
    });
    this.ui.setDebug(DEBUG);
    this._buildCharacterSelect();
    document.body.classList.toggle('reduced-motion', this.reduced);
  }

  // ---- character selection (UI/application state; never game-rule state) ----
  _safeStorage() {
    try { return window.localStorage; } catch (e) {
      return { getItem() { return null; }, setItem() {}, removeItem() {} };
    }
  }
  _buildCharacterSelect() {
    const $ = (id) => document.getElementById(id);
    this.charSelect = new CharacterSelect(
      {
        gridP1: $('char-grid-p1'), gridP2: $('char-grid-p2'), sideP2: $('char-side-p2'),
        opponent: $('char-opponent'), oppAvatar: $('char-opp-avatar'), oppName: $('char-opp-name'),
        dupWrap: $('char-dup-wrap'), allowDup: $('char-allow-dup'), live: $('char-live'),
        confirm: $('btn-char-confirm'), back: $('btn-char-back'),
        p1Title: $('char-p1-title'), p2Title: $('char-p2-title'),
      },
      {
        storage: this._safeStorage(),
        onBack: () => { this.sound.play('click'); this.ui.showScreen(this._pendingMode === 'local' ? 'mode' : 'difficulty'); },
        onConfirm: (sel) => { this.sound.play('click'); this.selection = sel; this._beginSelectedMatch(); },
      },
    );
  }
  _chooseCharactersThen(mode, difficulty) {
    this._pendingMode = mode;
    this._pendingDifficulty = difficulty || 'medium';
    if (this.charSelect) this.charSelect.open(mode);
    this.ui.showScreen('character');
  }
  _beginSelectedMatch() {
    if (this._pendingMode === 'local') this._startLocalMatch();
    else this._startMatch(this._pendingDifficulty);
  }
  _applyAvatars() {
    const sel = this.selection;
    if (!sel) { this.ui.clearAvatars(); return; }
    const p1 = getCharacter(sel.playerOneCharacterId);
    this.ui.setAvatar('player', p1 ? p1.avatar : null, p1 ? p1.name : null);
    if (p1) this.ui.setIdentity('player', p1.name);
    if (this.mode === 'local') {
      const p2 = getCharacter(sel.playerTwoCharacterId);
      this.ui.setAvatar('ai', p2 ? p2.avatar : null, p2 ? p2.name : null);
      if (p2) this.ui.setIdentity('ai', p2.name);
    } else {
      this.ui.setAvatar('ai', NPC_AVATARS.ai, NPC_CHARACTERS.ai.name);
      this.ui.setIdentity('ai', NPC_CHARACTERS.ai.name);
    }
  }
  _winnerAvatar(winner) {
    const sel = this.selection || {};
    if (this.mode === 'local') {
      const c = getCharacter(winner === PLAYER ? sel.playerOneCharacterId : sel.playerTwoCharacterId);
      return c ? [c.avatar, c.name] : [null, null];
    }
    if (winner === PLAYER) {
      const c = getCharacter(sel.playerOneCharacterId);
      return c ? [c.avatar, c.name] : [null, null];
    }
    return [NPC_AVATARS.ai, NPC_CHARACTERS.ai.name];
  }

  // ---- match lifecycle ------------------------------------------------------
  _clearResultTimer() {
    this._resultTimer.clear();
  }

  _beginMatchLifecycle() {
    this._clearResultTimer();
    this._matchGen++;
  }

  _startMatch(difficulty) {
    this._beginMatchLifecycle();
    this.mode = 'ai'; this._persistMode();
    this._cancelAI();
    this.ui.setMode('ai');
    this._applyAvatars();
    this.fx.clearAll();
    this._clearPieces();
    this.game.reset(difficulty);
    this.pendingSkill = null;
    this._clearHighlights();
    this._hideLastMarker();
    this._setGhostVisible(false);
    this.ui.hideResult();
    this.ui.hideHandoff();
    this.ui.showTargeting(false);
    this.ui.showScreen('game');
    this._onResize();
    this.game.startTurn(PLAYER, true); // first turn: no cooldown tick
    this.inputLocked = false;
    this._resetCamera(true);
    this._refreshUI();
    this.ui.toast('You are BLACK. Five in a row. Physics optional.');
  }

  // ---- opening orientation (splash + HOW TO PLAY) ---------------------------
  // The splash 'press any key' launches this the first time; HOW TO PLAY always
  // replays it. It is a self-contained cinematic (no real match, dummy demo
  // pieces) that flows into the skill-lesson slides, then back to the menu.
  _onSplashStart() {
    if (this.intro.isDone()) { this.ui.showScreen('menu'); return; }
    this._runOrientation();
  }
  _runOrientation() {
    this._beginMatchLifecycle();
    this._cancelAI();
    this.mode = 'ai'; this.ui.setMode('ai');
    this.fx.clearAll();
    this._clearPieces();
    this.cleanupDummies();
    this.game.reset('medium');                 // a neutral board purely for visuals
    this.game.startTurn(PLAYER, true);
    this.pendingSkill = null; this._clearHighlights();
    this._hideLastMarker();
    this._setGhostVisible(false);
    this.ui.hideResult(); this.ui.hideHandoff(); this.ui.showTargeting(false);
    this.ui.showScreen('game');
    this._onResize();
    document.body.classList.add('intro');      // hide the normal HUD
    this.inputLocked = true;
    this._resetCamera(true);
    this.intro.run({
      reduced: this.reduced,
      onComplete: () => this._afterOrientation(),
    });
  }
  _afterOrientation() {
    document.body.classList.remove('intro');
    this.cleanupDummies();
    this.fx.clearAll();
    this._clearPieces();
    this.boardGroup.rotation.set(0, 0, 0);
    this.controls.enabled = true;
    // flow straight into the skill-lesson slides (NEXT / BACK / SKIP)
    this._startTutorial();
  }

  // bridge object handed to IntroSequence (keeps the intro free of game rules)
  _introCtx() {
    return {
      THREE,
      camera: this.camera,
      controls: this.controls,
      CAMERA_PRESET,
      fx: this.fx,
      sound: this.sound,
      ui: this.ui,
      boardGroup: this.boardGroup,
      starDots: this._starDots,
      boardToWorld: (r, c, y) => this.boardToWorld(r, c, y),
      setControlsEnabled: (b) => { this.controls.enabled = b; },
      pulseCenters: () => { for (const [r, c] of [[7, 7], [6, 8], [8, 6]]) this.fx.pulseIntersection(this.boardToWorld(r, c)); },
      spawnDummy: (r, c, side) => this._spawnDummy(r, c, side),
      removeMesh: (m) => this._removeDummy(m),
      cleanupDummies: () => this.cleanupDummies(),
    };
  }

  // a throwaway stone for intro previews; never registered in `this.pieces`
  _spawnDummy(r, c, side) {
    const m = this._makePiece(side);
    m.position.copy(this.cellToWorld(r, c));
    m.userData = { r, c, side, dummy: true };
    this.boardGroup.add(m);
    this._introDummies.push(m);
    this.invalidateShadows();
    return m;
  }
  _removeDummy(m) {
    if (!m) return;
    this.boardGroup.remove(m);
    if (m.material) m.material.dispose();
    this._introDummies = this._introDummies.filter((x) => x !== m);
    this.invalidateShadows();
  }
  cleanupDummies() { for (const m of [...this._introDummies]) this._removeDummy(m); this._introDummies = []; }

  // LOCAL 2 PLAYERS: identical turn engine, both sides human, no AI.
  _startLocalMatch() {
    this._beginMatchLifecycle();
    this.mode = 'local'; this._persistMode();
    this._cancelAI();
    this.ui.setMode('local');
    this._applyAvatars();
    this.fx.clearAll();
    this._clearPieces();
    this.game.reset('medium');   // difficulty is irrelevant with no AI
    this.pendingSkill = null;
    this._clearHighlights();
    this._hideLastMarker();
    this._setGhostVisible(false);
    this.ui.hideResult();
    this.ui.hideHandoff();
    this.ui.showTargeting(false);
    this.ui.showScreen('game');
    this._onResize();
    this.game.startTurn(PLAYER, true);   // Player One (black) moves first
    this.inputLocked = false;
    this._resetCamera(true);
    this._refreshUI();
    this._localOpening();
  }

  // short, skippable system intro for local mode (no AI dialogue)
  _localOpening() {
    this.ui.toast('SYSTEM: A second organic participant has been detected. Resource sharing is mandatory.');
    clearTimeout(this._openTimer);
    this._openTimer = setTimeout(() => {
      this._openTimer = null;
      if (this.mode === 'local' && !this.game.isOver())
        this.ui.toast('Please determine who controls the mouse. The Department accepts no responsibility.');
    }, 2600);
  }

  _restartMatch() {
    if (this.mode === 'local') this._startLocalMatch();
    else this._startMatch(this.game.difficulty);
  }

  // invalidate any pending/in-flight AI turn + handoff timers
  _cancelAI() {
    this._aiGen++;
    this.aiDepth = 0;
    clearTimeout(this._handoffTimer);
    clearTimeout(this._openTimer);
    this._handoffTimer = null;
    this._openTimer = null;
  }

  _toMenu() {
    this.inputLocked = true;
    this._clearResultTimer();
    this._matchGen++;
    this._cancelAI();
    if (this.intro) { this.intro.onComplete = null; this.intro.skip(); }  // abort intro, no side effects
    document.body.classList.remove('intro');
    this.cleanupDummies();
    this.fx.clearAll();
    this._clearPieces();
    this.ui.hideHandoff();
    this.ui.showTutorial(false);
    this.ui.showScreen('menu');
  }

  // ---- centralized turn advancement ----------------------------------------
  // Called after a side's turn ends; decides who acts next based on controller.
  _finishTurn(side) {
    this.game.endTurn(side);     // switches current to the opponent
    this._advanceTurn();
  }
  _advanceTurn() {
    this._refreshUI();
    if (this.game.isOver()) { this.inputLocked = false; return; }
    const cur = this.game.current;
    if (this.getPlayerControllerType(cur) === 'ai') { this._runAITurn(); return; }
    // next side is human
    if (this.mode === 'local' && this._handoffOn) {
      this.inputLocked = true;
      this.ui.playHandoff(this.getPlayerDisplayName(opp(cur)), this.getPlayerDisplayName(cur), {
        reduced: this.reduced,
        done: () => { this.inputLocked = false; this._refreshUI(); },
      });
    } else {
      this.inputLocked = false;
      this._refreshUI();
    }
  }

  // ---- interactive tutorial -------------------------------------------------
  // Reuses the real 3D board + Effects to DEMONSTRATE each skill, with a
  // typewriter explanation + typing sound. No gameplay/AI/turn logic runs here.
  _startTutorial() {
    this.fx.clearAll();
    this._clearPieces();
    this._clearHighlights();
    this.pendingSkill = null;
    this.ui.hideResult();
    this.ui.showTargeting(false);
    this.ui.showScreen('game');
    this._onResize();
    this._resetCamera(true);
    this.inputLocked = true;          // board placement disabled during tutorial
    this._tut = true;
    this._tutBusy = false;
    this._tutStep = 0;
    this._tutSteps = this._buildTutorialSteps();
    this.ui.showTutorial(true);
    this.ui.setTutorialDots(this._tutSteps.length, 0);
    this._tutShow(0);
  }

  _exitTutorialState() {
    this._tut = false;
    this._tutBusy = false;
    this.ui.showTutorial(false);
    this.fx.clearAll();
    this._clearPieces();
    this.boardGroup.rotation.set(0, 0, 0);
    this.boardGroup.position.set(0, 0, 0);
    this.invalidateShadows();
  }
  _tutExit(toMenu) {
    this.sound.play('click');
    this._exitTutorialState();
    if (toMenu) this.ui.showScreen('menu');
    else this.ui.showScreen('difficulty');   // "PLAY" -> pick difficulty
  }

  _tutNext() {
    if (!this._tut) return;
    this.sound.play('click');
    if (this.ui.isTyping()) { this.ui.finishTyping(); return; }   // reveal full text (triggers demo)
    if (this._tutBusy) return;                                    // a demo animation is playing
    const last = this._tutSteps.length - 1;
    if (this._tutStep >= last) { this._tutExit(false); return; }
    this._tutStep++;
    this._tutShow(this._tutStep);
  }

  _tutBack() {
    if (!this._tut) return;
    if (this._tutStep <= 0) return;
    this.sound.play('click');
    this.ui.stopTyping();
    this._tutBusy = false;
    this._tutStep--;
    this._tutShow(this._tutStep);
  }

  _tutShow(i) {
    const step = this._tutSteps[i];
    this._tutBusy = false;
    this.fx.clearWinVisuals();
    this.boardGroup.rotation.set(0, 0, 0);
    this.boardGroup.position.set(0, 0, 0);
    this._clearPieces();
    this.invalidateShadows();
    this.ui.setTutorialHead(step.icon, step.title);
    this.ui.setTutorialDots(this._tutSteps.length, i);
    this.ui.setTutBack(i > 0);
    this.ui.setTutNextLabel(i === this._tutSteps.length - 1 ? 'PLAY ▶' : 'NEXT ▶');
    this.ui.typewriter(step.text, {
      speed: this.reduced ? 6 : 24,
      onTick: () => this.sound.play('type'),
      onDone: () => this._tutDemo(i),
    });
  }

  async _tutDemo(i) {
    const step = this._tutSteps[i];
    if (!step.demo || !this._tut) return;
    this._tutBusy = true;
    try { await step.demo(); } catch (e) { /* keep tutorial alive */ }
    this._tutBusy = false;
  }

  // place a demo stone immediately (no drop) and return its mesh
  _tutStone(r, c, side) { const m = this._addPieceMesh(r, c, side); m.position.copy(this.boardToWorld(r, c)); return m; }

  _buildTutorialSteps() {
    const S = (id) => SKILL_BY_ID[id];
    const W = (r, c) => this.boardToWorld(r, c);
    return [
      {
        icon: '🎯', title: 'THE GOAL',
        text: "Connect FIVE of your black discs in a row — flat, upright, or diagonal — before Professor Beep-Boop does. You are black, and you move first.",
        demo: async () => {
          const cells = [[7, 5], [7, 6], [7, 7], [7, 8], [7, 9]];
          for (const [r, c] of cells) { const m = this._addPieceMesh(r, c, PLAYER); await this.fx.dropPiece(m, W(r, c)); }
          await this.fx.winLine(W(7, 5), W(7, 9));
          await this.fx.delay(700);
        },
      },
      {
        icon: '🖱️', title: 'CAMERA & PLACING',
        text: "Left-drag orbits the camera, the wheel zooms, right-drag pans. Tap an empty crossing to drop a stone — dragging only moves the camera, so you never misfire after spinning the board.",
        demo: async () => { const m = this._addPieceMesh(7, 7, PLAYER); await this.fx.dropPiece(m, W(7, 7)); await this.fx.delay(300); },
      },
      {
        icon: this.ui.skillIcon('yeet'), title: 'YEET METEOR  (cd 5)',
        text: "Target one enemy disc and launch it into low orbit. It is gone for good. Great for breaking an enemy line.",
        demo: async () => { const m = this._tutStone(7, 7, AI); await this.fx.delay(250); await this.fx.yeetMeteor(m); this._removePieceMesh(7, 7); },
      },
      {
        icon: this.ui.skillIcon('finders'), title: 'FINDERS KEEPERS  (cd 4)',
        text: "Grab one enemy disc with a tractor beam and relocate it to a random empty square. Due process not included.",
        demo: async () => { const m = this._tutStone(7, 5, AI); await this.fx.delay(250); await this.fx.findersKeepers(m, W(8, 10)); },
      },
      {
        icon: this.ui.skillIcon('spring'), title: 'SPRING CLEANING  (cd 7)',
        text: "A giant broom sweeps 1 to 3 random enemy discs clean off the board. They looked dusty anyway.",
        demo: async () => {
          const cs = [[6, 6], [7, 7], [8, 8]]; const ms = cs.map(([r, c]) => this._tutStone(r, c, AI));
          await this.fx.delay(250); await this.fx.springClean(ms);
          for (const [r, c] of cs) this._removePieceMesh(r, c);
        },
      },
      {
        icon: this.ui.skillIcon('zero'), title: 'ABSOLUTE ZERO  (cd 5)',
        text: "Freeze the opponent's skill system for their next turn. They can still place a disc — they just can't fight back with chaos.",
        demo: async () => { this._tutStone(6, 4, AI); this._tutStone(8, 9, AI); await this.fx.delay(200); await this.fx.absoluteZero(W(7, 7)); },
      },
      {
        icon: this.ui.skillIcon('ctrlz'), title: 'CTRL + Z  (once)',
        text: "Rewind the opponent's entire last turn. Their move rises off the board and vanishes. Nothing happened. Legally.",
        demo: async () => { const m = this._tutStone(7, 7, AI); await this.fx.delay(300); await this.fx.ctrlzRewind(m); this._removePieceMesh(7, 7); },
      },
      {
        icon: this.ui.skillIcon('corporate'), title: 'CORPORATE RESTRUCTURING  (once)',
        text: "Swap the colour of EVERY disc on the board at once. Your stones become theirs and theirs become yours. Synergy achieved.",
        demo: async () => {
          const cs = [[6, 6, PLAYER], [6, 8, PLAYER], [8, 6, AI], [8, 8, AI]];
          const ms = cs.map(([r, c, s]) => this._tutStone(r, c, s));
          await this.fx.delay(250);
          await this.fx.corporate(ms, () => {
            for (const m of ms) {
              const u = m.userData; u.side = (u.side === PLAYER ? AI : PLAYER);
              if (m.material) m.material.dispose();
              m.material = (u.side === PLAYER ? this.matBlack : this.matWhite).clone();
            }
          });
          this.ui.flashStockChart();
          await this.fx.delay(300);
        },
      },
      {
        icon: this.ui.skillIcon('flip'), title: 'TABLE FLIP  (once)',
        text: "Resolve the situation through furniture violence: the board flips, every disc flies off, and the whole grid is wiped. Then the opponent moves.",
        demo: async () => {
          const cs = [[6, 6], [6, 8], [7, 7], [8, 6], [8, 8]];
          const ms = cs.map(([r, c], k) => this._tutStone(r, c, k % 2 ? AI : PLAYER));
          await this.fx.delay(250); await this.fx.tableFlip(ms); this._clearPieces();
        },
      },
      {
        icon: '🏆', title: 'YOU ARE READY',
        text: "Each turn: place one disc, then optionally fire ONE skill. Most skills end your turn and go on cooldown. Now go outsmart a glowing rectangle.",
        demo: null,
      },
    ];
  }

  _clearPieces() {
    for (const m of this.pieces.values()) { this.boardGroup.remove(m); if (m.material) m.material.dispose(); }
    this.pieces.clear();
    this._hideLastMarker();
    this.invalidateShadows();
  }

  // place the gold "latest move" ring around a stone (never covers its color)
  _setLastMoveMarker(r, c) {
    const w = this.boardToWorld(r, c, GRID_Y + 0.004);
    const changed = !this.lastMarker.visible ||
      this.lastMarker.position.x !== w.x || this.lastMarker.position.z !== w.z;
    this.lastMarker.position.set(w.x, w.y, w.z);
    this.lastMarker.visible = true;
    if (changed) this._startDecorativePulse();
  }
  _hideLastMarker() {
    if (this.lastMarker && this.lastMarker.visible) {
      this.lastMarker.visible = false;
      this.invalidate();
    }
  }

  // ---- piece helpers --------------------------------------------------------
  _makePiece(side) {
    const mat = (side === PLAYER ? this.matBlack : this.matWhite).clone();
    const m = new THREE.Mesh(this.pieceGeo, mat);
    m.castShadow = true;
    return m;
  }
  _addPieceMesh(r, c, side) {
    const m = this._makePiece(side);
    const w = this.cellToWorld(r, c);
    m.position.copy(w);
    m.userData = { r, c, side };
    this.boardGroup.add(m);
    this.pieces.set(r + ',' + c, m);
    this.invalidateShadows();
    return m;
  }
  _removePieceMesh(r, c) {
    const key = r + ',' + c;
    const m = this.pieces.get(key);
    if (m) {
      this.boardGroup.remove(m);
      if (m.material) m.material.dispose();
      this.pieces.delete(key);
      this.invalidateShadows();
    }
    return m;
  }
  _syncPiecesFromState() {
    // rebuild meshes to exactly match the authoritative board (used after CTRL+Z)
    this._clearPieces();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = this.game.board[r][c];
      if (v) this._addPieceMesh(r, c, v);
    }
    if (this.game.lastMove) this._setLastMoveMarker(this.game.lastMove.r, this.game.lastMove.c);
    else this._hideLastMarker();
  }

  // ---- player placement -----------------------------------------------------
  // Routed through the unified action entry: applyAction validates + mutates the
  // engine and returns events; main.js only animates those events.
  async _playerPlace(r, c) {
    const res = applyAction(this.game, place(r, c));
    if (!res.ok) {
      // illegal placement: R5 — no popup, only subtle feedback
      if (this.a11y) this.a11y.flashInvalid(r, c);
      this._a11yAnnounce(res.error ? res.error.message : 'That move is not allowed.');
      return;
    }
    this.inputLocked = true;
    this._setGhostVisible(false);
    this.ui.setStatus('PLACING PIECE', 'Please remain professionally still', 'anim');
    for (const ev of res.events) {
      if (ev.type === 'place') {
        const mesh = this._addPieceMesh(ev.r, ev.c, ev.side);
        await this.fx.dropPiece(mesh, this.cellToWorld(ev.r, ev.c));
        this._setLastMoveMarker(ev.r, ev.c);
        this.fx.floatingText(pick(PLACE_TEXTS), this.cellToWorld(ev.r, ev.c), { color: '#f6e7c8', size: 3.0 });
        if (this.mode === 'ai' && Math.random() < 0.22) this.ui.comedyPopup();
      } else if (ev.type === 'win') {
        await this._endGame(ev.side, ev.line);
        return;
      } else if (ev.type === 'autoFlip') {
        await this._autoFlip();
      }
    }
    this.inputLocked = false;
    this._refreshUI();
  }

  _endActiveTurn() {
    if (this.inputLocked || !this.game.placedThisTurn || this.pendingSkill) return;
    if (!this.isHumanControlled(this.game.current)) return;
    this.sound.play('click');
    this._finishTurn(this.game.current);
  }

  // ---- skills ---------------------------------------------------------------
  _onSkillClicked(id) {
    if (this.inputLocked) return;
    const side = this.game.current;
    if (!this.isHumanControlled(side)) return;
    if (!this.game.canUseSkillNow(side) || !this.game.skillReady(side, id)) return;
    if (id === 'ctrlz' && !this.game.canUndo(side)) return;
    this.sound.play('click');

    const def = SKILL_BY_ID[id];
    if (def.targeted) {
      this.pendingSkill = id;
      this._highlightEnemies();
      this.ui.showTargeting(true);
      const foeColor = this._sideColorWord(opp(side));   // 'black' | 'white'
      if (this.mode === 'local') {
        this.ui.setStatus('TARGETING FOR ' + this.getPlayerDisplayName(side),
          'Select one ' + foeColor + ' piece', 'target');
      } else {
        this.ui.setStatus('SELECT A TARGET', 'Tap one highlighted enemy piece', 'target');
      }
      this._refreshUI();
    } else {
      this._useInstantSkill(id);
    }
  }

  _cancelTargeting() {
    if (!this.pendingSkill) return;
    this.pendingSkill = null;
    this._clearHighlights();
    this.ui.showTargeting(false);
    this._refreshUI();
  }

  async _useTargetedSkill(id, victim) {
    this.pendingSkill = null;
    this._clearHighlights();
    this.ui.showTargeting(false);
    this.inputLocked = true;
    this.ui.setStatus('ANIMATION IN PROGRESS', 'Please remain professionally still', 'anim');
    await this._executeSkill(this.game.current, id, [victim.r, victim.c]);
  }

  async _useInstantSkill(id) {
    this.inputLocked = true;
    this.ui.setStatus('ANIMATION IN PROGRESS', 'Please remain professionally still', 'anim');
    await this._executeSkill(this.game.current, id, null);
  }

  // ---- skill execution (shared by player + AI) ------------------------------
  // Runs the 3D effect, then commits authoritative state, then resolves turn
  // flow. Returns when fully settled.
  async _executeSkill(side, id, target) {
    const o = opp(side);

    if (id === 'yeet') {
      const [r, c] = target;
      const mesh = this.pieces.get(r + ',' + c);
      if (mesh) await this.fx.yeetMeteor(mesh);
      this.game.removeAt(r, c); this._removePieceMesh(r, c);
      this.game.markSkillUsed(side, id);

    } else if (id === 'finders') {
      const [r, c] = target;
      const mesh = this.pieces.get(r + ',' + c);
      const empties = this.game.emptyCells().filter(([er, ec]) => !(er === r && ec === c));
      const dest = empties.length ? pick(empties) : [r, c];
      // commit logical move first (authoritative), animate the mesh to match
      this.game.removeAt(r, c);
      this.game.placePiece(dest[0], dest[1], o);
      if (mesh) {
        this.pieces.delete(r + ',' + c);
        mesh.userData = { r: dest[0], c: dest[1], side: o };
        this.pieces.set(dest[0] + ',' + dest[1], mesh);
        await this.fx.findersKeepers(mesh, this.cellToWorld(dest[0], dest[1]));
      }
      this.game.markSkillUsed(side, id);

    } else if (id === 'spring') {
      const enemies = this.game.piecesOf(o);
      const n = Math.min(enemies.length, 1 + ((Math.random() * 3) | 0));
      const chosen = [...enemies].sort(() => Math.random() - 0.5).slice(0, n);
      const meshes = chosen.map(([r, c]) => this.pieces.get(r + ',' + c)).filter(Boolean);
      await this.fx.springClean(meshes);
      for (const [r, c] of chosen) { this.game.removeAt(r, c); this._removePieceMesh(r, c); }
      this.fx.floatingText(pick(['HYGIENE ACHIEVED', 'YOUR PIECES FAILED INSPECTION', 'CLEAN BOARD, DIRTY TACTICS']),
        this.cellToWorld(7, 7), { color: '#ffd36b', size: 4.4 });
      this.game.markSkillUsed(side, id);

    } else if (id === 'zero') {
      const center = this.cellToWorld(o === AI ? 3 : 11, 7);  // mist the victim's half
      await this.fx.absoluteZero(center);
      this.game.freezeSkills(o);
      this.ui.setFrozen(o, true);
      this.game.markSkillUsed(side, id);

    } else if (id === 'ctrlz') {
      const last = this.game.lastMove;
      const lastMesh = last ? this.pieces.get(last.r + ',' + last.c) : null;
      await this.fx.ctrlzRewind(lastMesh);
      this.game.undoLastOpponentTurn(side);   // restores state + re-grants `side` a turn
      this._syncPiecesFromState();
      this.ui.setFrozen(PLAYER, this.game.frozen[PLAYER]);
      this.ui.setFrozen(AI, this.game.frozen[AI]);
      // CTRL+Z keeps the turn with `side`
      this.inputLocked = false;
      this._refreshUI();
      if (this.getPlayerControllerType(side) === 'ai') { this.aiDepth++; if (this.aiDepth < 4) return this._runAITurn(); }
      return;

    } else if (id === 'corporate') {
      const meshes = [...this.pieces.values()];
      await this.fx.corporate(meshes, () => {
        // recolor at the apex of the animation
        this.game.swapAllColors();
        for (const m of meshes) {
          const u = m.userData; u.side = (u.side === PLAYER ? AI : PLAYER);
          m.material.color.set(u.side === PLAYER ? COLORS.black : COLORS.white);
          m.material.roughness = u.side === PLAYER ? 0.22 : 0.32;
        }
        this.invalidate();
      });
      this.ui.flashStockChart();
      this.game.markSkillUsed(side, id);
      const res = this.game.resolveAfterSkill(side, 'corporate');
      if (res) { await this._endGame(res.winner, res.line); return; }

    } else if (id === 'flip') {
      const meshes = [...this.pieces.values()];
      this.controls.enabled = false;            // disable camera input during flip
      await this.fx.tableFlip(meshes);
      this.controls.enabled = true;
      this.game.clearBoard(); this._clearPieces();
      this.game.markSkillUsed(side, id);
    }

    // a non-corporate skill may also create/break a five (e.g. spring/yeet)
    if (id !== 'corporate') {
      const res = this.game.resolveAfterSkill(side, id);
      if (res) { await this._endGame(res.winner, res.line); return; }
    }

    // standard skills end the user's turn; _finishTurn decides who acts next
    this._finishTurn(side);
  }

  // ---- targeting highlight --------------------------------------------------
  // Glow valid enemy targets; dim everything else; remember exact originals so
  // _clearHighlights can restore emissive / opacity / transparent precisely.
  _highlightEnemies() {
    this._clearHighlights();
    const foe = opp(this.game.current);
    for (const m of this.pieces.values()) {
      const mat = m.material;
      const orig = { emissive: mat.emissive.getHex(), emissiveIntensity: mat.emissiveIntensity, opacity: mat.opacity, transparent: mat.transparent };
      if (m.userData.side === foe) {
        mat.emissive.set(COLORS.red);
        m.userData._glow = true;
        this.highlighted.push(m);
      } else {
        mat.transparent = true; mat.opacity = 0.32;   // dim unrelated (own) pieces
      }
      m.userData._orig = orig;
      this._touched.push(m);
    }
    this._startDecorativePulse();
    this.invalidate();
  }
  _clearHighlights() {
    for (const m of (this._touched || [])) {
      const o = m.userData._orig;
      if (o && m.material) {
        m.material.emissive.setHex(o.emissive);
        m.material.emissiveIntensity = o.emissiveIntensity;
        m.material.opacity = o.opacity;
        m.material.transparent = o.transparent;
      }
      m.userData._glow = false; m.userData._orig = null;
    }
    this._touched = [];
    this.highlighted = [];
    this.invalidate();
  }

  // ---- AI turn --------------------------------------------------------------
  async _runAITurn() {
    if (!this.shouldRunAI() || this.game.isOver()) return;
    const gen = this._aiGen;                 // capture; bail if anything cancels us
    const alive = () => gen === this._aiGen && this.shouldRunAI() && !this.game.isOver();
    this.inputLocked = true;
    this.aiDepth = this.aiDepth || 0;
    const diff = this.game.difficulty;
    this.ui.setActiveSide(AI);
    const think = pick(THINK_MSGS);
    this.ui.setStatus('PROFESSOR BEEP-BOOP IS THINKING', think, 'ai');
    this.ui.setThinking(true, think);
    this.ui.updatePanels(this.game, { aiStatus: think, mode: this.mode });

    const [minDelay, maxDelay] = (DIFFS[diff] && DIFFS[diff].delay) || [500, 1200];
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    await this.fx.delay(delay);
    if (!alive()) { this.ui.setThinking(false); return; }   // mode switched / restarted
    this.ui.setThinking(false);

    // place a stone
    const mv = chooseMove(this.game, diff);
    this.lastAI = mv;
    this.game.placePiece(mv.r, mv.c, AI);
    this.game.placedThisTurn = true;
    const mesh = this._addPieceMesh(mv.r, mv.c, AI);
    await this.fx.dropPiece(mesh, this.cellToWorld(mv.r, mv.c));
    if (!alive()) return;
    this._setLastMoveMarker(mv.r, mv.c);
    if (Math.random() < 0.5) this.ui.aiSay(pick(AI_DIALOGUE[diff] || AI_DIALOGUE.medium));

    const five = this.game.findFive(AI);
    if (five) { await this._endGame(AI, five); return; }
    if (this.game.isFull()) { await this._autoFlip(); }  // full board, no five -> auto table-flip, keep playing

    // optionally use a skill
    const skill = chooseSkill(this.game, diff);
    if (skill) {
      await this.fx.delay(260);
      if (!alive()) return;
      await this._executeSkill(AI, skill.id, skill.target || null);
      return; // _executeSkill handles end-of-turn / chaining
    }

    this.aiDepth = 0;
    this._finishTurn(AI);   // -> player's turn (centralized)
  }

  // ---- end game -------------------------------------------------------------
  // System auto-flip: when the board fills with no winner, clear it and keep
  // playing (there is no draw). This is NOT a player's TABLE FLIP skill and
  // consumes nobody's once-per-game flip; it only reuses the visual.
  async _autoFlip() {
    this.fx.floatingText('STALEMATE? UNACCEPTABLE.', this.cellToWorld(7, 7), { color: '#e2b04a', size: 4.0 });
    this.controls.enabled = false;
    await this.fx.tableFlip([...this.pieces.values()]);
    this.controls.enabled = true;
    this.game.clearBoard(); this._clearPieces();
  }

  async _endGame(winner, line) {
    this._clearResultTimer();
    this.inputLocked = true;
    this._cancelAI();
    this.ui.hideHandoff();
    this.pendingSkill = null; this._clearHighlights(); this.ui.showTargeting(false);
    if (winner === PLAYER || winner === AI) this.game.setWinner(winner, line);
    else this.game.setDraw();

    if (line && line.length >= 2) {
      const a = this.cellToWorld(line[0][0], line[0][1]);
      const b = this.cellToWorld(line[line.length - 1][0], line[line.length - 1][1]);
      this._tweenTarget(a.clone().add(b).multiplyScalar(0.5), 1100);
      await this.fx.winLine(a, b);
    }
    // in PvAI a player loss is a downer beep; in local both winners are human
    if (this.mode === 'ai' && winner === AI) this.sound.play('loss'); else this.sound.play('win');
    this._refreshUI();
    this.ui.setStatus('GAME OVER', 'The board has reached a legally binding conclusion', 'over');
    this.ui.setResultAvatar(...this._winnerAvatar(this.game.winner));
    const matchGen = this._matchGen;
    const resultWinner = this.game.winner;
    const resultMode = this.mode;
    this._resultTimer.schedule({
      delay: 700,
      isCurrent: () => matchGen === this._matchGen && this.game.isOver() &&
        this.game.winner === resultWinner && this.mode === resultMode,
      onShow: () => {
        this.ui.showResult(resultWinner, resultMode);
        this.invalidate();
      },
    });
    this.inputLocked = false;   // allow free camera rotation after the result
    this.invalidate();
  }

  _tweenTarget(toVec, duration) {
    const from = this.controls.target.clone();
    this.fx.tween({
      duration,
      onUpdate: (p) => { this.controls.target.lerpVectors(from, toVec, p); },
    });
  }

  // ---- camera ---------------------------------------------------------------
  _resetCamera(instant = false) {
    const P = CAMERA_PRESET;
    if (instant) {
      this._camToken++;                       // cancel any in-flight reset
      this.camera.position.copy(P.position);
      this.controls.target.copy(P.target);
      this.controls.update();
      this.invalidate();
      return;
    }
    const myToken = ++this._camToken;          // a newer click invalidates this one
    const fromP = this.camera.position.clone();
    const fromT = this.controls.target.clone();
    const dur = this.reduced ? 220 : 700;
    this.fx.tween({
      duration: dur,
      onUpdate: (p) => {
        if (this._camToken !== myToken) return; // a later reset took over; bail
        this.camera.position.lerpVectors(fromP, P.position, p);
        this.controls.target.lerpVectors(fromT, P.target, p);
      },
    });
  }

  // ---- per-frame UI refresh -------------------------------------------------
  // ---- accessibility wiring -------------------------------------------------
  // Build the accessible board mirror and route keyboard activation through the
  // SAME placement / targeting paths the pointer uses. Defensive: any failure
  // leaves pointer play fully working.
  _initA11y() {
    const host = document.getElementById('board-a11y');
    if (!host) return;
    try {
      this.a11y = new A11yBoard({
        host,
        n: N,
        getCell: (r, c) => this.game.board[r][c],
        getMode: () => {
          if (this.pendingSkill) return 'target';
          const cur = this.game.current;
          if (!this.game.isOver() && !this.inputLocked && this.isHumanControlled(cur) &&
              this.game.phase === 'place' && !this.game.placedThisTurn) return 'place';
          return 'idle';
        },
        onActivate: (r, c) => this._a11yActivate(r, c),
        onCancel: () => { if (this.pendingSkill) this._cancelTargeting(); },
        onFocusCell: (r, c) => this._a11yFocusCell(r, c),
      });
    } catch (e) {
      this.a11y = null; // pointer play still works
    }
  }

  _a11yAnnounce(msg) {
    const live = document.getElementById('a11y-live');
    if (live) live.textContent = msg;
  }

  // Keyboard/SR activation = the same actions as a pointer click.
  _a11yActivate(r, c) {
    if (this.inputLocked) { if (this.a11y) this.a11y.flashInvalid(r, c); return; }
    if (this.pendingSkill) {
      const foe = opp(this.game.current);
      if (this.game.board[r][c] === foe) {
        this._useTargetedSkill(this.pendingSkill, { r, c, side: foe });
      } else {
        if (this.a11y) this.a11y.flashInvalid(r, c);
        this._a11yAnnounce('Pick an enemy piece to target.');
      }
      return;
    }
    const cur = this.game.current;
    if (this.isHumanControlled(cur) && this.game.phase === 'place' &&
        !this.game.placedThisTurn && this.game.isEmpty(r, c)) {
      this._playerPlace(r, c);
    } else {
      if (this.a11y) this.a11y.flashInvalid(r, c);
      if (!this.game.isEmpty(r, c)) this._a11yAnnounce('That intersection is taken.');
      else if (this.game.placedThisTurn) this._a11yAnnounce('Already placed — choose a skill or end your turn.');
      else this._a11yAnnounce('Not your turn yet.');
    }
  }

  // Move the 3D ghost to the focused cell so sighted keyboard users get a cue.
  _a11yFocusCell(r, c) {
    if (!this.ghost) return;
    const placing = !this.pendingSkill && !this.inputLocked &&
      this.isHumanControlled(this.game.current) && this.game.phase === 'place' &&
      !this.game.placedThisTurn && this.game.isEmpty(r, c);
    if (placing) {
      this._setGhostVisible(true, r, c);
    } else this._setGhostVisible(false);
  }

  _refreshUI() {
    const g = this.game;
    if (this.a11y) { try { this.a11y.refresh(); } catch (e) { /* a11y is non-fatal */ } }
    const traySide = this._traySide();
    this.ui.renderSkills(g, { selecting: this.pendingSkill, side: traySide });
    this.ui.setActiveSide(g.current);
    this.ui.setFrozen(AI, g.frozen[AI]);
    this.ui.setFrozen(PLAYER, g.frozen[PLAYER]);
    this.ui.updatePanels(g, { mode: this.mode });
    this._setGhostSide(g.current);

    // keep the latest-move ring on the authoritative last move (if still on board)
    const lm = g.lastMove;
    if (lm && g.board[lm.r] && g.board[lm.r][lm.c]) this._setLastMoveMarker(lm.r, lm.c);
    else this._hideLastMarker();

    if (g.isOver()) { this.ui.setEndTurn('GAME OVER', false); return; }
    if (this.pendingSkill) { this.ui.setEndTurn('CANCEL TO GO BACK', false); return; }

    const cur = g.current;
    const human = this.isHumanControlled(cur);
    if (human) {
      const who = this.mode === 'local' ? this.getPlayerDisplayName(cur) + "'S TURN" : 'YOUR TURN';
      const colorWord = this._sideColorWord(cur);   // 'black' | 'white'
      if (!g.placedThisTurn) {
        this.ui.setStatus(who, 'Place a ' + colorWord + ' piece on an empty intersection', 'place');
        this.ui.setEndTurn('PLACE A PIECE', false);
      } else {
        this.ui.setStatus(who, 'Choose a skill or end your turn', 'skill');
        this.ui.setEndTurn('CONFIRM', !this.inputLocked);
      }
    } else {
      this.ui.setEndTurn('WAITING FOR AI', false);
    }
  }

  // tint the hover ghost to match the active side's stone colour
  _setGhostSide(side) {
    if (!this._ghostMat) return;
    if (side === PLAYER) { this._ghostMat.color.set(0x2a2230); this._ghostMat.emissive.set(COLORS.gold); this._ghostMat.emissiveIntensity = 0.25; }
    else { this._ghostMat.color.set(COLORS.white); this._ghostMat.emissive.set(0x6a6a6a); this._ghostMat.emissiveIntensity = 0.15; }
    this.invalidate();
  }

  // ---- demand-driven rendering ---------------------------------------------
  _frame({ time, dt, requested }) {
    const hadEffects = this.fx.activeCount > 0;
    const effectsActive = this.fx.update(dt);
    const controlsActive = this._controlsInteracting || time < this._controlsActiveUntil;
    if (controlsActive) this.controls.update();

    let pulseActive = this._pulseUntil > time &&
      ((this.highlighted && this.highlighted.length) ||
       (this.ghost && this.ghost.visible) ||
       (this.lastMarker && this.lastMarker.visible));
    let pulseSettled = false;
    if (pulseActive) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
      if (this.highlighted.length) {
        const k = 0.5 + 0.5 * Math.sin(time * 0.008);
        for (const m of this.highlighted) m.material.emissiveIntensity = 0.3 + k * 0.7;
      }
      if (this.ghost.visible && this._ghostRingMat) this._ghostRingMat.opacity = 0.35 + pulse * 0.5;
      if (this.lastMarker.visible && this._lastMarkerMat) this._lastMarkerMat.opacity = 0.55 + pulse * 0.4;
    } else if (this._pulseUntil) {
      this._pulseUntil = 0;
      pulseSettled = true;
      for (const m of this.highlighted) m.material.emissiveIntensity = 0.7;
      if (this._ghostRingMat) this._ghostRingMat.opacity = 0.6;
      if (this._lastMarkerMat) this._lastMarkerMat.opacity = 0.85;
    }

    if (hadEffects) this.renderer.shadowMap.needsUpdate = true;
    const visualChanged = requested || hadEffects || controlsActive || pulseActive || pulseSettled;

    if (DEBUG && visualChanged) {
      const now = performance.now();
      while (this.perf.renderTimes.length && now - this.perf.renderTimes[0] > 5000) this.perf.renderTimes.shift();
      const info = this.renderer.info;
      this.ui.debug([
        'phase: ' + this.game.phase,
        'current: ' + (this.game.current === PLAYER ? 'PLAYER' : 'AI'),
        'raf: ' + (this._renderScheduler && this._renderScheduler.rafId ? 'scheduled' : 'idle'),
        'renders/5s: ' + this.perf.renderTimes.length,
        'draw calls: ' + info.render.calls,
        'geometries: ' + info.memory.geometries + ' textures: ' + info.memory.textures,
        'hover: ' + (this.hoverCell ? this.hoverCell.r + ',' + this.hoverCell.c : '-'),
        'aiMove: ' + (this.lastAI ? this.lastAI.r + ',' + this.lastAI.c + ' (' + this.lastAI.why + ' ' + Math.round(this.lastAI.score) + ')' : '-'),
        'ai ms/nodes: ' + (this.lastAI ? (this.lastAI.aiMs || 0).toFixed(1) + 'ms / ' + (this.lastAI.nodes || 0) : '-'),
        'ai depth/cands: ' + (this.lastAI ? (this.lastAI.depth || 0) + ' / ' + (this.lastAI.candidates || 0) : '-'),
        'fx objects: ' + this.fx.activeCount,
        'timers: ' + this._activeTimerCount(),
        'inputLocked: ' + this.inputLocked,
      ]);
    }
    if (visualChanged) {
      this.renderer.render(this.scene, this.camera);
      if (DEBUG) {
        this.perf.renderTimes.push(performance.now());
      }
    }

    pulseActive = this._pulseUntil > time;
    return effectsActive || controlsActive || pulseActive;
  }

  _activeTimerCount() {
    let n = 0;
    if (this._handoffTimer) n++;
    if (this._openTimer) n++;
    if (this._resultTimer && this._resultTimer.id) n++;
    if (this.ui) {
      if (this.ui._toastTimer) n++;
      if (this.ui._sayTimer) n++;
      if (this.ui._hoT2) n++;
      if (this.ui._typer) n++;
    }
    if (this.intro && this.intro._timers) n += this.intro._timers.size;
    return n;
  }
}

window.addEventListener('DOMContentLoaded', () => { window.__game = new ChaosGomoku3D(); });
