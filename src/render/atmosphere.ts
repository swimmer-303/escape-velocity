// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The air around the 3D outpost (or the lack of it, on the Moon): the sky dome with its Sun, glow and stars,
// dust drifting and blowing past, soft glows around the base's lamps, pools of lamplight on the ground at
// night, and Mars' two little moons. Also the quality tier, so a school Chromebook stays smooth.
//
// Everything here is cheap on purpose: the dust is one draw call animated on the GPU (no work per frame on the
// CPU), every lamp glow is one more point in a single draw call, and the light pools are flat quads in one
// mesh. Nothing is allocated while the game runs.

import * as THREE from 'three';
import { rand } from './retro';
import { POINT_SCALE } from './fx';

// ---------------------------------------------------------------------------------------- quality tier

export type Quality = 'high' | 'low';

/**
 * A first guess at how strong the device is. 'low' (no shadows, much less dust in the air) on 4 or fewer CPU
 * cores, 4 GB or less of memory, or a phone-sized screen. `?quality=low` or `?quality=high` in the address forces
 * one. The 3D stage also drops to 'low' by itself if the first frames come in slow (see ThreeStage).
 */
export function detectQuality(): Quality {
  try {
    const forced = new URLSearchParams(location.search).get('quality');
    if (forced === 'low' || forced === 'high') return forced;
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.hardwareConcurrency ?? 8) <= 4) return 'low';
    if ((nav.deviceMemory ?? 8) <= 4) return 'low';
    if (Math.min(screen.width, screen.height) < 480) return 'low';
  } catch {
    /* no navigator or screen: assume a normal computer */
  }
  return 'high';
}

/** Frames slower than this (seconds, the median of a short sample) switch the stage to the 'low' tier. */
export const SLOW_FRAME = 1 / 40;
/** When the slow-device check samples frames: seconds after the 3D view starts (past the shader compiles and loading). */
export const WATCH_FROM = 3;
export const WATCH_TO = 6;

// ---------------------------------------------------------------------------------------- sky

/**
 * The diorama's sky dome. A gradient from a hazy horizon to the zenith, the Sun (a soft disc through Mars' dust,
 * a hard white one on the airless Moon), a wide glow around it on Mars, the blue glow around the Sun at a Mars
 * sunset, and stars. Below the horizon it is the horizon color, which the haze (fog) also uses, so far hills melt
 * into the sky in layers.
 */
export function makeWorldSky() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#b4825a') },
      uHorizon: { value: new THREE.Color('#ecc596') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff6e4') },
      uGlow: { value: new THREE.Color('#fff0d4') },
      uGlowAmt: { value: 1 },
      uBlue: { value: 0 },
      uNight: { value: 0 },
      uStars: { value: 0 },
      uHardSun: { value: 0 },
      uSunSize: { value: Math.cos(THREE.MathUtils.degToRad(0.7)) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uGlow;
      uniform float uGlowAmt; uniform float uBlue; uniform float uNight; uniform float uStars; uniform float uHardSun;
      uniform float uSunSize; uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
        float s = max(dot(d, uSunDir), 0.0);
        float sunUp = smoothstep(-0.1, 0.02, uSunDir.y);
        // Dusty air scatters a wide, warm glow around the Sun (none on the Moon: no air).
        c += uGlow * (pow(s, 5.0) * 0.3 + pow(s, 48.0) * 0.75) * uGlowAmt * sunUp * (1.0 - 0.75 * uBlue);
        // Mars sunsets are blue: fine dust scatters blue light forward, so the sky right around the low Sun turns blue.
        float b = uBlue * (pow(s, 40.0) * 1.1 + pow(s, 12.0) * 0.4) * smoothstep(-0.25, 0.05, d.y);
        c = mix(c, vec3(0.3, 0.48, 0.86), clamp(b, 0.0, 0.88));
        // The Sun's disc (drawn bigger than real so it shows up): soft through dust, sharp with no air.
        float edge = mix(0.00006, 0.000004, uHardSun);
        float disc = smoothstep(uSunSize - edge, uSunSize, s) * sunUp * step(-0.01, d.y);
        c = mix(c, uSunColor, disc);
        // Stars: at night on Mars (fading into the dusty horizon, with a little twinkle); on the Moon all day,
        // all the way down to the horizon, steady and crisp.
        vec3 cell = floor(d * 230.0);
        float r = hash(cell);
        float star = step(0.9968, r) * (0.35 + 0.65 * hash(cell + 7.1));
        float fade = mix(smoothstep(0.02, 0.3, d.y), step(-0.005, d.y), uStars);
        float twinkle = mix(0.8 + 0.2 * sin(uTime * 2.1 + r * 70.0), 1.0, uStars);
        c += vec3(star) * fade * twinkle * max(uNight, uStars) * (1.0 - disc);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------------------- dust in the air

const MOTE_VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uWind; uniform vec3 uCenter; uniform float uBox; uniform float uTop;
uniform float uScale; uniform float uSize; uniform float uGust;
varying float vFade;
void main() {
  vec3 p = aSeed.xyz * vec3(uBox, uTop, uBox);
  float speed = 0.55 + 0.9 * aSeed.w;
  p += uWind * (uTime * speed);
  p.y += sin(uTime * (0.5 + aSeed.w) + aSeed.w * 40.0) * (0.25 + uGust);
  // Wrap around the point the camera looks at, so the air is always full of dust wherever you look.
  p.xz = mod(p.xz - uCenter.xz + 0.5 * uBox, uBox) - 0.5 * uBox + uCenter.xz;
  p.y = mod(p.y, uTop) + 0.1;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * aSeed.w) * uScale / max(0.5, -mv.z), 1.0, 7.0);
  // Thin out near the camera and far away.
  vFade = smoothstep(1.0, 4.0, -mv.z) * (1.0 - smoothstep(uBox * 0.4, uBox * 0.6, length(p.xz - uCenter.xz)));
}`;

const MOTE_FRAGMENT = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; uniform float uStreak;
varying float vFade;
void main() {
  // Blowing dust in a storm: short horizontal streaks instead of specks.
  if (abs(gl_PointCoord.y - 0.5) > mix(0.5, 0.16, uStreak)) discard;
  gl_FragColor = vec4(uColor, uOpacity * vFade);
  #include <colorspace_fragment>
}`;

