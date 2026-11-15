// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The 3D stage: renders the diorama at a reduced internal resolution (about 400 px tall),
// runs the retro post-process, and the canvas is upscaled with crisp nearest-neighbor pixels.
// Tap or click a part of the base to fly the camera to it (a label shows its name); tap the ground or
// press Escape to fly back. Keyboard: number keys, or the "Look at" menu beside the view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Diorama, FOCUS_LABELS, LAUNCH_TIMELINE } from './diorama';
import { SNAP, makePostMaterial, makeSkyMaterial } from './retro';
import { POINT_SCALE } from './fx';
import { CameraMove, framePose, overviewPose, isTap, OVERVIEW_TARGET, OVERVIEW_POSITION, OVERVIEW_MIN_DISTANCE, FOCUS_MIN_DISTANCE } from './focus';
import type { Cosmetics, FocusKey, Stage, StageCue, StageScene } from './stage';

const TARGET_HEIGHT = 400;
const _tag = new THREE.Vector3();
const _look = new THREE.Vector3();
// The cold open's camera (reused every frame: nothing is allocated while it flies).
const _introSph = new THREE.Spherical();
const _introOff = new THREE.Vector3();
const INTRO_FROM_TARGET = new THREE.Vector3(0, 2.4, 0);
const introEase = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class ThreeStage implements Stage {
  private el?: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 400);
  private controls!: OrbitControls;
  private target!: THREE.WebGLRenderTarget;
  private post!: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sky!: THREE.ShaderMaterial;
  private diorama!: Diorama;
  private clock = new THREE.Clock();
  private raf = 0;
  private reduced = false;
  private dayT = 0.25;
  private flash = 0;
  private sceneInfo?: StageScene;
  /** The Hangar's looks, kept so they can be painted once the diorama exists. */
  private looks?: Cosmetics;
  private launching: { start: number; dur: number; resolve: () => void } | null = null;
  /** The cold open: a camera swoop from far out over the terrain to the opening view. */
  private intro: { t: number; dur: number; from: THREE.Spherical; to: THREE.Spherical } | null = null;
  private resizeObs?: ResizeObserver;
  private overlay = document.createElement('div');
  private countText = '';
  private cssW = 1;
  private cssH = 1;
  // Looking at one part of the base.
  private focused: FocusKey | null = null;
  private frame = { center: new THREE.Vector3(), radius: 1, top: 1 };
  private move = new CameraMove();
  private goalTarget = new THREE.Vector3();
  private goalSph = new THREE.Spherical();
  private tag = document.createElement('div');
  private tagName = document.createElement('b');
  private tagX = NaN;
  private tagY = NaN;
  private lookWrap = document.createElement('label');
  private look = document.createElement('select');
  private lookKeys = '';
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private multiTouch = false;
  private hoverAt = 0;
  /** Called if the GPU rejects our shaders, so the game can fall back to the simple stage. */
  onFail?: () => void;
  onPick?: (key: FocusKey | null) => void;

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  mount(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    // The Workshop's blueprint fills in from the bottom up (a clipping plane).
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.debug.onShaderError = () => {
      console.warn('3D shaders failed to compile; switching to the simple view.');
      this.onFail?.();
    };
    this.renderer.domElement.addEventListener('webglcontextlost', () => this.onFail?.());
    el.append(this.renderer.domElement);
    this.overlay.className = 'stage-overlay';
    el.append(this.overlay);
    this.tag.className = 'stage-tag';
    this.tag.hidden = true;
    const hint = document.createElement('span');
    hint.textContent = 'Tap the ground or press Esc to zoom out';
    this.tag.append(this.tagName, hint);
    el.append(this.tag);

    this.target = new THREE.WebGLRenderTarget(320, 180, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.post = makePostMaterial(this.target);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));

    this.sky = makeSkyMaterial();
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), this.sky);
    skyMesh.frustumCulled = false;
    this.scene.add(skyMesh);
    this.scene.fog = new THREE.Fog('#d9a066', 40, 150);

    this.diorama = new Diorama();
    this.scene.add(this.diorama.group);
    if (this.looks) this.diorama.setCosmetics(this.looks);

    this.camera.position.copy(OVERVIEW_POSITION);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(OVERVIEW_TARGET);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = OVERVIEW_MIN_DISTANCE;
    this.controls.maxDistance = 38;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 1.38;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.update();
    // Dragging during a camera move hands the camera back to the player.
    this.controls.addEventListener('start', this.onControlsStart);

    // Tap a module to look at it; the keyboard has number keys and the "Look at" menu.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointermove', this.onPointerMove);
    // Capture phase: runs before the game's own Escape handling, so Escape closes a dialog OR zooms out, not both.
    window.addEventListener('keydown', this.onKey, true);
    this.buildLookMenu(el);

    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(el);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.setTimeOfDay(this.dayT);
    this.loop();
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else {
      this.clock.getDelta();
      this.loop();
    }
  };

  private resize() {
    if (!this.el) return;
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.cssW = w;
    this.cssH = h;
    this.tagX = NaN;
    // Whole-number upscale keeps the pixels crisp and even.
    const scale = Math.max(1, Math.round(h / TARGET_HEIGHT));
    const iw = Math.max(64, Math.round(w / scale));
    const ih = Math.max(36, Math.round(h / scale));
    this.renderer.setSize(iw, ih, false);
    this.target.setSize(iw, ih);
    // Vertex wobble grid stays a little coarser than the pixels, for a gentle retro feel.
    SNAP.value.set(iw * 0.75, ih * 0.75);
    this.camera.aspect = w / h;
    // Narrow screens: pull back so the whole base fits.
    this.camera.fov = w / h < 1.1 ? 58 : 42;
    this.camera.updateProjectionMatrix();
    // Particle sizes are in scene units: convert to internal pixels at distance 1.
    POINT_SCALE.value = ih / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  setScene(scene: StageScene) {
    const siteChanged = (scene.site ?? 'mars') !== (this.sceneInfo?.site ?? 'mars') || (scene.landing ?? 'gale') !== (this.sceneInfo?.landing ?? 'gale');
    this.sceneInfo = scene;
    this.diorama?.setScene(scene);
    // A new world needs a new sky and new light right away.
    if (siteChanged && this.sky) this.setTimeOfDay(this.dayT);
    if (!this.diorama) return;
    this.refreshLookMenu();
    // Back to the whole base if the world changed or the part we were looking at is gone.
    if (this.focused && (siteChanged || !this.lookKeys.split(',').includes(this.focused))) this.focus(null, true);
  }

  setTimeOfDay(t: number) {
    this.dayT = t;
    if (!this.sky) return;
    this.diorama.setDayTime(t);
    // Sun travels east to west during the first half of the sol, then it's night.
    const day = t < 0.5;
    const a = (day ? t / 0.5 : 1) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(a) * 0.9, Math.sin(a) * 0.85 + (day ? 0.02 : -0.3), -0.35).normalize();
    const elev = Math.max(0, sunDir.y);
    const dusk = day ? Math.max(0, 1 - Math.min(t, 0.5 - t) / 0.07) : 0;
    const night = day ? 0 : Math.min(1, Math.min(t - 0.5, 1 - t) / 0.05);
    const u = this.sky.uniforms;
    const fog = this.scene.fog as THREE.Fog;
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    this.diorama.sunLight.position.copy(sunDir).multiplyScalar(40);
    this.diorama.setNight(night);

    if (this.sceneInfo?.site === 'moon') {
      // No air: a black sky with stars all day, a hard white Sun, no blue sunset, no haze or dust,
      // and only a little fill light, so shadows are dark and sharp.
      (u.uZenith.value as THREE.Color).set('#000000');
      (u.uHorizon.value as THREE.Color).set('#06060a');
      (u.uSunGlow.value as THREE.Color).set('#4a4a4a');
      u.uBlue.value = 0;
      u.uNight.value = night;
      u.uStars.value = 1;
      u.uSunDisc.value = day ? 1 : 0;
      fog.color.set('#000000');
      fog.near = 300;
      fog.far = 600;
      this.diorama.sunLight.intensity = day ? 0.9 + elev * 2.6 : 0;
      this.diorama.sunLight.color.set('#ffffff');
      this.diorama.ambient.intensity = 0.12 + (1 - night) * 0.28;
      this.diorama.ambient.color.set(night > 0.5 ? '#3a4766' : '#c9ccd6');
      this.post.uniforms.uDust.value = 0;
      return;
    }

    const dust = this.sceneInfo?.weather === 'storm' ? 0.65 : this.sceneInfo?.weather === 'dusty' ? 0.35 : 0;

    const zenithDay = new THREE.Color('#b98a5d');
    const horizonDay = new THREE.Color('#e9bd8c');
    const zenithNight = new THREE.Color('#0b0a18');
    const horizonNight = new THREE.Color('#1d1836');
    (u.uZenith.value as THREE.Color).copy(zenithDay).lerp(new THREE.Color('#3a3a5a'), dusk * 0.6).lerp(zenithNight, night);
    (u.uHorizon.value as THREE.Color).copy(horizonDay).lerp(new THREE.Color('#c28b6a'), dusk * 0.5).lerp(horizonNight, night);
    (u.uSunGlow.value as THREE.Color).set('#f6e7c8');
    u.uBlue.value = dusk;
    u.uNight.value = night;
    u.uStars.value = 0;
    u.uSunDisc.value = 0;

    fog.color.copy(u.uHorizon.value as THREE.Color).lerp(new THREE.Color('#c98a52'), dust);
    fog.near = 40 - dust * 34;
    fog.far = 150 - dust * 110;

    this.diorama.sunLight.intensity = day ? (0.4 + elev * 2.2) * (1 - dust * 0.6) : 0;
    this.diorama.sunLight.color.set(dusk > 0.3 ? '#9fb6e8' : '#fff1d6');
    this.diorama.ambient.intensity = 0.25 + (1 - night) * 0.85 * (1 - dust * 0.3);
    this.diorama.ambient.color.set(night > 0.5 ? '#4a4f7a' : '#f2d2a8');
    this.post.uniforms.uDust.value = dust * 0.45;
  }

  storm(intensity: number) {
    this.flash = this.reduced ? 0.15 : 0.55 * intensity;
    this.diorama.storm(intensity);
    if (!this.reduced && this.el) {
      this.el.animate?.(
        [{ transform: 'translate(0,0)' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(3px,-3px)' }, { transform: 'translate(0,0)' }],
        { duration: 320 },
      );
    }
  }

  cue(cue: StageCue) {
    this.diorama?.cue(cue);
  }

  /** Suit colors, rocket paint, the rover pet and base lights (painted right away, or once mounted). */
  setCosmetics(c: Cosmetics) {
    this.looks = c;
    this.diorama?.setCosmetics(c);
  }

  focusModule(key: FocusKey | null) {
    this.focus(key, false);
  }

  /** The cold open: swoop low over the terrain and around to the opening view (0 seconds, or reduced motion: cut there). */
  flyIn(seconds: number) {
    if (!this.controls || this.launching) return;
    if (this.focused) this.focus(null, true);
    this.move.active = false;
    const to = new THREE.Spherical().setFromVector3(_introOff.copy(OVERVIEW_POSITION).sub(OVERVIEW_TARGET));
    if (seconds <= 0 || this.reduced) {
      this.intro = null;
      this.controls.target.copy(OVERVIEW_TARGET);
      this.camera.position.copy(OVERVIEW_POSITION);
      this.camera.lookAt(OVERVIEW_TARGET);
      this.controls.autoRotate = !this.reduced;
      return;
    }
    // Long version: from far out and low, about two-thirds of the way around. Short version (return visits): a gentle dolly in.
    const long = seconds >= 3;
    const from = new THREE.Spherical(long ? 70 : to.radius * 1.35, long ? 1.42 : to.phi - 0.08, to.theta + (long ? 2.3 : 0.45));
    this.intro = { t: 0, dur: seconds, from, to };
    this.controls.autoRotate = false;
    this.stepIntro(0);
  }

  private stepIntro(dt: number) {
    const I = this.intro!;
    I.t = Math.min(1, I.t + dt / I.dur);
    const e = introEase(I.t);
    const a = I.from;
    const b = I.to;
    _introSph.set(a.radius + (b.radius - a.radius) * e, a.phi + (b.phi - a.phi) * e, a.theta + (b.theta - a.theta) * e);
    this.controls.target.lerpVectors(INTRO_FROM_TARGET, OVERVIEW_TARGET, e);
    this.camera.position.setFromSpherical(_introSph).add(this.controls.target);
    // Never under a hill (the real Gale Crater terrain rises away from the base).
    const ground = this.diorama.groundAt(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < ground + 2.5) this.camera.position.y = ground + 2.5;
    this.camera.lookAt(this.controls.target);
    if (I.t >= 1) {
      this.intro = null;
      this.controls.target.copy(OVERVIEW_TARGET);
      this.camera.position.copy(OVERVIEW_POSITION);
      this.controls.update();
      this.controls.autoRotate = !this.reduced;
    }
  }

  launch(): Promise<void> {
    return new Promise((resolve) => {
      // The cinematic takes the camera: let go of any module we were looking at.
      if (this.focused) this.focus(null, true);
      this.move.active = false;
      this.controls.minDistance = OVERVIEW_MIN_DISTANCE;
      this.controls.autoRotate = false;
      this.lookWrap.hidden = true;
      this.overlay.innerHTML = '';
      this.countText = '';
      this.launching = { start: performance.now(), dur: this.reduced ? 2600 : 8000, resolve };
    });
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    if (on && this.intro) this.flyIn(0);
    if (this.controls) this.controls.autoRotate = !on && !this.focused;
    this.el?.classList.toggle('reduced', on);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    this.diorama.tick(dt, time, this.reduced);

    if (this.launching) this.stepLaunch(dt);
    else if (this.intro) this.stepIntro(dt);
    else if (this.move.active) {
      this.move.step(dt, this.camera, this.controls.target);
      if (!this.move.active) this.arrived();
    } else this.controls.update();
    // Back in the orbit view (or zoomed out from a module by hand): the usual closest zoom again.
    if (!this.focused && this.controls.minDistance < OVERVIEW_MIN_DISTANCE && this.camera.position.distanceTo(this.controls.target) >= OVERVIEW_MIN_DISTANCE)
      this.controls.minDistance = OVERVIEW_MIN_DISTANCE;
    this.placeTag();

    // Radiation "snow" and flash fade out after a storm.
    this.flash = Math.max(0, this.flash - dt * 1.8);
    const p = this.post.uniforms;
    p.uFlash.value = this.flash;
    p.uSparkle.value = this.diorama.stormLevel * (this.sceneInfo?.sheltered ? 0.4 : 1);
    p.uTime.value = time;
    this.sky.uniforms.uTime.value = time;

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  };

  private stepLaunch(dt: number) {
    const L = this.launching!;
    const k = Math.min(1, (performance.now() - L.start) / L.dur);
    this.diorama.launchStep(k, dt);
    const rp = this.diorama.rocketPosition();
    // Camera follows the rocket up into the sky.
    this.controls.target.lerp(_look.set(rp.x, rp.y + 2, rp.z), 0.08);
    this.camera.position.lerp(_look.set(rp.x + 14, Math.max(6, rp.y * 0.6 + 5), rp.z + 16), 0.03);
    this.camera.lookAt(this.controls.target);
    const T = LAUNCH_TIMELINE;
    this.flash = Math.max(this.flash, k > T.ignite && k < T.ignite + 0.06 ? (this.reduced ? 0.08 : 0.3) : 0);
    // Countdown on screen, in step with the lights on the tower.
    if (k <= 0.55) {
      const txt = k < T.count[0] ? '' : k < T.count[1] ? '3' : k < T.count[2] ? '2' : k < T.ignite ? '1' : k < T.liftoff + 0.08 ? 'LIFTOFF!' : '';
      if (txt !== this.countText) {
        this.countText = txt;
        this.overlay.innerHTML = txt ? `<div class="launch-count">${txt}</div>` : '';
      }
    } else if (!this.overlay.innerHTML) {
      this.overlay.innerHTML = '<div class="launch-text"><span>ESCAPE VELOCITY REACHED</span><b>5.0 km/s</b></div>';
    }
    if (k >= 1) {
      const resolve = L.resolve;
      this.launching = null;
      window.setTimeout(() => {
        this.overlay.innerHTML = '';
        this.diorama.resetLaunch();
        this.controls.target.copy(OVERVIEW_TARGET);
        this.camera.position.copy(OVERVIEW_POSITION);
        this.controls.autoRotate = !this.reduced;
        this.lookWrap.hidden = false;
      }, 400);
      resolve();
    }
  }

  // ------------------------------------------------------------------ looking at one module

  /** Fly to a part of the base (null: back to the whole base). `fromPlayer` tells the game, so the dock can highlight it. */
  private focus(key: FocusKey | null, fromPlayer: boolean) {
    if (!this.diorama || this.launching) return;
    if (key && !this.diorama.focusFrame(key, this.frame)) key = null;
    if (!key && !this.focused) return;
    this.focused = key;
    if (key) {
      framePose(this.frame.center, this.frame.radius, this.camera, this.goalTarget, this.goalSph);
      this.controls.minDistance = FOCUS_MIN_DISTANCE;
      this.controls.autoRotate = false;
      this.tagName.textContent = FOCUS_LABELS[key];
      this.tag.hidden = false;
      this.tagX = NaN;
    } else {
      overviewPose(this.camera, this.goalTarget, this.goalSph);
      this.tag.hidden = true;
    }
    // Reduced motion: cut straight there instead of swinging.
    this.move.start(this.camera, this.controls.target, this.goalTarget, this.goalSph, this.reduced ? 0 : 1.1);
    this.look.value = key ?? '';
    if (fromPlayer) this.onPick?.(key);
  }

  private arrived() {
    if (!this.focused) this.controls.autoRotate = !this.reduced;
  }

  /** The floating name label sits just above the module. */
  private placeTag() {
    if (!this.focused || this.tag.hidden) return;
    _tag.set(this.frame.center.x, this.frame.top + 0.5, this.frame.center.z).project(this.camera);
    const onScreen = _tag.z < 1 && Math.abs(_tag.x) < 1.05 && Math.abs(_tag.y) < 1.05;
    const x = Math.round(((_tag.x + 1) / 2) * this.cssW);
    const y = Math.round(((1 - _tag.y) / 2) * this.cssH);
    if (x === this.tagX && y === this.tagY) return;
    this.tagX = x;
    this.tagY = y;
    this.tag.style.visibility = onScreen ? '' : 'hidden';
    this.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  private pickAt(clientX: number, clientY: number): FocusKey | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.diorama.pick(this.ray);
  }

  private onControlsStart = () => {
    if (this.intro) this.flyIn(0);
    if (this.move.active) {
      this.move.active = false;
      this.arrived();
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.pointers.size === 0) this.multiTouch = false;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    if (this.pointers.size > 1) this.multiTouch = true; // pinch or two-finger turn: never a tap
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!d || this.multiTouch || this.launching) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!isTap(e.clientX - d.x, e.clientY - d.y, performance.now() - d.t)) return; // that was a drag
    // A module: look at it. Empty ground or sky: back to the whole base.
    this.focus(this.pickAt(e.clientX, e.clientY), true);
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.multiTouch = true;
  };

  /** Mouse hover: a pointing-hand cursor over anything you can click (checked a few times a second). */
  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons || this.launching) return;
    const now = performance.now();
    if (now - this.hoverAt < 90) return;
    this.hoverAt = now;
    this.renderer.domElement.style.cursor = this.pickAt(e.clientX, e.clientY) ? 'pointer' : '';
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || this.launching || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    // Keys belong to an open dialog.
    if (document.querySelector('[aria-modal="true"]')) return;
    if (e.key === 'Escape') {
      if (this.focused) this.focus(null, true);
      return;
    }
    if (e.key.length !== 1 || e.key < '0' || e.key > '9') return;
    if (e.key === '0') return this.focus(null, true);
    const pick = this.diorama.focusTargets()[Number(e.key) - 1];
    if (pick) this.focus(pick.key, true);
  };

  /** "Look at" menu beside the 3D view (outside it, so screen readers and keyboards can reach it). */
  private buildLookMenu(el: HTMLElement) {
    const host = el.parentElement ?? el;
    this.lookWrap.className = 'look-at';
    const span = document.createElement('span');
    span.textContent = 'Look at';
    this.look.setAttribute('aria-label', 'Look at a part of the base. Number keys 1 to 9 also work, and 0 for the whole base.');
    this.look.addEventListener('change', () => {
      this.focus((this.look.value || null) as FocusKey | null, true);
      this.look.blur();
    });
    this.lookWrap.append(span, this.look);
    host.append(this.lookWrap);
    this.refreshLookMenu();
  }

  /** The menu lists what is built so far, numbered like the number keys. */
  private refreshLookMenu() {
    const list = this.diorama.focusTargets();
    const keys = list.map((t) => t.key).join(',');
    if (keys === this.lookKeys) return;
    this.lookKeys = keys;
    const sel = this.look;
    sel.replaceChildren();
    const opt = (value: string, text: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      sel.append(o);
    };
    opt('', '0 Whole base');
    list.forEach((t, i) => opt(t.key, i < 9 ? `${i + 1} ${t.label}` : t.label));
    sel.value = this.focused ?? '';
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKey, true);
    this.controls?.removeEventListener('start', this.onControlsStart);
    this.controls?.dispose();
    this.diorama?.disposeCosmetics();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
    this.tag.remove();
    this.lookWrap.remove();
  }
}
