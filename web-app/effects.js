// effects.js
// Reusable, Promise-based 3D effect system built on Three.js.
// Every effect: returns a Promise, resolves when done, cleans up all temporary
// meshes / lights / particles, and never leaks. main.js blocks input while a
// returned Promise is pending and only commits logical state at the right beat.

// ---- easing -----------------------------------------------------------------
const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
};

export class Effects {
  constructor(ctx) {
    this.THREE = ctx.THREE;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.controls = ctx.controls;
    this.renderer = ctx.renderer;
    this.boardGroup = ctx.boardGroup;
    this.lights = ctx.lights;             // { dir, hemi }
    this.cellToWorld = ctx.cellToWorld;   // (r,c) -> Vector3 at the stone resting height
    this.surfaceY = ctx.surfaceY;         // board top y
    this.colors = ctx.colors;             // palette hex map
    this.sound = ctx.sound;               // Sound instance (may be null)
    this.invalidate = ctx.invalidate || (() => {});
    this.reduced = false;                 // accessibility: set by main; tames shake/flash

    const T = this.THREE;
    this.tweens = [];
    this.particles = [];
    this.fxGroup = new T.Group();
    this.fxGroup.name = 'fxGroup';
    this.scene.add(this.fxGroup);

    // shared, reused geometry/material for cheap particles
    this._cube = new T.BoxGeometry(1, 1, 1);
    this._ring = new T.RingGeometry(0.34, 0.5, 20);
    this._shakeBase = null;  // saved camera offset target during shakes
  }

  get activeCount() { return this.tweens.length + this.particles.length + this.fxGroup.children.length; }

  // ---- core scheduling ------------------------------------------------------
  delay(ms) { return new Promise((res) => setTimeout(res, ms)); }

  // Generic tween. opts: { duration, ease, onUpdate(p, raw), onComplete }
  tween(opts) {
    return new Promise((resolve) => {
      this.tweens.push({
        elapsed: 0,
        duration: Math.max(1, opts.duration || 300),
        ease: opts.ease || Ease.outCubic,
        onUpdate: opts.onUpdate || (() => {}),
        onComplete: () => { if (opts.onComplete) opts.onComplete(); resolve(); },
      });
      this.invalidate();
    });
  }

  // advance everything; dt in milliseconds
  update(dt) {
    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.elapsed += dt;
      const raw = Math.min(1, tw.elapsed / tw.duration);
      tw.onUpdate(tw.ease(raw), raw);
      if (raw >= 1) { this.tweens.splice(i, 1); tw.onComplete(); }
    }
    // particles (physics)
    const ds = dt / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= ds;
      p.vel.y += p.gravity * ds;
      p.mesh.position.addScaledVector(p.vel, ds);
      p.mesh.rotation.x += p.spin.x * ds;
      p.mesh.rotation.y += p.spin.y * ds;
      p.mesh.rotation.z += p.spin.z * ds;
      const k = Math.max(0, p.life / p.maxLife);
      if (p.fade && p.mesh.material) { p.mesh.material.opacity = k; p.mesh.material.transparent = true; }
      if (p.shrink) p.mesh.scale.setScalar(Math.max(0.01, p.baseScale * k));
      if (p.life <= 0) {
        this.fxGroup.remove(p.mesh);
        if (p.mesh.material && p.mesh.material._temp) p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    return this.tweens.length > 0 || this.particles.length > 0;
  }