/** How much dust is in the air for each kind of weather (count per tier, opacity, wind speed, streaks). */
const DUST_MOOD = {
  clear: { high: 220, low: 0, opacity: 0.26, wind: 0.6, streak: 0, size: 0.06 },
  dusty: { high: 700, low: 160, opacity: 0.55, wind: 3.2, streak: 0.4, size: 0.09 },
  storm: { high: 1400, low: 320, opacity: 0.85, wind: 11, streak: 1, size: 0.12 },
} as const;
export type DustWeather = keyof typeof DUST_MOOD;

/**
 * Dust drifting in the air: specks on calm days, more and faster on dusty ones, streaks of blowing dust in a dust
 * storm. One fixed pool of points, moved by the GPU from a clock, so it costs nothing on the CPU each frame.
 * Never on the Moon (no wind to lift it), and still with reduced motion.
 */
export class DustMotes {
  readonly points: THREE.Points;
  /** What the dust is doing now; eased toward the weather's mood each frame. */
  opacity = 0;
  private mood: DustWeather = 'clear';
  private tier: Quality = 'high';
  private enabled = true;
  private clock = 0;
  private wind = 0.6;
  private streak = 0;
  private size = 0.07;
  private u: Record<string, THREE.IUniform>;

  constructor(capacity = DUST_MOOD.storm.high) {
    const seeds = new Float32Array(capacity * 4);
    const r = rand(4242);
    for (let i = 0; i < seeds.length; i++) seeds[i] = r();
    const geo = new THREE.BufferGeometry();
    // Positions are made up in the shader; this attribute only sizes the draw.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector3(1, 0, 0.35) },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: 46 },
        uTop: { value: 9 },
        uScale: POINT_SCALE,
        uSize: { value: 0.07 },
        uGust: { value: 0 },
        uColor: { value: new THREE.Color('#e8b57a') },
        uOpacity: { value: 0 },
        uStreak: { value: 0 },
      },
      vertexShader: MOTE_VERTEX,
      fragmentShader: MOTE_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.u = material.uniforms;
    this.points = new THREE.Points(geo, material);
    this.points.name = 'dust-motes';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  /** The weather (and whether there is air at all: false on the Moon). */
  setWeather(w: DustWeather, air: boolean) {
    this.mood = w;
    this.enabled = air;
    if (!air) {
      this.opacity = 0;
      this.points.visible = false;
    }
    this.applyCount();
  }

