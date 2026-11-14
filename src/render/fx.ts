// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Pooled particles for the outpost's small effects: welding sparks, rocket flames, dust kicked up by
// landers and launches, and radio pulses. Each pool is one draw call with a fixed number of particles
// (nothing is allocated while the game runs). Particles are square, PS1-style points that can grow and fade.

import * as THREE from 'three';

/** Pixels per scene unit at distance 1, for the internal render size. The 3D stage sets it on resize. */
export const POINT_SCALE = { value: 260 };

const VERTEX = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 40.0);
  // Unused particles are moved outside the view so they draw nothing.
  if (aColor.a < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
  #include <colorspace_fragment>
}`;

export interface ParticleOptions {
  capacity: number;
  /** Additive light (sparks, flames, pulses) or ordinary see-through dust. */
  additive: boolean;
  /** Downward pull, scene units per second squared. */
  gravity?: number;
  /** Air drag: the fraction of speed lost per second (0 = none, like on the Moon). */
  drag?: number;
}

export class Particles {
  readonly points: THREE.Points;
  readonly capacity: number;
  gravity: number;
  drag: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private rgb: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private alpha0: Float32Array;
  private grow: Float32Array;
  private hot: boolean;
  private next = 0;
  private live = 0;
  private dirty = false;

  constructor(o: ParticleOptions) {
    const n = (this.capacity = o.capacity);
    this.gravity = o.gravity ?? 0;
    this.drag = o.drag ?? 0;
    this.hot = o.additive;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.rgb = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: POINT_SCALE },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    // No draw call at all while the pool is empty.
    this.points.visible = false;
  }

  /** Particles alive right now. */
  get alive() {
    return this.live;
  }

  /** Start one particle (reusing the oldest slot when the pool is full). */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, alpha = 1, grow = 0) {
    const i = this.next;
    this.next = (i + 1) % this.capacity;
    if (this.life[i] <= 0) this.live++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.rgb[i * 3] = color.r;
    this.rgb[i * 3 + 1] = color.g;
    this.rgb[i * 3 + 2] = color.b;
    this.life[i] = this.maxLife[i] = Math.max(0.05, life);
    this.alpha0[i] = alpha;
    this.size[i] = size;
    this.grow[i] = grow;
    this.dirty = true;
    this.points.visible = true;
  }

  update(dt: number) {
    if (!this.dirty && this.live === 0) return;
    const keep = this.drag > 0 ? Math.max(0, 1 - this.drag * dt) : 1;
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      const c = i * 4;
      if (this.life[i] <= 0) {
        this.col[c + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[c + 3] = 0;
        continue;
      }
      live++;
      const p = i * 3;
      this.vel[p] *= keep;
      this.vel[p + 1] = this.vel[p + 1] * keep - this.gravity * dt;
      this.vel[p + 2] *= keep;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i]; // 1 when born, 0 when gone
      // Additive particles start white-hot, then cool to their color.
      const w = this.hot ? Math.max(0, (f - 0.75) * 4) : 0;
      this.col[c] = this.rgb[p] + (1 - this.rgb[p]) * w;
      this.col[c + 1] = this.rgb[p + 1] + (1 - this.rgb[p + 1]) * w;
      this.col[c + 2] = this.rgb[p + 2] + (1 - this.rgb[p + 2]) * w;
      this.col[c + 3] = this.alpha0[i] * Math.min(1, f * 2.5);
    }
    this.live = live;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.dirty = live > 0;
    this.points.visible = live > 0;
  }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
    this.live = 0;
    this.dirty = false;
    this.points.visible = false;
  }
}
