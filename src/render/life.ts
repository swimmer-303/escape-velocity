// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Life around the outpost: a patrol rover, Martian dust devils, the Workshop's construction drones,
// the cargo lander that brings a resupply crate, and the comms beam that carries storm warnings.
// Each piece is a small group the diorama adds once and updates every frame. Nothing here allocates
// in the frame loop (scratch vectors only), so a school Chromebook keeps its frame rate.

import * as THREE from 'three';
import { mat, rand } from './retro';
import type { Particles } from './fx';
import type { CrateId } from '../sim/types';

type Height = (x: number, z: number) => number;

const UP = new THREE.Vector3(0, 1, 0);
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const WHITE = new THREE.Color('#ffffff');
const AMBER = new THREE.Color('#ffb627');
const FLAME = new THREE.Color('#ff9a3c');
const DUST_TAN = new THREE.Color('#d9a066');

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true;
  });
  return o;
}

/** A see-through additive material for flames, beams and pulses (never casts shadows). */
function glowMat(color: THREE.ColorRepresentation, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
}

/** Quadratic Bezier from a to c through a control point lifted above the middle. */
function arc(a: THREE.Vector3, c: THREE.Vector3, lift: number, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  const mx = (a.x + c.x) / 2;
  const my = Math.max(a.y, c.y) + lift;
  const mz = (a.z + c.z) / 2;
  return out.set(u * u * a.x + 2 * u * t * mx + t * t * c.x, u * u * a.y + 2 * u * t * my + t * t * c.y, u * u * a.z + 2 * u * t * mz + t * t * c.z);
}

const smooth = (t: number) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------------------------- rover

/** The rover drives a loop just outside the buildings (the pad is flat out to 11 units; panels reach about 12.5). */
export const ROVER_LOOP = 13.4;

export class Rover {
  readonly group = new THREE.Group();
  private angle = 2.3;
  private lamp: THREE.MeshPhongMaterial;

  constructor() {
    const g = this.group;
    g.name = 'rover';
    const dark = mat('#4a4f63');
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.95), mat('#c9c2b4'));
    body.position.y = 0.42;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.05, 1.05), mat('#26386e', { emissive: new THREE.Color('#0d1a40'), emissiveIntensity: 0.4 }));
    deck.position.y = 0.6;
    for (const sx of [-1, 1]) {
      const wheels = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 1.12), dark);
      wheels.position.set(sx * 0.4, 0.15, 0);
      g.add(wheels);
    }
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), dark);
    mast.position.set(0.18, 0.86, 0.32);
    this.lamp = mat('#202838', { emissive: AMBER.clone(), emissiveIntensity: 0.6 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.14), this.lamp);
    head.position.set(0.18, 1.14, 0.34);
    g.add(body, deck, mast, head);
    shadowed(g);
  }

  /** Drives by day, parks at night (in place, lights dimmed). */
  update(dt: number, day: boolean, reduced: boolean, height: Height) {
    if (day) this.angle += (dt * (reduced ? 0.5 : 1.1)) / ROVER_LOOP;
    const a = this.angle;
    const x = Math.cos(a) * ROVER_LOOP;
    const z = Math.sin(a) * ROVER_LOOP;
    const ax = Math.cos(a + 0.08) * ROVER_LOOP;
    const az = Math.sin(a + 0.08) * ROVER_LOOP;
    this.group.position.set(x, height(x, z), z);
    this.group.lookAt(ax, height(ax, az), az);
    this.lamp.emissiveIntensity = day ? 0.7 : 0.1;
  }
}

// ---------------------------------------------------------------------------------------- dust devils

/** A twisted, striped, open funnel whose alpha fades toward the top (vertex alpha). */
function funnel(rTop: number, rBottom: number, h: number, alpha: number) {
  const radial = 8;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, radial, 5, true);
  geo.translate(0, h / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const light = new THREE.Color('#ecc08a');
  const dark = new THREE.Color('#a8683a');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = y / h;
    // Twist the funnel so the stripes spiral.
    const tw = k * 1.4;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y, x * Math.sin(tw) + z * Math.cos(tw));
    const c = (i % (radial + 1)) % 2 ? dark : light;
    col[i * 4] = c.r;
    col[i * 4 + 1] = c.g;
    col[i * 4 + 2] = c.b;
    col[i * 4 + 3] = alpha * Math.pow(1 - k, 1.3) * Math.min(1, 0.4 + k * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return geo;
}