  setQuality(q: Quality) {
    this.tier = q;
    this.applyCount();
  }

  /** The middle of the dusty air (the point the camera looks at). */
  get center(): THREE.Vector3 {
    return this.u.uCenter.value as THREE.Vector3;
  }

  private applyCount() {
    const m = DUST_MOOD[this.mood];
    this.points.geometry.setDrawRange(0, this.enabled ? m[this.tier] : 0);
  }

  update(dt: number, reduced: boolean, color: THREE.Color) {
    const m = DUST_MOOD[this.mood];
    const target = this.enabled ? m.opacity : 0;
    const k = Math.min(1, dt * 2);
    this.opacity += (target - this.opacity) * k;
    this.wind += (m.wind - this.wind) * k;
    this.streak += (m.streak - this.streak) * k;
    this.size += (m.size - this.size) * k;
    // Reduced motion: the dust hangs still (and no streaky flurries).
    if (!reduced) this.clock += dt;
    const u = this.u;
    u.uTime.value = this.clock;
    (u.uWind.value as THREE.Vector3).set(this.wind, 0, this.wind * 0.35);
    u.uStreak.value = reduced ? 0 : this.streak;
    u.uSize.value = this.size;
    u.uGust.value = this.streak * 0.4;
    u.uOpacity.value = this.opacity;
    (u.uColor.value as THREE.Color).copy(color);
    this.points.visible = this.enabled && this.opacity > 0.01 && this.points.geometry.drawRange.count > 0;
  }
}

// ---------------------------------------------------------------------------------------- lamp glows and light pools

