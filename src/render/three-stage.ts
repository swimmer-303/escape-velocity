// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The 3D stage: renders the diorama at a reduced internal resolution (about 400 px tall),
// runs the retro post-process, and the canvas is upscaled with crisp nearest-neighbor pixels.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Diorama } from './diorama';
import { SNAP, makePostMaterial, makeSkyMaterial } from './retro';
import type { Stage, StageScene } from './stage';

const TARGET_HEIGHT = 400;

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
  private launching: { start: number; dur: number; resolve: () => void } | null = null;
  private resizeObs?: ResizeObserver;
  private overlay = document.createElement('div');
  /** Called if the GPU rejects our shaders, so the game can fall back to the simple stage. */
  onFail?: () => void;

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
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.debug.onShaderError = () => {
      console.warn('3D shaders failed to compile; switching to the simple view.');
      this.onFail?.();
    };
    this.renderer.domElement.addEventListener('webglcontextlost', () => this.onFail?.());
    el.append(this.renderer.domElement);
    this.overlay.className = 'stage-overlay';
    el.append(this.overlay);

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

    this.camera.position.set(17, 11, 19);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.2, 1.5);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 38;
    this.controls.minPolarAngle = 0.5;
    this.controls.maxPolarAngle = 1.38;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.update();

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
  }

  setScene(scene: StageScene) {
    this.sceneInfo = scene;
    this.diorama?.setScene(scene);
  }

  setTimeOfDay(t: number) {
    this.dayT = t;
    if (!this.sky) return;
    // Sun travels east to west during the first half of the sol, then it's night.
    const day = t < 0.5;
    const a = (day ? t / 0.5 : 1) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(a) * 0.9, Math.sin(a) * 0.85 + (day ? 0.02 : -0.3), -0.35).normalize();
    const elev = Math.max(0, sunDir.y);
    const dusk = day ? Math.max(0, 1 - Math.min(t, 0.5 - t) / 0.07) : 0;
    const night = day ? 0 : Math.min(1, Math.min(t - 0.5, 1 - t) / 0.05);
    const dust = this.sceneInfo?.weather === 'storm' ? 0.65 : this.sceneInfo?.weather === 'dusty' ? 0.35 : 0;

    const zenithDay = new THREE.Color('#b98a5d');
    const horizonDay = new THREE.Color('#e9bd8c');
    const zenithNight = new THREE.Color('#0b0a18');
    const horizonNight = new THREE.Color('#1d1836');
    const u = this.sky.uniforms;
    (u.uZenith.value as THREE.Color).copy(zenithDay).lerp(new THREE.Color('#3a3a5a'), dusk * 0.6).lerp(zenithNight, night);
    (u.uHorizon.value as THREE.Color).copy(horizonDay).lerp(new THREE.Color('#c28b6a'), dusk * 0.5).lerp(horizonNight, night);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    u.uBlue.value = dusk;
    u.uNight.value = night;

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(u.uHorizon.value as THREE.Color).lerp(new THREE.Color('#c98a52'), dust);
    fog.near = 40 - dust * 34;
    fog.far = 150 - dust * 110;

    this.diorama.sunLight.position.copy(sunDir).multiplyScalar(40);
    this.diorama.sunLight.intensity = day ? (0.4 + elev * 2.2) * (1 - dust * 0.6) : 0;
    this.diorama.sunLight.color.set(dusk > 0.3 ? '#9fb6e8' : '#fff1d6');
    this.diorama.ambient.intensity = 0.25 + (1 - night) * 0.85 * (1 - dust * 0.3);
    this.diorama.ambient.color.set(night > 0.5 ? '#4a4f7a' : '#f2d2a8');
    this.diorama.setNight(night);
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

  launch(): Promise<void> {
    return new Promise((resolve) => {
      this.controls.autoRotate = false;
      this.overlay.innerHTML = '';
      this.launching = { start: performance.now(), dur: this.reduced ? 2200 : 6200, resolve };
    });
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    if (this.controls) this.controls.autoRotate = !on;
    this.el?.classList.toggle('reduced', on);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    this.diorama.tick(dt, time, this.reduced);

    if (this.launching) this.stepLaunch();
    else this.controls.update();

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

  private stepLaunch() {
    const L = this.launching!;
    const k = Math.min(1, (performance.now() - L.start) / L.dur);
    const h = this.diorama.launchStep(k);
    const rp = this.diorama.rocketPosition();
    // Camera follows the rocket up into the sky.
    const look = new THREE.Vector3(rp.x, rp.y + 2, rp.z);
    this.controls.target.lerp(look, 0.08);
    this.camera.position.lerp(new THREE.Vector3(rp.x + 14, Math.max(6, rp.y * 0.6 + 5), rp.z + 16), 0.03);
    this.camera.lookAt(this.controls.target);
    this.flash = Math.max(this.flash, k > 0.12 && k < 0.2 ? 0.3 : 0);
    if (k > 0.55 && !this.overlay.innerHTML) {
      this.overlay.innerHTML = '<div class="launch-text"><span>ESCAPE VELOCITY REACHED</span><b>5.0 km/s</b></div>';
    }
    if (k >= 1) {
      const resolve = L.resolve;
      this.launching = null;
      window.setTimeout(() => {
        this.overlay.innerHTML = '';
        this.diorama.resetLaunch();
        this.controls.target.set(0, 1.2, 1.5);
        this.camera.position.set(17, 11, 19);
        this.controls.autoRotate = !this.reduced;
      }, 400);
      void h;
      resolve();
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}