interface Devil {
  g: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  m: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  life: number;
  dustAcc: number;
}

/** Spinning dust funnels that wander the plains on clear Mars afternoons (never on the Moon: no air). */
export class DustDevils {
  readonly group = new THREE.Group();
  private devils: Devil[] = [];
  private fade = 0;
  private r = rand(424);

  constructor(count = 2) {
    this.group.name = 'dust-devils';
    const outerGeo = funnel(1.5, 0.3, 6.5, 0.55);
    const innerGeo = funnel(0.8, 0.16, 5.2, 0.5);
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const g = new THREE.Group();
      const outer = new THREE.Mesh(outerGeo, m);
      const inner = new THREE.Mesh(innerGeo, m);
      g.add(outer, inner);
      const d: Devil = { g, outer, inner, m, x: 0, z: 0, vx: 0, vz: 0, age: 0, life: 1, dustAcc: 0 };
      this.spawn(d);
      d.age = (d.life * i) / count; // stagger them
      this.devils.push(d);
      this.group.add(g);
    }
    this.group.visible = false;
  }

  private spawn(d: Devil) {
    const r = this.r;
    const a = r() * Math.PI * 2;
    const dist = 17 + r() * 13;
    d.x = Math.cos(a) * dist;
    d.z = Math.sin(a) * dist;
    // Mostly sideways across the plain, drifting a little outward.
    const side = a + (r() < 0.5 ? 1 : -1) * Math.PI * 0.5;
    const speed = 0.8 + r() * 0.8;
    d.vx = Math.cos(side) * speed + Math.cos(a) * 0.2;
    d.vz = Math.sin(side) * speed + Math.sin(a) * 0.2;
    d.age = 0;
    d.life = 11 + r() * 7;
    const s = 0.7 + r() * 0.6;
    d.g.scale.set(s, s * (0.9 + r() * 0.4), s);
  }

  /** How strongly the devils show (0..1), for tests. */
  get level() {
    return this.fade;
  }

  update(dt: number, time: number, active: boolean, height: Height, dust: Particles) {
    this.fade = THREE.MathUtils.clamp(this.fade + (active ? dt : -dt) * 1.5, 0, 1);
    this.group.visible = this.fade > 0.01;
    if (!this.group.visible) return;
    for (let i = 0; i < this.devils.length; i++) {
      const d = this.devils[i];
      d.age += dt;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      // Never wander into the base: fade out early instead.
      if (Math.hypot(d.x, d.z) < 14) d.life = Math.min(d.life, d.age + 2.5);
      if (d.age >= d.life) this.spawn(d);
      const env = Math.max(0, Math.min(1, d.age / 1.5, (d.life - d.age) / 2.5));
      const o = this.fade * env;
      d.m.opacity = o;
      d.g.visible = o > 0.01;
      d.g.position.set(d.x, height(d.x, d.z) - 0.1, d.z);
      d.outer.rotation.y -= dt * 2.6;
      d.inner.rotation.y -= dt * 4.2;
      d.g.rotation.z = Math.sin(time * 0.7 + i * 2) * 0.07;
      // A little dust skirt whirls around the foot.
      if (o > 0.3) {
        d.dustAcc += dt * 9;
        while (d.dustAcc >= 1) {
          d.dustAcc--;
          const a = this.r() * Math.PI * 2;
          const rr = 0.5 * d.g.scale.x;
          dust.emit(d.x + Math.cos(a) * rr, d.g.position.y + 0.2, d.z + Math.sin(a) * rr, -Math.sin(a) * 1.6, 0.6 + this.r() * 0.6, Math.cos(a) * 1.6, 1.2, 0.45, DUST_TAN, 0.35 * o, 0.7);
        }
      }
    }
  }
}


