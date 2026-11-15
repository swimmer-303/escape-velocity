// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The 3D stage: renders the diorama at a reduced internal resolution (about 400 px tall),
// runs the retro post-process, and the canvas is upscaled with crisp nearest-neighbor pixels.
// Tap or click a part of the base to fly the camera to it (a label shows its name); tap the ground or
// press Escape to fly back. Keyboard: number keys, or the "Look at" menu beside the view.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Diorama, FOCUS_LABELS, LAUNCH_TIMELINE } from './diorama';
import { SNAP, makePostMaterial } from './retro';
import { POINT_SCALE } from './fx';
import { makeWorldSky, MarsMoons, detectQuality, SLOW_FRAME, WATCH_FROM, WATCH_TO, type Quality } from './atmosphere';
import { moonSunDirection, EARTH_DIR } from './moon';
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
// The light and sky (set every frame while a sol plays, so all of it is made once, here).
const _sun = new THREE.Vector3();
const _c = new THREE.Color();
const _earthLight = new THREE.Vector3();
const _toMoon = new THREE.Vector3();
const col = (hex: string) => new THREE.Color(hex);
const MARS = {
  zenDay: col('#b27c54'),
  horDay: col('#e8bf8e'),
  horIce: col('#e3c4a4'),
  zenDusk: col('#43394a'),
  horDusk: col('#ad7a62'),
  zenNight: col('#05050d'),
  horNight: col('#151327'),
  zenStorm: col('#5e301a'),
  horStorm: col('#94512b'),
  sun: col('#fff6e2'),
  sunDusk: col('#eef3ff'),
  glow: col('#fff0d2'),
  key: col('#ffe6c2'),
  keyDusk: col('#ffb98e'),
  skyDay: col('#f2d0a4'),
  skyNight: col('#44549a'),
  skyStorm: col('#b9774a'),
  groundDay: col('#6b2e16'),
  groundNight: col('#1c1220'),
  fill: col('#86a2dc'),
  fillNight: col('#5868a8'),
  mote: col('#ecc590'),
  moteStorm: col('#b46e3d'),
  postDust: col('#c98a52'),
  postStorm: col('#8a3f1e'),
};
const MOON = {
  zenith: col('#000000'),
  horizon: col('#030308'),
  sun: col('#ffffff'),
  sky: col('#1d2232'),
  skyNight: col('#141a2c'),
  ground: col('#2a2a2e'),
  earthshine: col('#a4bcff'),
};
/** The Sun's disc on Mars (it looks about two-thirds as wide as from Earth; drawn bigger so it shows up). */
const MARS_SUN_SIZE = Math.cos(THREE.MathUtils.degToRad(0.75));
/** On the Moon: about as wide as from Earth, drawn a little bigger. */
const MOON_SUN_SIZE = Math.cos(THREE.MathUtils.degToRad(0.85));
/** Up to this many frame times are sampled to decide if the device is slow. */
const WATCH_MAX = 240;

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
  private marsMoons = new MarsMoons();
  private quality: Quality = 'high';
  /** Frame times for the slow-device check (see loop). */
  private watch = { t: 0, n: 0, done: false, dt: new Float32Array(WATCH_MAX) };
  /** The gentle up-and-down "breathing" of the idle camera, applied this frame (taken off again before the next). */
  private breath = 0;
  /** How much breathing (0..1): eases in whenever the camera comes to rest, so it never jumps. */
  private breathAmp = 0;
  private frameNo = 0;
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
    // One small shadow map with softened edges (the 'low' tier turns shadows off; see setQuality).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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

    this.sky = makeWorldSky();
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), this.sky);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -2;
    this.scene.add(skyMesh, this.marsMoons.group);
    // Haze that thickens with distance (squared exponential: near things stay crisp, far ridges fade in layers).
    this.scene.fog = new THREE.FogExp2('#e8bf8e', 0.0078);

    this.diorama = new Diorama();
    this.scene.add(this.diorama.group);
    const sc = this.diorama.sunLight.shadow.camera;
    sc.far = 140; // the light sits 60 units out along the Sun's direction (long, low shadows reach far)
    this.diorama.sunLight.shadow.autoUpdate = false;
    this.setQuality(detectQuality());
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
    // A new world (or new weather) needs a new sky and new light right away.
    if (this.sky) this.setTimeOfDay(this.dayT);
    if (!this.diorama) return;
    this.refreshLookMenu();
    // Back to the whole base if the world changed or the part we were looking at is gone.
    if (this.focused && (siteChanged || !this.lookKeys.split(',').includes(this.focused))) this.focus(null, true);
  }

  setTimeOfDay(t: number) {
    this.dayT = t;
    if (!this.sky) return;
    this.diorama.setDayTime(t);
    // Called every frame while a sol plays: everything below reuses preallocated objects.
    if (this.sceneInfo?.site === 'moon') this.lookMoon(t);
    else this.lookMars(t);
  }

  /**
   * Mars: a butterscotch sky (dust in the air scatters red light), a soft Sun with a wide warm glow, and a blue glow
   * around the Sun at dawn and dusk. Haze the color of the horizon, so the real crater rim and Mount Sharp fade into
   * the sky in layers. A warm key light from the Sun and a cool fill from the other side. Dust storms darken and
   * redden everything, swallow the distance and blow dust past. Nights have stars, Phobos and Deimos, and the base's
   * lamps throwing pools of light.
   */
  private lookMars(t: number) {
    const day = t < 0.5;
    const a = (day ? t / 0.5 : 1) * Math.PI;
    const sunDir = _sun.set(Math.cos(a) * 0.9, Math.sin(a) * 0.85 + (day ? 0.02 : -0.3), -0.35).normalize();
    const elev = Math.max(0, sunDir.y);
    const dusk = day ? Math.max(0, 1 - Math.min(t, 0.5 - t) / 0.09) : 0;
    const night = day ? 0 : Math.min(1, Math.min(t - 0.5, 1 - t) / 0.05);
    const weather = this.sceneInfo?.weather;
    const dust = weather === 'storm' ? 1 : weather === 'dusty' ? 0.45 : 0;
    const ice = this.sceneInfo?.landing === 'arcadia';
    const u = this.sky.uniforms;
    const dim = 1 - 0.85 * night;

    const zen = (u.uZenith.value as THREE.Color).copy(MARS.zenDay).lerp(MARS.zenDusk, dusk * 0.75).lerp(MARS.zenNight, night);
    const hor = (u.uHorizon.value as THREE.Color).copy(ice ? MARS.horIce : MARS.horDay).lerp(MARS.horDusk, dusk * 0.7).lerp(MARS.horNight, night);
    zen.lerp(_c.copy(MARS.zenStorm).multiplyScalar(dim), dust * 0.85);
    hor.lerp(_c.copy(MARS.horStorm).multiplyScalar(dim), dust * 0.85);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Color).copy(MARS.sun).lerp(MARS.sunDusk, dusk);
    (u.uGlow.value as THREE.Color).copy(MARS.glow);
    u.uGlowAmt.value = 1 - dust * 0.7;
    u.uBlue.value = dusk * (1 - dust);
    u.uNight.value = night * (1 - dust * 0.9);
    u.uStars.value = 0;
    u.uHardSun.value = 0;
    u.uSunSize.value = MARS_SUN_SIZE;

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(hor);
    fog.density = 0.0078 + dust * 0.026;

    const L = this.diorama;
    L.sunLight.position.copy(sunDir).multiplyScalar(60);
    L.shadeFrom(sunDir);
    L.sunLight.intensity = day ? (0.35 + elev * 2.3) * (1 - dust * 0.75) * Math.min(1, elev * 12 + 0.25) : 0;
    L.sunLight.color.copy(MARS.key).lerp(MARS.keyDusk, dusk);
    L.ambient.color.copy(MARS.skyDay).lerp(MARS.skyNight, night).lerp(MARS.skyStorm, dust * 0.6 * dim);
    L.ambient.groundColor.copy(MARS.groundDay).lerp(MARS.groundNight, night);
    L.ambient.intensity = (0.78 + night * 0.12) * (1 - dust * 0.25);
    L.fillLight.position.set(-sunDir.x * 30, 18, -sunDir.z * 30 + 10);
    L.fillLight.color.copy(MARS.fill).lerp(MARS.fillNight, night);
    L.fillLight.intensity = (0.3 + dusk * 0.25 + night * 0.25) * (1 - dust * 0.6);
    L.setNight(night);
    L.gloom = Math.max(night, dust * 0.55, dusk * 0.45);
    L.moteColor.copy(MARS.mote).lerp(MARS.moteStorm, dust).multiplyScalar(1 - 0.7 * night);

    this.post.uniforms.uDust.value = dust * 0.42;
    (this.post.uniforms.uDustColor.value as THREE.Color).copy(MARS.postDust).lerp(MARS.postStorm, dust);
    this.marsMoons.update(t, night, dust < 0.5);
  }

  /**
   * The Moon: no air, so no haze, no glow around the Sun and no blue sunset: a black sky with crisp stars all day,
   * and a hard white Sun. Near the south pole the Sun stays low, so light comes in at a low angle and shadows are
   * long and black. The Earth hangs low over the horizon, lit by the Sun (so it shows phases). On the Moon's near
   * side the long lunar night comes when the Earth is close to full, and its light (earthshine) faintly lights the base.
   */
  private lookMoon(t: number) {
    const sunDir = moonSunDirection(t, _sun);
    const day = t < 0.5;
    const night = day ? 0 : Math.min(1, Math.min(t - 0.5, 1 - t) / 0.05);
    const up = THREE.MathUtils.smoothstep(sunDir.y, -0.01, 0.03);
    const u = this.sky.uniforms;
    (u.uZenith.value as THREE.Color).copy(MOON.zenith);
    (u.uHorizon.value as THREE.Color).copy(MOON.horizon);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunColor.value as THREE.Color).copy(MOON.sun);
    u.uGlowAmt.value = 0;
    u.uBlue.value = 0;
    u.uNight.value = night;
    u.uStars.value = 1;
    u.uHardSun.value = 1;
    u.uSunSize.value = MOON_SUN_SIZE;

    // No haze on the Moon: there is no air to scatter light, so far hills are as crisp as near ones.
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(MOON.horizon);
    fog.density = 0;

    // The Earth's phase: lit from the Sun's side; through the long night it swings round to nearly full.
    const earthLight = _earthLight.copy(sunDir).lerp(_toMoon.copy(EARTH_DIR).negate().setY(0.15), night).normalize();
    const lit = (1 + earthLight.dot(_toMoon.copy(EARTH_DIR).negate())) / 2;
    this.diorama.setEarthLight(earthLight, lit);

    const L = this.diorama;
    L.sunLight.position.copy(sunDir).multiplyScalar(60);
    L.shadeFrom(sunDir);
    L.sunLight.intensity = 3.6 * up;
    L.sunLight.color.copy(MOON.sun);
    L.ambient.color.copy(MOON.sky).lerp(MOON.skyNight, night);
    L.ambient.groundColor.copy(MOON.ground);
    L.ambient.intensity = 0.3 - night * 0.08;
    // Earthshine: sunlight bounced off the Earth, from the Earth's side of the sky (strongest when the Earth is full).
    L.fillLight.position.copy(EARTH_DIR).multiplyScalar(30).setY(8);
    L.fillLight.color.copy(MOON.earthshine);
    L.fillLight.intensity = lit * (0.06 + 0.62 * night);
    L.setNight(night);
    L.gloom = Math.max(night, 0.3);
    this.post.uniforms.uDust.value = 0;
    this.marsMoons.update(t, 0, false);
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

  /**
   * The quality tier. 'high': a shadow map and plenty of dust in the air. 'low' (weak devices, such as many school
   * Chromebooks): no shadow map (soft blob shadows instead) and much less dust. Everything else looks the same.
   */
  setQuality(q: Quality) {
    const changed = q !== this.quality;
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    this.diorama?.setQuality(q);
    if (changed) {
      // Every material has to be rebuilt without (or with) shadows.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
  }

  /** 'high' or 'low' (see setQuality). */
  get qualityTier(): Quality {
    return this.quality;
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
    this.watchFrame(dt);
    // The shadow map is redrawn every other frame (moving shadows at 30 per second look the same in this style).
    this.diorama.sunLight.shadow.needsUpdate = (this.frameNo++ & 1) === 0;
    // Take last frame's breathing back out, so the controls and camera moves work from the true position.
    if (this.breath) {
      this.camera.position.y -= this.breath;
      this.breath = 0;
    }
    this.diorama.tick(dt, time, this.reduced);

    if (this.launching) this.stepLaunch(dt);
    else if (this.intro) this.stepIntro(dt);
    else if (this.move.active) {
      this.move.step(dt, this.camera, this.controls.target);
      if (!this.move.active) this.arrived();
    } else {
      this.controls.update();
      // A gentle, slow rise and fall while the camera idles (never with reduced motion).
      if (!this.reduced) {
        this.breathAmp = Math.min(1, this.breathAmp + dt * 0.6);
        this.breath = (Math.sin(time * 0.45) * 0.08 + Math.sin(time * 0.17 + 1.3) * 0.05) * this.breathAmp;
        this.camera.position.y += this.breath;
      }
    }
    if (this.launching || this.intro || this.move.active || this.reduced) this.breathAmp = 0;
    // The dust in the air is centered on whatever the camera looks at.
    this.diorama.motes.center.copy(this.controls.target);
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

  /**
   * The slow-device check: a few seconds in (past shader compiles and loading), sample frame times for a few
   * seconds; if the median frame is slower than SLOW_FRAME, drop to the 'low' tier for good. Only ever goes down,
   * and only once.
   */
  private watchFrame(dt: number) {
    const w = this.watch;
    if (w.done || this.quality === 'low') return;
    w.t += dt;
    if (w.t < WATCH_FROM) return;
    if (w.t < WATCH_TO && w.n < WATCH_MAX) {
      w.dt[w.n++] = dt;
      return;
    }
    w.done = true;
    // Too few frames in three seconds is itself a sign of a slow device.
    const sample = w.dt.subarray(0, w.n).sort();
    if (w.n < 40 || sample[w.n >> 1] > SLOW_FRAME) this.setQuality('low');
  }

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