  // ---- low-level helpers ----------------------------------------------------
  _mat(color, opts = {}) {
    const m = new this.THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0.1,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
    });
    m._temp = true;
    return m;
  }

  // Spawn a burst of small spinning cubes.
  particleBurst(pos, color, count = 18, opts = {}) {
    const T = this.THREE;
    count = Math.min(count, 46);
    const spread = opts.spread ?? 3.2;
    const up = opts.up ?? 3.2;
    const size = opts.size ?? 0.22;
    const life = opts.life ?? 0.9;
    for (let i = 0; i < count; i++) {
      const mesh = new T.Mesh(this._cube, this._mat(color, { roughness: 0.5, transparent: true }));
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.9));
      mesh.position.copy(pos);
      mesh.castShadow = false;
      this.fxGroup.add(mesh);
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.particles.push({
        mesh,
        vel: new T.Vector3(Math.cos(a) * r, up * (0.5 + Math.random()), Math.sin(a) * r),
        spin: new T.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        gravity: opts.gravity ?? -9.5,
        life: life * (0.7 + Math.random() * 0.6), maxLife: life,
        fade: true, shrink: opts.shrink ?? true, baseScale: mesh.scale.x,
      });
    }
    this.invalidate();
  }

  // Flat expanding ring on the board surface (dust / pulse).
  dustRing(pos, color, opts = {}) {
    const T = this.THREE;
    const mat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: T.DoubleSide });
    mat._temp = true;
    const ring = new T.Mesh(this._ring, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, this.surfaceY + 0.02, pos.z);
    ring.scale.setScalar(0.3);
    this.fxGroup.add(ring);
    const max = opts.scale ?? 2.2, dur = opts.duration ?? 520;
    return this.tween({
      duration: dur, ease: Ease.outCubic,
      onUpdate: (p) => { ring.scale.setScalar(0.3 + p * max); mat.opacity = 0.85 * (1 - p); },
      onComplete: () => { this.fxGroup.remove(ring); mat.dispose(); },
    });
  }

  // Screen-space-ish floating text via a camera-facing sprite that rises & fades.
  floatingText(text, worldPos, opts = {}) {
    const T = this.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.font = '700 58px "Courier New", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(20,8,10,0.92)';
    g.strokeText(text, 256, 64);
    g.fillStyle = opts.color || '#f6e7c8';
    g.fillText(text, 256, 64);
    const tex = new T.CanvasTexture(canvas);
    tex.anisotropy = 2;
    const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new T.Sprite(mat);
    const s = opts.size ?? 3.4;
    sprite.scale.set(s, s * 0.25, 1);
    const start = worldPos.clone(); start.y += opts.lift ?? 1.4;
    sprite.position.copy(start);
    sprite.renderOrder = 999;
    this.fxGroup.add(sprite);
    const rise = opts.rise ?? 2.0, dur = opts.duration ?? 1150;
    return this.tween({
      duration: dur, ease: Ease.outCubic,
      onUpdate: (p) => { sprite.position.y = start.y + p * rise; mat.opacity = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85; },
      onComplete: () => { this.fxGroup.remove(sprite); mat.dispose(); tex.dispose(); },
    });
  }

  // Camera shake by jittering the controls target + camera over `duration`.
  cameraShake(intensity = 0.4, duration = 360) {
    if (this.reduced) { intensity *= 0.12; duration = Math.min(duration, 180); }  // accessibility
    const cam = this.camera, ctrl = this.controls;
    const baseCam = cam.position.clone();
    const baseTgt = ctrl ? ctrl.target.clone() : new this.THREE.Vector3();
    return this.tween({
      duration, ease: Ease.linear,
      onUpdate: (p) => {
        const k = intensity * (1 - p);
        const jx = (Math.random() - 0.5) * k, jy = (Math.random() - 0.5) * k, jz = (Math.random() - 0.5) * k;
        cam.position.set(baseCam.x + jx, baseCam.y + jy, baseCam.z + jz);
        if (ctrl) ctrl.target.set(baseTgt.x + jx * 0.5, baseTgt.y + jy * 0.5, baseTgt.z + jz * 0.5);
      },
      onComplete: () => { cam.position.copy(baseCam); if (ctrl) ctrl.target.copy(baseTgt); },
    });
  }

  boardFlash(color, duration = 260) {
    const T = this.THREE;
    const peak = this.reduced ? 2 : 6;   // reduce flashing for accessibility
    const light = new T.PointLight(color, 0, 60);
    light.position.set(0, this.surfaceY + 8, 0);
    this.fxGroup.add(light);
    return this.tween({
      duration, ease: Ease.outQuad,
      onUpdate: (p) => { light.intensity = (1 - p) * peak; },
      onComplete: () => { this.fxGroup.remove(light); },
    });
  }

  tempPointLight(pos, color, intensity = 5, life = 600) {
    const T = this.THREE;
    const light = new T.PointLight(color, 0, 40);
    light.position.copy(pos);
    this.fxGroup.add(light);
    return this.tween({
      duration: life, ease: Ease.outQuad,
      onUpdate: (p) => { light.intensity = Math.sin(Math.min(1, p) * Math.PI) * intensity; },
      onComplete: () => { this.fxGroup.remove(light); },
    });
  }

  // Move a mesh along a curved (arc) path to a target world position.
  moveArc(mesh, toWorld, height = 3, duration = 700, ease = Ease.inOutSine) {
    const from = mesh.position.clone();
    return this.tween({
      duration, ease,
      onUpdate: (p) => {
        mesh.position.x = from.x + (toWorld.x - from.x) * p;
        mesh.position.z = from.z + (toWorld.z - from.z) * p;
        mesh.position.y = from.y + (toWorld.y - from.y) * p + Math.sin(p * Math.PI) * height;
        mesh.rotation.y += 0.25;
      },
    });
  }

  // ---- piece placement ------------------------------------------------------
  // Drop an already-created mesh from above into its cell, squash + bounce,
  // dust ring, intersection pulse, soft wooden click.
  async dropPiece(mesh, worldPos) {
    const restY = worldPos.y;
    const startY = restY + 6;
    mesh.position.set(worldPos.x, startY, worldPos.z);
    mesh.scale.set(1, 1, 1);
    if (this.sound) this.sound.play('place');
    await this.tween({
      duration: 300, ease: Ease.inQuad,
      onUpdate: (p) => { mesh.position.y = startY + (restY - startY) * p; },
    });
    this.dustRing(worldPos, this.colors.dust, { scale: 1.6, duration: 460 });
    this.pulseIntersection(worldPos);
    // squash then spring
    await this.tween({
      duration: 130, ease: Ease.outQuad,
      onUpdate: (p) => { mesh.scale.set(1 + 0.35 * p, 1 - 0.45 * p, 1 + 0.35 * p); },
    });
    await this.tween({
      duration: 220, ease: Ease.outBack,
      onUpdate: (p) => { mesh.scale.set(1.35 - 0.35 * p, 0.55 + 0.45 * p, 1.35 - 0.35 * p); },
      onComplete: () => mesh.scale.set(1, 1, 1),
    });
  }

  pulseIntersection(worldPos) {
    const T = this.THREE;
    const mat = new T.MeshBasicMaterial({ color: this.colors.gold, transparent: true, opacity: 0.9 });
    mat._temp = true;
    const disc = new T.Mesh(new T.CircleGeometry(0.45, 22), mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(worldPos.x, this.surfaceY + 0.015, worldPos.z);
    this.fxGroup.add(disc);
    this.tween({
      duration: 420, ease: Ease.outCubic,
      onUpdate: (p) => { disc.scale.setScalar(0.5 + p * 1.7); mat.opacity = 0.9 * (1 - p); },
      onComplete: () => { this.fxGroup.remove(disc); disc.geometry.dispose(); mat.dispose(); },
    });
  }

  // Shrink + puff a piece out of existence. main removes the mesh after.
  async removePieceFx(mesh, color) {
    this.particleBurst(mesh.position.clone(), color ?? this.colors.dust, 14, { up: 2.4, spread: 2.0 });
    await this.tween({
      duration: 240, ease: Ease.inCubic,
      onUpdate: (p) => { mesh.scale.setScalar(1 - p); mesh.position.y += 0.02; },
    });
  }

  // ---- SKILL 1: YEET METEOR -------------------------------------------------
  async yeetMeteor(mesh) {
    const T = this.THREE;
    const p0 = mesh.position.clone();
    // red targeting beam from above
    const beamMat = new T.MeshBasicMaterial({ color: this.colors.red, transparent: true, opacity: 0.0, side: T.DoubleSide });
    beamMat._temp = true;
    const beam = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 14, 10, 1, true), beamMat);
    beam.position.set(p0.x, p0.y + 7, p0.z);
    this.fxGroup.add(beam);
    this.tempPointLight(new T.Vector3(p0.x, p0.y + 1, p0.z), this.colors.red, 5, 700);
    await this.tween({ duration: 260, ease: Ease.outQuad, onUpdate: (p) => { beamMat.opacity = 0.7 * p; } });
    // shake the doomed piece
    await this.tween({
      duration: 360, ease: Ease.linear,
      onUpdate: () => { mesh.position.x = p0.x + (Math.random() - 0.5) * 0.18; mesh.position.z = p0.z + (Math.random() - 0.5) * 0.18; },
      onComplete: () => mesh.position.copy(p0),
    });
    if (this.sound) this.sound.play('charge');
    // launch upward, spinning, with a pixelated smoke trail
    let trailT = 0;
    await this.tween({
      duration: 620, ease: Ease.inExpo,
      onUpdate: (p, raw) => {
        mesh.position.y = p0.y + p * 26;
        mesh.rotation.x += 0.6; mesh.rotation.z += 0.5;
        beamMat.opacity = 0.7 * (1 - raw);
        trailT += 1;
        if (trailT % 2 === 0) this.particleBurst(mesh.position.clone(), this.colors.smoke, 4, { up: 0.6, spread: 0.7, life: 0.7, gravity: -1.5, size: 0.28 });
      },
    });
    // explosion high above
    const boom = new T.Vector3(p0.x, p0.y + 26, p0.z);
    if (this.sound) this.sound.play('explosion');
    this.particleBurst(boom, this.colors.red, 30, { up: 5, spread: 6, life: 1.0, gravity: -6 });
    this.particleBurst(boom, this.colors.gold, 18, { up: 4, spread: 5, life: 1.0, gravity: -6 });
    this.tempPointLight(boom, this.colors.gold, 8, 600);
    this.fxGroup.remove(beam); beamMat.dispose();
    this.cameraShake(0.5, 420);
    this.floatingText('YEETED INTO THE STRATOSPHERE', this.cellToWorld(7, 7), { color: '#ff7a6b', size: 5.2, rise: 1.4 });
    await this.delay(220);
  }

  // ---- SKILL 2: FINDERS KEEPERS --------------------------------------------
  async findersKeepers(mesh, toWorld) {
    const T = this.THREE;
    // tractor beam cone
    const coneMat = new T.MeshBasicMaterial({ color: this.colors.gold, transparent: true, opacity: 0.0, side: T.DoubleSide });
    coneMat._temp = true;
    const cone = new T.Mesh(new T.ConeGeometry(1.1, 4, 14, 1, true), coneMat);
    const lift = mesh.position.clone(); lift.y += 4.4;
    cone.position.copy(lift);
    this.fxGroup.add(cone);
    if (this.sound) this.sound.play('charge');
    await this.tween({ duration: 260, onUpdate: (p) => { coneMat.opacity = 0.5 * p; } });
    // lift the piece straight up into the beam
    const baseY = mesh.position.y;
    await this.tween({
      duration: 320, ease: Ease.outCubic,
      onUpdate: (p) => { mesh.position.y = baseY + p * 3.0; mesh.rotation.y += 0.3; cone.position.y = mesh.position.y + 1.4; },
    });
    // carry it across the board along a curved path to the destination
    await this.moveArc(mesh, new T.Vector3(toWorld.x, toWorld.y + 0.2, toWorld.z), 4.2, 760);
    // drop + bounce
    await this.tween({
      duration: 180, ease: Ease.outBounce,
      onUpdate: (p) => { mesh.position.y = toWorld.y + (1 - p) * 0.8; },
      onComplete: () => { mesh.position.set(toWorld.x, toWorld.y, toWorld.z); },
    });
    this.dustRing(toWorld, this.colors.dust, { scale: 1.4 });
    if (this.sound) this.sound.play('place');
    this.fxGroup.remove(cone); coneMat.dispose();
    this.floatingText('RELOCATED FOR TAX PURPOSES', toWorld, { color: '#ffd36b', size: 4.6 });
    await this.delay(160);
  }

  // ---- SKILL 3: SPRING CLEANING --------------------------------------------
  async springClean(meshes) {
    const T = this.THREE;
    // giant low-poly broom: a handle + a head, sweeps across X
    const broom = new T.Group();
    const handleMat = this._mat(this.colors.wood, { roughness: 0.8 });
    const handle = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 9, 8), handleMat);
    handle.rotation.z = Math.PI * 0.18;
    const headMat = this._mat(this.colors.gold, { roughness: 0.7 });
    const head = new T.Mesh(new T.BoxGeometry(3.4, 0.7, 1.4), headMat);
    head.position.set(-3.6, -4.0, 0);
    broom.add(handle, head);
    broom.position.set(-13, this.surfaceY + 4, 0);
    broom.rotation.y = 0.0;
    this.fxGroup.add(broom);
    if (this.sound) this.sound.play('charge');

    const startX = -13, endX = 13;
    const swept = new Set();
    await this.tween({
      duration: 1100, ease: Ease.inOutSine,
      onUpdate: (p) => {
        const x = startX + (endX - startX) * p;
        broom.position.x = x;
        broom.rotation.z = Math.sin(p * Math.PI * 4) * 0.12;
        // when the broom head passes a target piece, fling it off
        for (const m of meshes) {
          if (swept.has(m)) continue;
          if (x > m.position.x - 1.2) {
            swept.add(m);
            const dir = Math.sign(m.position.x + 0.001) || 1;
            this._flingOff(m, dir);
            this.particleBurst(m.position.clone(), this.colors.dust, 12, { up: 2.2, spread: 2.4, size: 0.26 });
          }
        }
      },
    });
    // fling any stragglers
    for (const m of meshes) if (!swept.has(m)) this._flingOff(m, 1);
    await this.delay(420);
    this.fxGroup.remove(broom);
    handleMat.dispose(); headMat.dispose();
    handle.geometry.dispose(); head.geometry.dispose();
  }

  _flingOff(mesh, dir) {
    const T = this.THREE;
    const fromY = mesh.position.y;
    const targetX = mesh.position.x + dir * (8 + Math.random() * 4);
    const startX = mesh.position.x;
    this.tween({
      duration: 700, ease: Ease.inQuad,
      onUpdate: (p) => {
        mesh.position.x = startX + (targetX - startX) * p;
        mesh.position.y = fromY + Math.sin(p * Math.PI) * 3 - p * 3;
        mesh.rotation.x += 0.4; mesh.rotation.z += 0.5 * dir;
        if (mesh.material) { mesh.material.transparent = true; mesh.material.opacity = 1 - p; }
      },
    });
  }

  // ---- SKILL 4: ABSOLUTE ZERO ----------------------------------------------
  async absoluteZero(sideCenterWorld) {
    const T = this.THREE;
    if (this.sound) this.sound.play('ice');
    const crystals = [];
    const crystalMat = new T.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.0, roughness: 0.2, metalness: 0.1, emissive: 0x224466, emissiveIntensity: 0.6 });
    crystalMat._temp = true;
    for (let i = 0; i < 10; i++) {
      const c = new T.Mesh(new T.ConeGeometry(0.35 + Math.random() * 0.3, 1.0 + Math.random() * 1.4, 5), crystalMat);
      c.position.set(sideCenterWorld.x + (Math.random() - 0.5) * 12, this.surfaceY, sideCenterWorld.z + (Math.random() - 0.5) * 5);
      c.rotation.y = Math.random() * Math.PI;
      c.scale.setScalar(0.01);
      this.fxGroup.add(c); crystals.push(c);
    }
    this.tempPointLight(new T.Vector3(sideCenterWorld.x, this.surfaceY + 4, sideCenterWorld.z), 0x88ccff, 4, 1200);
    await this.tween({
      duration: 620, ease: Ease.outBack,
      onUpdate: (p) => { crystalMat.opacity = 0.8 * Math.min(1, p); crystals.forEach((c, i) => c.scale.setScalar(p * (0.7 + (i % 3) * 0.2))); },
    });
    // mist
    this.particleBurst(new T.Vector3(sideCenterWorld.x, this.surfaceY + 0.5, sideCenterWorld.z), 0xcfeaff, 24, { up: 1.2, spread: 6, life: 1.4, gravity: -0.6, size: 0.4, shrink: true });
    this.floatingText('BRAIN TEMPERATURE: -273\u00B0C', sideCenterWorld, { color: '#bfe6ff', size: 4.6 });
    await this.delay(700);
    await this.tween({
      duration: 460, ease: Ease.inQuad,
      onUpdate: (p) => { crystalMat.opacity = 0.8 * (1 - p); crystals.forEach((c) => c.scale.multiplyScalar(1 - p * 0.06)); },
      onComplete: () => { crystals.forEach((c) => { this.fxGroup.remove(c); c.geometry.dispose(); }); crystalMat.dispose(); },
    });
  }

  // ---- SKILL 5: CTRL + Z -----------------------------------------------------
  // Desaturate (dim) briefly, raise the last piece and vanish it, reversed bits.
  async ctrlzRewind(lastMesh) {
    const T = this.THREE;
    if (this.sound) this.sound.play('rewind');
    const dir = this.lights.dir, hemi = this.lights.hemi;
    const di = dir ? dir.intensity : 1, hi = hemi ? hemi.intensity : 1;
    await this.tween({
      duration: 240, ease: Ease.outQuad,
      onUpdate: (p) => { if (dir) dir.intensity = di * (1 - 0.7 * p); if (hemi) hemi.intensity = hi * (1 - 0.6 * p); },
    });
    if (lastMesh) {
      const p0 = lastMesh.position.clone();
      // reversed particles converge inward as it lifts and shrinks away
      this.particleBurst(p0.clone(), this.colors.cream, 16, { up: -1.5, spread: 2.5, gravity: 6, life: 0.7 });
      await this.tween({
        duration: 420, ease: Ease.inCubic,
        onUpdate: (p) => { lastMesh.position.y = p0.y + p * 2.4; lastMesh.scale.setScalar(1 - p); lastMesh.rotation.y -= 0.3; },
      });
    }
    this.floatingText('NOTHING HAPPENED. LEGALLY.', this.cellToWorld(7, 7), { color: '#cdbce0', size: 5.0 });
    await this.tween({
      duration: 320, ease: Ease.inQuad,
      onUpdate: (p) => { if (dir) dir.intensity = di * (0.3 + 0.7 * p); if (hemi) hemi.intensity = hi * (0.4 + 0.6 * p); },
      onComplete: () => { if (dir) dir.intensity = di; if (hemi) hemi.intensity = hi; },
    });
  }

  // ---- SKILL 6: CORPORATE RESTRUCTURING ------------------------------------
  // Raise all, spin, recolor at the apex (recolor() supplied by main), drop.
  async corporate(meshes, recolor) {
    const T = this.THREE;
    if (this.sound) this.sound.play('charge');
    // gold arrows ring
    const arrowGroup = new T.Group();
    const arrowMat = this._mat(this.colors.gold, { roughness: 0.4, metalness: 0.5, emissive: 0x442200, emissiveIntensity: 0.6 });
    for (let i = 0; i < 6; i++) {
      const a = new T.Mesh(new T.ConeGeometry(0.5, 1.4, 4), arrowMat);
      const ang = (i / 6) * Math.PI * 2;
      a.position.set(Math.cos(ang) * 9, this.surfaceY + 3, Math.sin(ang) * 9);
      a.rotation.z = Math.PI / 2; a.rotation.y = -ang;
      arrowGroup.add(a);
    }
    this.fxGroup.add(arrowGroup);
    const baseY = meshes.map((m) => m.position.y);
    // raise + spin
    await this.tween({
      duration: 460, ease: Ease.outCubic,
      onUpdate: (p) => {
        meshes.forEach((m, i) => { m.position.y = baseY[i] + p * 2.6; m.rotation.y += 0.25; });
        arrowGroup.rotation.y += 0.06;
      },
    });
    // recolor at the apex
    if (recolor) recolor();
    this.boardFlash(this.colors.gold);
    this.particleBurst(this.cellToWorld(7, 7), this.colors.gold, 26, { up: 4, spread: 8, life: 1.0 });
    await this.tween({
      duration: 240, ease: Ease.linear,
      onUpdate: () => { meshes.forEach((m) => { m.rotation.y += 0.4; }); arrowGroup.rotation.y += 0.1; },
    });
    // drop back
    await this.tween({
      duration: 420, ease: Ease.outBounce,
      onUpdate: (p) => { meshes.forEach((m, i) => { m.position.y = baseY[i] + 2.6 * (1 - p); }); },
      onComplete: () => { meshes.forEach((m, i) => { m.position.y = baseY[i]; m.rotation.set(0, 0, 0); }); },
    });
    this.floatingText('WELCOME TO THE MERGER', this.cellToWorld(7, 7), { color: '#ffd36b', size: 5.2 });
    this.fxGroup.remove(arrowGroup);
    arrowGroup.children.forEach((a) => a.geometry.dispose());
    arrowMat.dispose();
    await this.delay(160);
  }

  // ---- SKILL 7: TABLE FLIP --------------------------------------------------
  // Tilt the board violently, launch every piece on a random trajectory,
  // extreme shake + debris, slam back. main clears state after this resolves.
  async tableFlip(meshes) {
    const T = this.THREE;
    if (this.sound) this.sound.play('flip');
    this.cameraShake(1.1, 900);
    // launch pieces
    meshes.forEach((m) => {
      const p0 = m.position.clone();
      const vx = (Math.random() - 0.5) * 16, vz = (Math.random() - 0.5) * 16, vy = 8 + Math.random() * 8;
      this.tween({
        duration: 900, ease: Ease.linear,
        onUpdate: (p) => {
          const t = p * 0.9;
          m.position.x = p0.x + vx * t;
          m.position.z = p0.z + vz * t;
          m.position.y = p0.y + vy * t - 9.8 * t * t * 2.2;
          m.rotation.x += 0.5; m.rotation.y += 0.4; m.rotation.z += 0.6;
          if (m.material) { m.material.transparent = true; m.material.opacity = Math.max(0, 1 - p * 1.2); }
        },
      });
    });
    // tilt the whole board up then slam
    const bg = this.boardGroup;
    const baseRotX = bg.rotation.x;
    this.particleBurst(this.cellToWorld(7, 7), this.colors.wood, 40, { up: 6, spread: 9, life: 1.2, size: 0.3 });
    await this.tween({
      duration: 320, ease: Ease.outCubic,
      onUpdate: (p) => { bg.rotation.x = baseRotX - p * 0.5; bg.position.y = p * 1.2; },
    });
    await this.tween({
      duration: 260, ease: Ease.inCubic,
      onUpdate: (p) => { bg.rotation.x = baseRotX - (1 - p) * 0.5; bg.position.y = (1 - p) * 1.2; },
      onComplete: () => { bg.rotation.x = baseRotX; bg.position.y = 0; },
    });
    this.boardFlash(this.colors.wood, 220);
    this.cameraShake(0.6, 360);
    this.floatingText('(\u256F\u00B0\u25A1\u00B0)\u256F\uFE35 \u253B\u2501\u253B', this.cellToWorld(7, 7), { color: '#ff7a6b', size: 6.0 });
    await this.delay(260);
  }

  // ---- WIN presentation -----------------------------------------------------
  async winLine(worldA, worldB) {
    const T = this.THREE;
    const dirV = worldB.clone().sub(worldA);
    const len = dirV.length();
    const mid = worldA.clone().add(worldB).multiplyScalar(0.5);
    const mat = new T.MeshBasicMaterial({ color: this.colors.gold, transparent: true, opacity: 0.0 });
    mat._temp = true;
    const tube = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, len, 10), mat);
    tube.position.copy(mid); tube.position.y += 0.5;
    tube.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dirV.clone().normalize());
    this.fxGroup.add(tube);
    this.tempPointLight(mid.clone().setY(this.surfaceY + 3), this.colors.gold, 6, 1400);
    if (this.sound) this.sound.play('win');
    this.confetti(mid);
    await this.tween({
      duration: 700, ease: Ease.outCubic,
      onUpdate: (p) => { mat.opacity = 0.95 * Math.min(1, p * 1.4); tube.scale.y = p; },
    });
    // gentle persistent glow pulse handled by leaving the tube; main cleans on reset
    this._winTube = { tube, mat };
    return tube;
  }

  confetti(center) {
    const T = this.THREE;
    for (let i = 0; i < 40; i++) {
      const col = [this.colors.gold, this.colors.red, this.colors.cream][i % 3];
      const m = new T.Mesh(this._cube, this._mat(col, { roughness: 0.5, transparent: true }));
      m.scale.setScalar(0.18 + Math.random() * 0.18);
      m.position.set(center.x + (Math.random() - 0.5) * 4, this.surfaceY + 6 + Math.random() * 4, center.z + (Math.random() - 0.5) * 4);
      this.fxGroup.add(m);
      this.particles.push({
        mesh: m,
        vel: new T.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3),
        spin: new T.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
        gravity: -4.5, life: 2.2 + Math.random(), maxLife: 3.2, fade: true, shrink: false, baseScale: m.scale.x,
      });
    }
    this.invalidate();
  }

  // Remove any persistent win visuals.
  clearWinVisuals() {
    if (this._winTube) {
      this.fxGroup.remove(this._winTube.tube);
      this._winTube.tube.geometry.dispose();
      this._winTube.mat.dispose();
      this._winTube = null;
      this.invalidate();
    }
  }

  // Hard reset: drop all temporary objects (used on restart / menu).
  clearAll() {
    this.tweens.length = 0;
    for (const p of this.particles) { this.fxGroup.remove(p.mesh); if (p.mesh.material && p.mesh.material._temp) p.mesh.material.dispose(); }
    this.particles.length = 0;
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const c = this.fxGroup.children[i];
      this.fxGroup.remove(c);
      if (c.geometry && c.geometry.dispose && c.geometry !== this._cube && c.geometry !== this._ring) c.geometry.dispose();
      if (c.material && c.material._temp) c.material.dispose();
    }
    this.clearWinVisuals();
    this.invalidate();
  }
}