const HALO_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aGlow;
uniform float uScale;
uniform float uMax;
varying vec3 vColor;
void main() {
  vColor = aColor * aGlow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, uMax);
  if (aGlow < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const HALO_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = 1.0 - r;
  gl_FragColor = vec4(vColor * a * a * a, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Soft additive glows: a cheap stand-in for bloom around lamps, windows and the Earth. All of them are one draw
 * call; each glow's color and strength can be changed at any time without allocating.
 */
export class Halos {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private glow: Float32Array;
  private n = 0;

  constructor(readonly capacity: number, maxPixels = 64) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.glow = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: POINT_SCALE, uMax: { value: maxPixels } },
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Add a glow (size: its width in scene units). Returns its index. */
  add(x: number, y: number, z: number, size: number): number {
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.size[i] = size;
    this.points.geometry.setDrawRange(0, this.n);
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    return i;
  }

  move(i: number, x: number, y: number, z: number) {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  set(i: number, color: THREE.Color, strength: number) {
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.glow[i] = Math.max(0, strength);
  }

  /** Call once after a batch of set(): uploads the new colors and strengths. */
  commit() {
    const a = this.points.geometry.attributes;
    (a.aColor as THREE.BufferAttribute).needsUpdate = true;
    (a.aGlow as THREE.BufferAttribute).needsUpdate = true;
  }
}

const POOL_VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec3 aColor;
attribute float aGlow;
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  vCorner = aCorner;
  vColor = aColor * aGlow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const POOL_FRAGMENT = /* glsl */ `
uniform float uDark;
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  float r = dot(vCorner, vCorner);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * (1.0 - r);
  // Light pools add light; blob shadows (uDark = 1) darken what is under them.
  gl_FragColor = uDark > 0.5 ? vec4(0.0, 0.0, 0.0, a * vColor.r) : vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Round spots lying flat on the ground, all in one mesh: pools of lamplight at night (added light), or soft blob
 * shadows under the buildings when real shadows are off on the 'low' tier (darkening).
 */
export class GroundSpots {
  readonly mesh: THREE.Mesh;
  private col: Float32Array;
  private glow: Float32Array;
  private n = 0;

  constructor(readonly capacity: number, dark = false) {
    const pos = new Float32Array(capacity * 4 * 3);
    const corner = new Float32Array(capacity * 4 * 2);
    this.col = new Float32Array(capacity * 4 * 3);
    this.glow = new Float32Array(capacity * 4);
    const index: number[] = [];
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      corner.set([-1, -1, 1, -1, -1, 1, 1, 1], i * 8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { uDark: { value: dark ? 1 : 0 } },
      vertexShader: POOL_VERTEX,
      fragmentShader: POOL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = dark ? 'blob-shadows' : 'light-pools';
  }

  /** Add a spot at (x, z), `y` just above the ground, radius `rx` by `rz`. Returns its index. */
  add(x: number, y: number, z: number, rx: number, rz = rx): number {
    const i = this.n++;
    const p = (this.mesh.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    p.set([x - rx, y, z - rz, x + rx, y, z - rz, x - rx, y, z + rz, x + rx, y, z + rz], i * 12);
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.n * 6);
    return i;
  }

  set(i: number, color: THREE.Color, strength: number) {
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      this.col[v * 3] = color.r;
      this.col[v * 3 + 1] = color.g;
      this.col[v * 3 + 2] = color.b;
      this.glow[v] = Math.max(0, strength);
    }
  }

  commit() {
    const a = this.mesh.geometry.attributes;
    (a.aColor as THREE.BufferAttribute).needsUpdate = true;
    (a.aGlow as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------- Phobos and Deimos

/** A small lumpy rock: a low-poly ball pushed in and out at random, shaded from one side (baked in). */
function lumpyMoon(radius: number, stretch: THREE.Vector3, seed: number, base: THREE.Color) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const r = rand(seed);
  const bump = new Map<string, number>();
  const v = new THREE.Vector3();
  const light = new THREE.Vector3(-0.6, 0.3, 0.75).normalize();
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Shared corners get the same bump, so the surface stays closed.
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = bump.get(key);
    if (k === undefined) bump.set(key, (k = 0.78 + r() * 0.4));
    v.multiplyScalar(k).multiply(stretch);
    pos.setXYZ(i, v.x, v.y, v.z);
    const lit = THREE.MathUtils.clamp(v.clone().normalize().dot(light) * 0.7 + 0.45, 0.12, 1);
    c.copy(base).multiplyScalar(lit * (0.85 + (k - 0.78) * 0.5));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0, depthWrite: false }));
}

const _moonDir = new THREE.Vector3();

/**
 * Mars has two small, lumpy moons, Phobos and Deimos, shown at night (both drawn several times bigger than they
 * really look, so they show up). Phobos orbits faster than Mars turns, so it rises in the west and sets in the east,
 * the opposite way to the Sun; Deimos drifts slowly the same way as the Sun.
 */
export class MarsMoons {
  readonly group = new THREE.Group();
  private phobos: THREE.Mesh;
  private deimos: THREE.Mesh;

  constructor() {
    this.group.name = 'mars-moons';
    this.phobos = lumpyMoon(1.5, new THREE.Vector3(1.35, 0.95, 1.1), 11, new THREE.Color('#d9cbb8'));
    this.phobos.name = 'phobos';
    this.deimos = lumpyMoon(0.65, new THREE.Vector3(1.15, 0.95, 1), 12, new THREE.Color('#e6dccb'));
    this.deimos.name = 'deimos';
    this.group.add(this.phobos, this.deimos);
    for (const m of [this.phobos, this.deimos]) {
      m.renderOrder = -1;
      m.frustumCulled = false;
    }
  }

  /**
   * t: the time of day (0 sunrise, 0.5 sunset), `night` 0..1, `show` false on the Moon (or in a dust storm).
   * The Sun rises on the +x side of the scene and sets on the -x side.
   */
  update(t: number, night: number, show: boolean) {
    const vis = show ? night : 0;
    this.group.visible = vis > 0.01;
    if (!this.group.visible) return;
    // Through the night: Phobos from the west (-x) across the sky to the east (+x), kept low enough to see.
    const k = THREE.MathUtils.clamp((t - 0.5) / 0.5, 0, 1);
    const az = Math.PI * (1 + Math.pow(k, 1.6));
    const el = 0.05 + 0.11 * Math.sin(Math.PI * k);
    _moonDir.set(Math.cos(az), el, Math.sin(az)).normalize();
    this.phobos.position.copy(_moonDir).multiplyScalar(165);
    this.phobos.rotation.set(0.3, k * 2, 0.2);
    // Deimos: slowly, east to west like the Sun, a little higher.
    const b = Math.PI * (1.45 - 0.12 * k);
    _moonDir.set(Math.cos(b), 0.15, Math.sin(b)).normalize();
    this.deimos.position.copy(_moonDir).multiplyScalar(165);
    (this.phobos.material as THREE.MeshBasicMaterial).opacity = vis;
    (this.deimos.material as THREE.MeshBasicMaterial).opacity = vis * 0.9;
  }
}