// ------------------------------------------------------------------------------------------- drones

/** Where the Workshop is building: blueprint center, footprint radius and the height built up to so far. */
export interface BuildSite {
  x: number;
  z: number;
  r: number;
  y: number;
}

const HOME = 0;
const OUT = 1;
const WORK = 2;
const BACK = 3;
const REST = 4;

interface Drone {
  g: THREE.Group;
  lamp: THREE.MeshPhongMaterial;
  state: number;
  t: number;
  dur: number;
  ang: number;
  wait: number;
  sparkAcc: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** 1 to 3 little drones carry parts between the Workshop and the blueprint, with welding sparks. */
export class Drones {
  readonly group = new THREE.Group();
  readonly home = new THREE.Vector3();
  private list: Drone[] = [];
  private r = rand(77);

  constructor(max = 3) {
    this.group.name = 'drones';
    const bodyGeo = new THREE.OctahedronGeometry(0.34, 0);
    bodyGeo.scale(1, 0.36, 1);
    const lampGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
    const body = mat('#9aa0b5');
    for (let i = 0; i < max; i++) {
      const g = new THREE.Group();
      const lamp = mat('#302010', { emissive: AMBER.clone(), emissiveIntensity: 1 });
      const b = new THREE.Mesh(bodyGeo, body);
      const l = new THREE.Mesh(lampGeo, lamp);
      l.position.y = -0.1;
      g.add(b, l);
      g.visible = false;
      this.group.add(g);
      this.list.push({ g, lamp, state: HOME, t: 0, dur: 1, ang: (i / max) * Math.PI * 2, wait: i * 0.8, sparkAcc: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  /** Drones out of the hangar right now. */
  get flying() {
    let n = 0;
    for (const d of this.list) if (d.g.visible) n++;
    return n;
  }

  private workPoint(d: Drone, s: BuildSite, out: THREE.Vector3) {
    const rr = s.r + 0.6;
    return out.set(s.x + Math.cos(d.ang) * rr, s.y + 0.7, s.z + Math.sin(d.ang) * rr);
  }

  update(dt: number, time: number, want: number, site: BuildSite | null, sparks: Particles, reduced: boolean) {
    const speed = reduced ? 0.5 : 1;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      const wanted = !!site && i < want;
      const g = d.g;
      switch (d.state) {
        case HOME:
          g.visible = false;
          if (!wanted) {
            d.wait = i * 0.8;
            break;
          }
          d.wait -= dt;
          if (d.wait > 0) break;
          d.state = OUT;
          d.t = 0;
          d.from.copy(this.home);
          d.dur = THREE.MathUtils.clamp(this.home.distanceTo(this.workPoint(d, site!, vA)) / 5, 0.8, 3) / speed;
          g.visible = true;
          break;
        case REST:
          g.position.copy(this.home);
          d.t += dt / d.dur;
          if (!wanted) d.state = HOME;
          else if (d.t >= 1) {
            d.state = OUT;
            d.t = 0;
            d.from.copy(this.home);
            d.dur = THREE.MathUtils.clamp(this.home.distanceTo(this.workPoint(d, site!, vA)) / 5, 0.8, 3) / speed;
          }
          break;
        case OUT:
        case BACK: {
          if (d.state === OUT && !wanted) {
            // Called back halfway: turn around from here.
            d.from.copy(g.position);
            d.state = BACK;
            d.t = 0;
          }
          d.t = Math.min(1, d.t + dt / d.dur);
          const to = d.state === OUT ? this.workPoint(d, site!, vB) : this.home;
          arc(d.from, to, 2.2, smooth(d.t), g.position);
          g.lookAt(to.x, g.position.y, to.z);
          if (d.t >= 1) {
            if (d.state === OUT) {
              d.state = WORK;
              d.t = 0;
              d.dur = (2.2 + this.r() * 1.4) / speed;
            } else {
              d.state = wanted ? REST : HOME;
              d.t = 0;
              d.dur = 0.6;
            }
          }
          break;
        }
        case WORK: {
          const s = site;
          d.t += dt / d.dur;
          if (!s || !wanted || d.t >= 1) {
            d.state = BACK;
            d.t = 0;
            d.from.copy(g.position);
            d.dur = THREE.MathUtils.clamp(g.position.distanceTo(this.home) / 5, 0.8, 3) / speed;
            break;
          }
          d.ang += dt * 0.5 * speed;
          this.workPoint(d, s, g.position);
          g.position.y += reduced ? 0 : Math.sin(time * 3 + i) * 0.08;
          g.lookAt(s.x, g.position.y, s.z);
          // Welding sparks where the drone works on the build line.
          d.sparkAcc += dt * (reduced ? 5 : 16);
          while (d.sparkAcc >= 1) {
            d.sparkAcc--;
            const r = this.r;
            const px = s.x + Math.cos(d.ang) * s.r * 0.85;
            const pz = s.z + Math.sin(d.ang) * s.r * 0.85;
            sparks.emit(px, s.y, pz, (r() - 0.5) * 2.4, 0.8 + r() * 1.8, (r() - 0.5) * 2.4, 0.35 + r() * 0.4, 0.13, AMBER);
          }
          break;
        }
      }
      d.lamp.emissiveIntensity = d.state === WORK ? (reduced ? 1.4 : 1 + Math.abs(Math.sin(time * 14 + i)) * 1.2) : 0.6;
    }
  }
}

// --------------------------------------------------------------------------------------- cargo lander

/** The cargo landing pad, just inside the flat base pad (x, z). */
export const LANDING_PAD: readonly [number, number] = [8.0, -6.4];

const CRATE_COLORS: Record<CrateId | 'none', string> = { food: '#5fb84a', parts: '#e8a23a', panel: '#3a5cb0', none: '#c98a52' };

type LanderState = 'idle' | 'descend' | 'landed' | 'leave';

/** A robot cargo lander: comes down on retro-rocket flames, sets the crate beside the pad, and later flies off. */
export class Lander {
  readonly group = new THREE.Group();
  readonly craft = new THREE.Group();
  readonly crate: THREE.Mesh;
  private crateMats: Record<CrateId | 'none', THREE.MeshPhongMaterial>;
  private flame: THREE.Mesh;
  private flameMat = glowMat('#ffb050', 0.85);
  private state: LanderState = 'idle';
  private t = 0;
  private acc = 0;
  private r = rand(31);
  private padY = 0;

  constructor(height: Height) {
    this.group.name = 'cargo-lander';
    const [x, z] = LANDING_PAD;
    this.padY = height(x, z);
    // The pad stays: a dark disc with an orange ring.
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.85, 0.1, 10), mat('#3b3f52'));
    pad.position.set(x, this.padY + 0.05, z);
    pad.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.35, 10), mat('#e8742a', { emissive: new THREE.Color('#e8742a'), emissiveIntensity: 0.25 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, this.padY + 0.11, z);
    ring.name = 'landing-pad';
    this.group.add(pad, ring);

    // The craft (hidden until a resupply sol).
    const c = this.craft;
    c.name = 'lander-craft';
    const hull = mat('#e9e3d6');
    const metal = mat('#9aa0b5');
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.9, 8), hull);
    body.position.y = 1.25;
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.55, 8), hull);
    top.position.y = 1.98;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 0.4, 6), mat('#4a4f63'));
    bell.position.y = 0.62;
    c.add(body, top, bell);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.09), metal);
      leg.position.set(Math.cos(a) * 1.0, 0.5, Math.sin(a) * 1.0);
      leg.rotation.set(-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45); // feet splay outward
      c.add(leg);
    }
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.6, 6, 1, true), this.flameMat);
    this.flame.rotation.x = Math.PI; // point down
    this.flame.position.y = -0.38;
    this.flame.castShadow = false;
    c.add(this.flame);
    shadowed(c);
    this.flame.castShadow = this.flame.receiveShadow = false;
    c.visible = false;
    this.group.add(c);

    this.crateMats = {
      food: mat(CRATE_COLORS.food),
      parts: mat(CRATE_COLORS.parts),
      panel: mat(CRATE_COLORS.panel, { emissive: new THREE.Color('#0d1a40'), emissiveIntensity: 0.4 }),
      none: mat(CRATE_COLORS.none),
    };
    this.crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), this.crateMats.none);
    this.crate.name = 'supply-crate';
    // Beside the pad, on the side facing the base.
    const toBase = Math.atan2(-z, -x);
    this.crate.position.set(x + Math.cos(toBase) * 2.4, this.padY + 0.3, z + Math.sin(toBase) * 2.4);
    this.crate.rotation.y = 0.4;
    shadowed(this.crate);
    this.crate.visible = false;
    this.group.add(this.crate);
  }

  get phase(): LanderState {
    return this.state;
  }

  /** Bring a crate down now. */
  start(crate?: CrateId) {
    this.crate.material = this.crateMats[crate ?? 'none'];
    this.crate.visible = false;
    this.state = 'descend';
    this.t = 0;
    this.craft.visible = true;
  }

  clear() {
    this.state = 'idle';
    this.craft.visible = false;
    this.crate.visible = false;
  }

  update(dt: number, time: number, reduced: boolean, sparks: Particles, dust: Particles, dustColor: THREE.Color) {
    if (this.state === 'idle') return;
    const [x, z] = LANDING_PAD;
    const c = this.craft;
    const H = 38;
    let burning = false;
    if (this.state === 'descend') {
      const D = reduced ? 1.6 : 4.2;
      this.t += dt / D;
      const s = Math.min(1, this.t);
      const drift = reduced ? 0 : (1 - s) * (1 - s) * 5;
      c.position.set(x + drift, this.padY + H * Math.pow(1 - s, 2.4), z - drift * 0.5);
      burning = true;
      if (s >= 1) {
        this.state = 'landed';
        this.t = 0;
        this.burst(dust, dustColor, reduced ? 8 : 22);
      }
    } else if (this.state === 'landed') {
      this.t += dt;
      c.position.set(x, this.padY, z);
      // The crate pops out beside the lander, then later the lander flies home.
      if (this.t > 0.6) {
        this.crate.visible = true;
        const k = Math.min(1, (this.t - 0.6) / 0.35);
        const sc = reduced ? 1 : Math.max(0.01, k) * (1 + Math.sin(k * Math.PI) * 0.25);
        this.crate.scale.setScalar(sc);
      }
      if (this.t > 14) {
        this.state = 'leave';
        this.t = 0;
      }
    } else if (this.state === 'leave') {
      const D = reduced ? 1.6 : 3.6;
      this.t += dt / D;
      const s = Math.min(1, this.t);
      c.position.set(x - s * s * 4, this.padY + H * Math.pow(s, 2.2), z);
      if (s > 0.15) this.crate.visible = false; // the crew has taken it inside
      burning = true;
      if (s >= 1) this.clear();
    }

    this.flame.visible = burning;
    if (burning) {
      const flick = reduced ? 1 : 0.8 + Math.abs(Math.sin(time * 37)) * 0.35;
      this.flame.scale.set(flick, flick * 1.1, flick);
      // Flame particles stream down from the engine; near the ground they kick up a ring of dust.
      this.acc += dt * (reduced ? 18 : 45);
      const alt = c.position.y - this.padY;
      while (this.acc >= 1) {
        this.acc--;
        const r = this.r;
        sparks.emit(c.position.x + (r() - 0.5) * 0.3, c.position.y + 0.2, c.position.z + (r() - 0.5) * 0.3, (r() - 0.5) * 0.8, -6 - r() * 3, (r() - 0.5) * 0.8, 0.3, 0.32, FLAME, 0.9, 0.9);
        if (alt < 6 && r() < 0.8) {
          const a = r() * Math.PI * 2;
          const sp = 3 + r() * 3;
          dust.emit(x + Math.cos(a) * 0.6, this.padY + 0.15, z + Math.sin(a) * 0.6, Math.cos(a) * sp, 0.3 + r() * 0.6, Math.sin(a) * sp, 1 + r() * 0.6, 0.5, dustColor, 0.55, 1.1);
        }
      }
    }
  }

  private burst(dust: Particles, color: THREE.Color, n: number) {
    const [x, z] = LANDING_PAD;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 2 + this.r() * 2.5;
      dust.emit(x + Math.cos(a) * 1.2, this.padY + 0.2, z + Math.sin(a) * 1.2, Math.cos(a) * sp, 0.4, Math.sin(a) * sp, 1.3, 0.6, color, 0.5, 1);
    }
  }
}

// ------------------------------------------------------------------------------------------ comms beam

/** A faint beam from a dish into the sky, with bright pulses running down it when a storm warning comes in. */
export class CommsBeam {
  readonly group = new THREE.Group();
  private beamMat = glowMat('#5ef2e6', 0);
  private pulseMat = glowMat('#ffffff', 1);
  private beam: THREE.Mesh;
  private pulse: THREE.Mesh;
  private level = 0;
  private want = false;
  private p = -1;
  private queued = 0;
  private wait = 0;
  private len = 60;
  private key = '';
  /** Pulses that have reached the dish so far. */
  arrivals = 0;

  constructor() {
    this.group.name = 'comms-beam';
    const geo = new THREE.CylinderGeometry(0.4, 0.06, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    this.beamMat.side = THREE.DoubleSide;
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.pulse = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), this.pulseMat);
    this.pulse.scale.set(1, 3.2, 1);
    this.beam.frustumCulled = false;
    this.group.add(this.beam, this.pulse);
    this.group.visible = false;
    this.pulse.visible = false;
  }

  /** True while the beam is (at least partly) showing. */
  get showing() {
    return this.group.visible;
  }

  /** Point the beam from `from` along `dir` (unit) for `len` units; `pulses` arrive one after another. */
  show(key: string, from: THREE.Vector3, dir: THREE.Vector3, len: number, color: THREE.ColorRepresentation, pulses: number) {
    this.group.position.copy(from);
    this.group.quaternion.setFromUnitVectors(UP, dir);
    this.len = len;
    this.beam.scale.set(1, len, 1);
    this.beamMat.color.set(color);
    this.pulseMat.color.set(color).lerp(WHITE, 0.5);
    if (this.want && this.key === key) return;
    this.key = key;
    this.want = true;
    this.queued = pulses;
    this.wait = 0.3;
  }

  hide() {
    this.want = false;
    this.key = '';
    this.queued = 0;
  }

  /** Returns true on the frame a pulse reaches the dish. */
  update(dt: number, time: number, reduced: boolean): boolean {
    this.level = THREE.MathUtils.clamp(this.level + (this.want ? dt * 1.5 : -dt * 1.2), 0, 1);
    this.group.visible = this.level > 0.01 || this.p >= 0;
    this.beamMat.opacity = this.level * (reduced ? 0.2 : 0.16 + Math.sin(time * 5) * 0.04);
    let arrived = false;
    if (this.p >= 0) {
      this.p += dt / (reduced ? 2.2 : 1.1);
      if (this.p >= 1) {
        this.p = -1;
        arrived = true;
        this.arrivals++;
      }
    } else if (this.want) {
      this.wait -= dt;
      if (this.wait <= 0) {
        if (this.queued > 0) {
          this.queued--;
          this.p = 0;
          this.wait = 0.25;
        } else if (!reduced) {
          // While the warning stands, another pulse now and then.
          this.p = 0;
          this.wait = 3.5;
        }
      }
    }
    this.pulse.visible = this.p >= 0;
    if (this.p >= 0) this.pulse.position.set(0, this.len * (1 - this.p), 0);
    return arrived;
  }
}

/** Scratch helper for callers: the world position of a point on an object. */
export function worldPoint(o: THREE.Object3D, x: number, y: number, z: number, out: THREE.Vector3) {
  o.updateWorldMatrix(true, false);
  return out.set(x, y, z).applyMatrix4(o.matrixWorld);
}
