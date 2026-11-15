// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The low-poly outpost. Built from code (no model files), so it's tiny to download.
// The base visibly grows: every upgrade has its own piece, and the Workshop's current
// project shows as a see-through blueprint that fills in as the crew builds it.
// On Mars the ground around the base is real Gale Crater terrain (see gale.ts), or, at the ice landing site,
// the real, much flatter plains of Arcadia Planitia with frost patches (see arcadia.ts); on the Moon it is
// made-up gray, cratered regolith with the Earth in the sky (see moon.ts).
// The base is alive (see life.ts): a rover on patrol, dust devils on clear Mars afternoons, drones
// building the blueprint, a cargo lander on resupply sols, a comms beam for storm warnings, the crew
// running for the shelter, and a launch with countdown lights, a dust ring and a booster that drops away.
// Every part of the base can be tapped: pick() and focusFrame() tell the 3D stage what to look at.

import * as THREE from 'three';
import { mat, rand } from './retro';
import { marsHeight, GROUND_RADIUS } from './gale';
import { arcadiaHeight, frostAmount } from './arcadia';
import { moonHeight, moonTone, moonCraters, buildLitEarth, EARTH_POS, EARTH_RADIUS } from './moon';
import { Particles } from './fx';
import { DustMotes, GroundSpots, Halos, type DustWeather, type Quality } from './atmosphere';
import { Rover, DustDevils, Drones, Lander, CommsBeam, worldPoint, ROVER_LOOP, type BuildSite } from './life';
import { RoverPet, PET_HOME } from './pet';
import { paintPixels, PAINT_W, PAINT_H, ROCKET_SPAN } from './paint';
import type { Cosmetics, FocusKey, StageCue, StageScene } from './stage';
import type { UpgradeId, Levels } from '../sim/upgrades';

export type Site = NonNullable<StageScene['site']>;
/** Where on Mars the base sits: Gale Crater (default) or the ice landing site, Arcadia Planitia. */
export type MarsLanding = 'gale' | 'arcadia';

const C = {
  rust: '#8a3a1c',
  oxide: '#b2552a',
  dust: '#c98a52',
  sand: '#d9a066',
  soil: '#6e3418',
  hab: '#e9e3d6',
  habShade: '#c9c2b4',
  metal: '#9aa0b5',
  dark: '#4a4f63',
  panel: '#26386e',
  glass: '#7ddc5a',
  cyan: '#5ef2e6',
  amber: '#ffb627',
  orange: '#e8742a',
  white: '#f4f0e6',
};

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Where every piece of the base sits (x, z). */
const SPOT = {
  hab: [0, 0],
  o2: [4.2, -1.2],
  moxie2: [6.6, -2.6],
  greenhouse: [-4.2, -0.6],
  dome2: [-4.6, 3.4],
  shelter: [1.2, 4.4],
  rocket: [8.4, 3.6],
  monitor: [2.6, -4.2],
  battery: [5.2, 1.6],
  reactor: [-2.5, -8],
  workshop: [-0.8, -4.4],
} as const;

/** The shelter door, where the crew runs when a storm is coming. */
const SHELTER_DOOR = new THREE.Vector3(SPOT.shelter[0], 0, SPOT.shelter[1] + 2.2);

/** Which way the dishes point: the Earth antenna (on Mars) and the radiation monitor (at the Sun's side of the sky). */
const EARTH_DIR_MARS = new THREE.Vector3(-0.45, 0.8, -0.35).normalize();
const MONITOR_DIR = new THREE.Vector3(0.5, 0.8, -0.3).normalize();
const DOWN = new THREE.Vector3(0, -1, 0);

/** The launch cinematic, as fractions of its length: countdown lights, ignition, liftoff, staging, upper-stage relight. */
export const LAUNCH_TIMELINE = { count: [0.03, 0.12, 0.2], ignite: 0.27, liftoff: 0.32, stage: 0.66, relight: 0.7 } as const;
const LAUNCH_HEIGHT = 110;

/** Names for the parts you can tap, in "Look at" menu order. */
export const FOCUS_LABELS: Record<FocusKey, string> = {
  o2: 'O2 Plant',
  greenhouse: 'Greenhouse',
  heaters: 'Habitat and heaters',
  shelter: 'Storm Shelter',
  monitor: 'Radiation Monitor',
  battery: 'Battery',
  build: 'Workshop',
  rocket: 'Rocket',
  panels: 'Solar panels',
  reactor: 'Reactor',
};
export const FOCUS_ORDER = Object.keys(FOCUS_LABELS) as FocusKey[];

const RED = new THREE.Color('#ff3b2f');
const AMBER = new THREE.Color(C.amber);
const GREEN = new THREE.Color('#7ddc5a');
const MARS_DUST = new THREE.Color('#d9a066');
const MOON_DUST = new THREE.Color('#a19f99');
const vT = new THREE.Vector3();
const vU = new THREE.Vector3();
const PART_BOX = new THREE.Box3();
const PULSE_CYAN = new THREE.Color(C.cyan);
const PULSE_VIOLET = new THREE.Color('#c58bff');

/** Hull colors that turn a little brighter on the Moon (no red dust settling on them). */
const HULL_COLORS = new Set([C.hab, C.habShade, C.white, '#d8d4cc'].map((c) => new THREE.Color(c).getHex()));
const WHITE = new THREE.Color('#ffffff');
const EARTH_GLOW = new THREE.Color('#6f9dff');

/** Rocket hull UVs: v runs from the bottom of the booster to the tip of the nose, so one paint picture wraps the whole rocket. */
function rocketUV(m: THREE.Mesh) {
  const pos = m.geometry.attributes.position as THREE.BufferAttribute;
  const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
  const span = ROCKET_SPAN.top - ROCKET_SPAN.bottom;
  for (let i = 0; i < pos.count; i++) uv.setY(i, THREE.MathUtils.clamp((pos.getY(i) + m.position.y - ROCKET_SPAN.bottom) / span, 0, 1));
  uv.needsUpdate = true;
}

/**
 * A round ground disc: a grid warped so cells are about `nearCell` wide around the base and grow
 * toward the edge, with the corners pulled in onto the circle (so the horizon is round, not square).
 */
function groundGeometry(radius: number, segments: number, nearCell: number, height: (x: number, z: number) => number, color: (x: number, z: number, y: number) => THREE.Color) {
  const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const c = (nearCell * segments) / 2; // slope of the warp at the center
  const warp = (u: number) => u * (c + (radius - c) * u * u);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    let x = warp(pos.getX(i));
    let z = warp(pos.getZ(i));
    const r = Math.hypot(x, z);
    if (r > radius) {
      x *= radius / r;
      z *= radius / r;
    }
    const y = height(x, z);
    pos.setXYZ(i, x, y, z);
    const col = color(x, z, y);
    colors.push(col.r, col.g, col.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

// ------------------------------------------------------------------ ground dressing (looks only: never changes the heights)

/** Smooth made-up noise, 0..1, for patches of color on the ground. */
function noise2(x: number, z: number) {
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * ux;
  const b = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * ux;
  return a + (b - a) * uz;
}
function fbm(x: number, z: number) {
  return noise2(x, z) * 0.6 + noise2(x * 2.07 + 5.2, z * 2.07 + 1.3) * 0.28 + noise2(x * 4.3 + 9.1, z * 4.3 - 3.7) * 0.12;
}

/** How steep the ground is at (x, z): rise over run. */
function slopeAt(height: (x: number, z: number) => number, x: number, z: number) {
  const e = 0.6;
  return Math.hypot(height(x + e, z) - height(x - e, z), height(x, z + e) - height(x, z - e)) / (2 * e);
}

const smooth = THREE.MathUtils.smoothstep;

/** Rock shapes: a chunky boulder, a rounder one and a flat slab (shared by every site). */
const ROCK_GEOS = [new THREE.DodecahedronGeometry(0.35, 0), new THREE.IcosahedronGeometry(0.33, 0), new THREE.DodecahedronGeometry(0.34, 0).scale(1.3, 0.45, 1)];

interface RockField {
  seed: number;
  count: number;
  rMin: number;
  rMax: number;
  sizeMin: number;
  sizeMax: number;
  tones: string[];
  shadows: boolean;
  /** Extra spots (x, z, size) to place first, such as blocks thrown out around fresh craters. */
  extra?: Array<[number, number, number]>;
}

/**
 * Rocks scattered over the ground, as instanced meshes (one draw call per shape, however many rocks): mostly small
 * ones, a few big ones, each a slightly different tone. They stay off the base pad and the rover's patrol track.
 */
function scatterRocks(height: (x: number, z: number) => number, f: RockField) {
  const r = rand(f.seed);
  const spots: Array<[number, number, number]> = [...(f.extra ?? [])];
  for (let tries = 0; spots.length < f.count + (f.extra?.length ?? 0) && tries < f.count * 6; tries++) {
    const a = r() * Math.PI * 2;
    const d = f.rMin + Math.sqrt(r()) * (f.rMax - f.rMin);
    if (Math.abs(d - ROVER_LOOP) < 0.9) continue;
    spots.push([Math.cos(a) * d, Math.sin(a) * d, f.sizeMin + (f.sizeMax - f.sizeMin) * r() ** 3]);
  }
  const tones = f.tones.map((t) => new THREE.Color(t));
  const out: THREE.InstancedMesh[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const perShape: Array<Array<[number, number, number]>> = ROCK_GEOS.map(() => []);
  for (const spot of spots) perShape[Math.floor(r() * ROCK_GEOS.length)].push(spot);
  perShape.forEach((list, k) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(ROCK_GEOS[k], mat('#ffffff'), list.length);
    im.name = 'rocks';
    list.forEach(([x, z, size], i) => {
      const y = height(x, z);
      p.set(x, y + 0.08 * size - 0.06 * size * slopeAt(height, x, z), z);
      s.set(size * (0.8 + r() * 0.4), size * (0.45 + r() * 0.5), size * (0.8 + r() * 0.4));
      q.setFromEuler(e.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6));
      im.setMatrixAt(i, m4.compose(p, q, s));
      im.setColorAt(i, c.copy(tones[Math.floor(r() * tones.length)]).multiplyScalar(0.85 + r() * 0.3));
    });
    im.castShadow = f.shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  });
  return out;
}

/** Pairs of wheel tracks along the rover's patrol loop, following the ground (slightly darker, half see-through). */
function roverTracks(height: (x: number, z: number) => number, color: string, alpha: number) {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const tint = new THREE.Color(color);
  const segs = 180;
  for (const off of [-0.3, 0.3]) {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      for (const w of [-0.09, 0.09]) {
        const rr = ROVER_LOOP + off + w;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        pos.push(x, height(x, z) + 0.035, z);
        col.push(tint.r, tint.g, tint.b, alpha * (0.75 + 0.25 * Math.sin(a * 23 + off * 9)));
      }
      if (i < segs) {
        const v = base + i * 2;
        index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, trackMaterial());
  m.name = 'rover-tracks';
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

function trackMaterial() {
  return mat('#ffffff', { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, flatShading: false });
}

/** Worn footpaths across the flat base pad, from the habitat door out to the places the crew walks to. */
const FOOTPATHS: Array<Array<[number, number]>> = [
  [[0, 2.9], [0.6, 4.6], [1.2, 6.6]], // the shelter door
  [[0, 2.9], [3.2, 3.2], [6.6, 3.6]], // the launch pad
  [[0, 2.9], [-1.6, 1.6], [-2.4, -0.4]], // the greenhouse
  [[0.8, 2.6], [2.6, 0.4], [3.4, -0.6]], // the O2 plant
  [[-0.6, 2.7], [-3.4, 2.6], [-6.8, 2.6]], // the solar panels
  [[-1.2, -2.2], [-1, -3.2]], // the Workshop
];

function footpaths() {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const half = 0.34;
  for (const path of FOOTPATHS) {
    // Walk along the path in short steps; each step is a strip of three columns (soft edge, middle, soft edge).
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < path.length - 1; k++) {
      const [ax, az] = path[k];
      const [bx, bz] = path[k + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
    }
    pts.push(path[path.length - 1]);
    const base = pos.length / 3;
    pts.forEach(([x, z], i) => {
      const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
      const [px, pz] = pts[Math.max(0, i - 1)];
      let dx = nx - px;
      let dz = nz - pz;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const ends = Math.min(1, Math.min(i, pts.length - 1 - i) / 2);
      for (const side of [-1, 0, 1]) {
        pos.push(x - dz * half * side, 0.02, z + dx * half * side);
        col.push(1, 1, 1, side === 0 ? 0.55 * ends : 0);
      }
      if (i < pts.length - 1) {
        const v = base + i * 3;
        index.push(v, v + 1, v + 3, v + 1, v + 4, v + 3, v + 1, v + 2, v + 4, v + 2, v + 5, v + 4);
      }
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, trackMaterial());
  m.name = 'footpaths';
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

/** Joins non-indexed geometries with positions (and normals) into one, for a single draw call. */
function mergeFlat(list: THREE.BufferGeometry[]) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Solar panel rows: 3 at the start, then one more for each panel upgrade. */
const PANEL_SLOTS: Array<[number, number]> = [
  [-8.5, 0.8],
  [-8.5, 2.6],
  [-8.5, 4.4],
  [-8.5, 6.2],
  [-6.2, 6.6],
  [-8.5, -1.0],
  [-6.2, 8.4],
];

export class Diorama {
  readonly group = new THREE.Group();
  readonly sunLight: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  private upgrades: Record<UpgradeId, THREE.Object3D[]>;
  private panels: THREE.Group[] = [];
  private ghost = new THREE.Group();
  /** Blueprint: the part built so far (below the build line) is bright, the rest faint. */
  private clipBuilt = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private clipTodo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ghostMat = new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.6, clippingPlanes: [this.clipBuilt] });
  private ghostFaintMat = new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.13, depthWrite: false, clippingPlanes: [this.clipTodo] });
  private ghostSrc: THREE.Object3D | null = null;
  /** The glowing line where the blueprint is being built up to. */
  private scan: THREE.LineLoop;
  private ghostBox = new THREE.Box3();
  private cut = 0;
  private cutTarget = 0;
  private buildSite: BuildSite | null = null;
  private glow: Record<'greenhouse' | 'hab' | 'heater' | 'shelter' | 'o2' | 'fuel' | 'monitor' | 'battery' | 'reactor', THREE.MeshPhongMaterial[]> = {
    greenhouse: [],
    hab: [],
    heater: [],
    shelter: [],
    o2: [],
    fuel: [],
    monitor: [],
    battery: [],
    reactor: [],
  };
  private fuelBar: THREE.Mesh;
  private rocket = new THREE.Group();
  private fan: THREE.Object3D;
  private crew: Array<{ obj: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number; speed: number; running: boolean; inside: boolean }> = [];
  private crewCount = 0;
  private scene?: StageScene;
  private prevLevels?: Levels;
  private pops: Array<{ obj: THREE.Object3D; t: number }> = [];
  /** Dust in the Mars air: drifting specks, or streaks of blowing dust in a storm (see atmosphere.ts). */
  readonly motes = new DustMotes();
  /** Its color right now (the 3D stage darkens it at night and reddens it in a storm). */
  readonly moteColor = new THREE.Color('#e8c08a');
  /** A cool light from the side away from the Sun: the sky's fill on Mars, earthshine on the Moon. */
  readonly fillLight: THREE.DirectionalLight;
  /** Glows around the base's lamps, and the pools of light they throw on the ground at night. */
  private halos = new Halos(40);
  private pools = new GroundSpots(24);
  /** Soft blob shadows under the buildings, used instead of real shadows on the 'low' quality tier. */
  private blobs = new GroundSpots(16, true);
  private glowSrc: Array<{ m: THREE.MeshPhongMaterial; root: THREE.Object3D; halo: number; haloK: number; pool: number; poolK: number; color?: THREE.Color }> = [];
  private blobSrc: Array<{ root: THREE.Object3D; i: number }> = [];
  /** How dark it is around the base (0 bright day .. 1 night), for the lamp glows. Set by the 3D stage. */
  gloom = 0;
  private quality: Quality = 'high';
  private paths: THREE.Mesh;
  private earthSun?: (dir: THREE.Vector3) => void;
  private earthGlow?: Halos;
  private trail: THREE.Points;
  private night = 0;
  private storming = 0;
  private site: Site = 'mars';
  private landing: MarsLanding = 'gale';
  private marsGround: THREE.Group;
  /** Built the first time the Moon is shown. */
  private moonGround?: THREE.Group;
  /** Built the first time the ice landing site is shown. */
  private arcadiaGround?: THREE.Group;
  private hull: Array<{ m: THREE.MeshPhongMaterial; base: THREE.Color }> = [];

  /** Sparks, flames and radio pulses (additive), and dust puffs: one draw call each, fixed pools. */
  readonly sparks = new Particles({ capacity: 160, additive: true, gravity: 5 });
  readonly puffs = new Particles({ capacity: 200, additive: false, gravity: -0.15, drag: 1.4 });
  readonly rover = new Rover();
  readonly devils = new DustDevils();
  readonly drones = new Drones();
  readonly lander: Lander;
  readonly beam = new CommsBeam();
  private dayT = 0.25;
  private reducedMotion = false;
  /** Seconds left of the crew's run to the shelter before a storm. */
  private rush = 0;
  private commsDish!: THREE.Object3D;
  private monitorDish!: THREE.Object3D;
  private commsLight!: THREE.MeshPhongMaterial;
  private dishFlash = 0;
  private beamFrom: 'monitor' | 'earth' = 'earth';
  private readonly heightAt = (x: number, z: number) => this.height(x, z);
  /** What you can tap, by key. */
  private targets = new Map<FocusKey, THREE.Object3D[]>();
  private pickRoots: THREE.Object3D[] = [];
  private pickKeys = new Map<THREE.Object3D, FocusKey>();
  private hits: THREE.Intersection[] = [];
  private focusBox = new THREE.Box3();
  // Launch pieces.
  private towerLights: THREE.MeshPhongMaterial[] = [];
  private rocketFlame!: THREE.Mesh;
  private plume!: THREE.PointLight;
  private boosterParts: THREE.Object3D[] = [];
  private booster = new THREE.Group();
  private launchState = { ignited: false, staged: false, stageY: 0 };
  // The Hangar's looks (see setCosmetics). Every astronaut shares these materials: a white and an orange suit
  // taking turns until the player picks a suit for the whole crew.
  private suitMats = [mat(C.white), mat(C.orange)];
  private packMat = mat(C.habShade);
  private helmetMat = mat(C.white);
  private visorMat = mat('#202838', { emissive: new THREE.Color(C.amber), emissiveIntensity: 0.4 });
  private suitGlow = false;
  private rocketHull!: THREE.MeshPhongMaterial;
  private rocketFins!: THREE.MeshPhongMaterial;
  private rocketPaint: THREE.DataTexture | null = null;
  private pet: RoverPet | null = null;

  constructor() {
    this.ambient = new THREE.HemisphereLight('#f2d2a8', '#6b2e16', 1.1);
    this.sunLight = new THREE.DirectionalLight('#fff1d6', 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(512, 512);
    const sc = this.sunLight.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 80;
    this.sunLight.shadow.bias = -0.002;
    this.sunLight.shadow.normalBias = 0.02;
    this.fillLight = new THREE.DirectionalLight('#8fa6d8', 0.3);
    this.fillLight.position.set(-20, 14, 18);
    this.group.add(this.ambient, this.sunLight, this.sunLight.target, this.fillLight);

    this.marsGround = this.buildMarsGround();
    this.group.add(this.marsGround);
    const hab = this.buildHab();
    this.group.add(hab);
    const o2 = this.buildO2();
    this.fan = o2.getObjectByName('fan')!;
    this.group.add(o2);
    const greenhouse = this.buildGreenhouse(SPOT.greenhouse, 1.8);
    this.group.add(greenhouse);
    const shelter = this.buildShelter();
    this.group.add(shelter);
    const workshop = this.buildWorkshop();
    this.group.add(workshop);
    const { pad, rocket, bar } = this.buildRocket();
    this.group.add(pad);
    this.rocket = rocket;
    this.fuelBar = bar;
    this.group.add(rocket);
    this.booster.name = 'booster';
    this.booster.visible = false;
    this.group.add(this.booster);

    for (let i = 0; i < PANEL_SLOTS.length; i++) {
      const p = this.buildPanelRow(PANEL_SLOTS[i]);
      p.visible = i < 3;
      this.panels.push(p);
      this.group.add(p);
    }

    this.upgrades = {
      panel: [],
      monitor: [this.buildMonitor()],
      battery: [this.buildBattery()],
      berm: [this.buildBerm()],
      dome2: [this.buildGreenhouse(SPOT.dome2, 1.6)],
      moxie2: [this.buildMoxie2()],
      reactor: [this.buildReactor()],
    };
    for (const list of Object.values(this.upgrades)) for (const o of list) (o.visible = false), this.group.add(o);

    this.ghost.name = 'blueprint';
    this.group.add(this.ghost);
    this.scan = this.buildScanLine();
    this.group.add(this.scan);
    for (let i = 0; i < 6; i++) this.crew.push(this.buildAstronaut(i));

    this.group.add(this.motes.points);
    this.paths = footpaths();
    this.group.add(this.paths, this.pools.mesh, this.blobs.mesh, this.halos.points);
    this.blobs.mesh.visible = false;
    this.buildGlows(hab, o2, greenhouse, shelter, workshop, pad);
    this.trail = this.buildTrail();
    this.group.add(this.trail);

    // Life around the base.
    this.lander = new Lander(this.heightAt);
    this.drones.home.set(SPOT.workshop[0], this.height(SPOT.workshop[0], SPOT.workshop[1]) + 1.45, SPOT.workshop[1]);
    this.rover.update(0, true, false, this.heightAt);
    this.group.add(this.rover.group, this.devils.group, this.drones.group, this.lander.group, this.beam.group, this.sparks.points, this.puffs.points);

    // What you can tap.
    const add = (key: FocusKey, ...objs: THREE.Object3D[]) => {
      this.targets.set(key, objs);
      for (const o of objs) {
        this.pickRoots.push(o);
        this.pickKeys.set(o, key);
      }
    };
    add('o2', o2, ...this.upgrades.moxie2);
    add('greenhouse', greenhouse, ...this.upgrades.dome2);
    add('heaters', hab);
    add('shelter', shelter, ...this.upgrades.berm);
    add('monitor', ...this.upgrades.monitor);
    add('battery', ...this.upgrades.battery);
    add('build', workshop, this.ghost);
    add('rocket', rocket, pad);
    add('panels', ...this.panels);
    add('reactor', ...this.upgrades.reactor);

    // Remember the white hull materials, so the Moon can brighten them.
    const seen = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhongMaterial | undefined;
      if (!m || !(m as THREE.MeshPhongMaterial).isMeshPhongMaterial || seen.has(m) || o.parent === this.marsGround) return;
      seen.add(m);
      if (HULL_COLORS.has(m.color.getHex())) this.hull.push({ m, base: m.color.clone() });
    });
  }

  // ------------------------------------------------------------------ building pieces

  /** Height of the ground at (x, z), for the cold open's camera (it never dips under a hill). */
  groundAt(x: number, z: number): number {
    return this.height(x, z);
  }

  /** Ground height. Every site keeps the base pad (within 11 units) perfectly flat at 0. */
  private height(x: number, z: number) {
    if (this.site === 'moon') return moonHeight(x, z);
    return this.landing === 'arcadia' ? arcadiaHeight(x, z) : marsHeight(x, z);
  }

  /**
   * Gale Crater from real Mars Trek elevations (Mount Sharp included). Only the colors are dressed up: light dusty
   * flats, darker rocky slopes, faint layers on the high ground (Mount Sharp really is built of layered rock), patches
   * of darker sand, rocks and the rover's tracks. The heights are exactly marsHeight's.
   */
  private buildMarsGround() {
    const g = new THREE.Group();
    g.name = 'mars-ground';
    const r = rand(7);
    const flat = new THREE.Color('#c27a46');
    const flat2 = new THREE.Color('#b0653a');
    const rock = new THREE.Color('#6e2f17');
    const sand = new THREE.Color('#7d4632');
    const pad = new THREE.Color('#c98a58');
    const high = new THREE.Color('#d59a66');
    const geo = groundGeometry(GROUND_RADIUS, 72, 1.8, marsHeight, (x, z, y) => {
      const rr = Math.hypot(x, z);
      const slope = slopeAt(marsHeight, x, z);
      const c = flat.clone().lerp(flat2, fbm(x * 0.09, z * 0.09));
      c.lerp(high, smooth(y, 2, 9) * 0.45);
      c.lerp(rock, smooth(slope, 0.12, 0.5) * 0.85);
      c.lerp(sand, smooth(fbm(x * 0.045 + 9, z * 0.045 - 3), 0.58, 0.72) * (1 - smooth(slope, 0.05, 0.25)) * smooth(rr, 18, 30) * 0.8);
      if (y > 2.5) c.multiplyScalar(1 + 0.07 * Math.sin(y * 2.3));
      c.lerp(pad, (1 - smooth(rr, 8, 12)) * 0.5);
      return c.multiplyScalar(0.94 + r() * 0.12);
    });
    const ground = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
    ground.receiveShadow = true;
    g.add(ground);
    const tones = ['#6e3418', '#5a2a14', '#7f3f1f', '#4f2617'];
    g.add(
      ...scatterRocks(marsHeight, { seed: 71, count: 150, rMin: 11, rMax: 30, sizeMin: 0.35, sizeMax: 1.9, tones, shadows: true }),
      ...scatterRocks(marsHeight, { seed: 72, count: 70, rMin: 30, rMax: 62, sizeMin: 1.2, sizeMax: 3.6, tones, shadows: false }),
      ...scatterRocks(marsHeight, { seed: 73, count: 180, rMin: 10.8, rMax: 24, sizeMin: 0.1, sizeMax: 0.32, tones, shadows: false }),
      roverTracks(marsHeight, '#4a2010', 0.42),
    );
    return g;
  }

  /**
   * Arcadia Planitia from real Mars Trek elevations: wide, flat plains (no Mount Sharp), a little paler, with
   * patches of thin frost (made up for the look) and fewer rocks.
   */
  private buildArcadiaGround() {
    const g = new THREE.Group();
    g.name = 'arcadia-ground';
    const r = rand(4666);
    const a = new THREE.Color('#a2623f');
    const b = new THREE.Color('#b47c56');
    const dark = new THREE.Color('#84492f');
    const frost = new THREE.Color('#e3e8ec');
    const geo = groundGeometry(GROUND_RADIUS, 72, 1.8, arcadiaHeight, (x, z) => {
      const c = a.clone().lerp(b, fbm(x * 0.08, z * 0.08));
      c.lerp(dark, smooth(fbm(x * 0.05 - 4, z * 0.05 + 7), 0.6, 0.75) * 0.6);
      c.lerp(frost, frostAmount(x, z) * 0.8);
      return c.multiplyScalar(0.94 + r() * 0.12);
    });
    const ground = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
    ground.receiveShadow = true;
    g.add(ground);

    // Frost patches: thin, ragged white shapes lying on the ground, mostly where the ground is already frosty.
    // All of them are one mesh (one draw call).
    const shapes: THREE.BufferGeometry[] = [];
    for (let tries = 0; shapes.length < 40 && tries < 500; tries++) {
      const ang = r() * Math.PI * 2;
      const d = 13 + r() * 34;
      const x = Math.cos(ang) * d;
      const z = Math.sin(ang) * d;
      if (frostAmount(x, z) < 0.15 && r() > 0.25) continue;
      const sides = 9;
      const radius = 0.4 + r() * 1.3;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const k = radius * (0.6 + r() * 0.5);
        pts.push(new THREE.Vector2(Math.cos(t) * k * (1.2 + r() * 0.4), Math.sin(t) * k * 0.8));
      }
      const shape = new THREE.ShapeGeometry(new THREE.Shape(pts));
      shape.rotateX(-Math.PI / 2);
      shape.rotateY(r() * Math.PI);
      shape.translate(x, arcadiaHeight(x, z) + 0.06, z);
      shapes.push(shape.index ? shape.toNonIndexed() : shape);
    }
    const frostMat = mat('#e8eff5', { transparent: true, opacity: 0.5, emissive: new THREE.Color('#9fb3c5'), emissiveIntensity: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const patches = new THREE.Mesh(mergeFlat(shapes), frostMat);
    patches.name = 'frost';
    patches.receiveShadow = true;
    patches.renderOrder = 1;
    g.add(patches);

    // A few rocks: these plains are smooth.
    const tones = ['#6e3418', '#5e3020', '#7a4429'];
    g.add(
      ...scatterRocks(arcadiaHeight, { seed: 81, count: 40, rMin: 11, rMax: 34, sizeMin: 0.3, sizeMax: 1.2, tones, shadows: true }),
      ...scatterRocks(arcadiaHeight, { seed: 82, count: 90, rMin: 10.8, rMax: 26, sizeMin: 0.08, sizeMax: 0.26, tones, shadows: false }),
      roverTracks(arcadiaHeight, '#5a2c18', 0.38),
    );
    return g;
  }

  /**
   * Made-up Moon ground: gray regolith, lots of craters (bright fresh rims, darker floors), boulders thrown out
   * around the fresh craters, and the Earth in the sky. No haze: with no air, far hills are as crisp as near ones.
   */
  private buildMoonGround() {
    const g = new THREE.Group();
    g.name = 'moon-ground';
    const r = rand(1972);
    const greys = ['#8d8b87', '#7d7c79', '#96948f'].map((c) => new THREE.Color(c));
    const bright = new THREE.Color('#cbc9c3');
    const dark = new THREE.Color('#4a4a4d');
    const geo = groundGeometry(110, 84, 1.2, moonHeight, (x, z) => {
      const base = greys[Math.floor(r() * greys.length)].clone().lerp(greys[2], fbm(x * 0.1, z * 0.1) * 0.6);
      const t = moonTone(x, z);
      const c = t >= 0 ? base.lerp(bright, t * 2.2) : base.lerp(dark, -t * 2.4);
      // Steep crater walls show fresher, brighter regolith.
      c.lerp(bright, smooth(slopeAt(moonHeight, x, z), 0.25, 0.7) * 0.3);
      return c.multiplyScalar(0.93 + fbm(x * 0.35, z * 0.35) * 0.14);
    });
    const ground = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
    ground.receiveShadow = true;
    g.add(ground);

    // Boulders: scattered, plus blocks thrown out around the rims of the small fresh craters.
    const ejecta: Array<[number, number, number]> = [];
    for (const c of moonCraters()) {
      if (c.r > 2.7 || Math.hypot(c.x, c.z) > 45) continue;
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = c.r * (1.05 + r() * 0.45);
        ejecta.push([c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, 0.3 + r() * 0.7]);
      }
    }
    const tones = ['#5d5d60', '#6b6a68', '#4c4c50', '#7a7976'];
    g.add(
      ...scatterRocks(moonHeight, { seed: 91, count: 110, rMin: 11, rMax: 40, sizeMin: 0.35, sizeMax: 1.8, tones, shadows: true, extra: ejecta }),
      ...scatterRocks(moonHeight, { seed: 92, count: 200, rMin: 10.8, rMax: 26, sizeMin: 0.08, sizeMax: 0.3, tones, shadows: false }),
      roverTracks(moonHeight, '#3a3a3e', 0.45),
    );

    // The Earth, lit by the Sun (so it shows phases), with a soft blue glow around it.
    const earth = buildLitEarth();
    this.earthSun = earth.setSun;
    g.add(earth.mesh);
    this.earthGlow = new Halos(1, 160);
    this.earthGlow.add(EARTH_POS.x, EARTH_POS.y, EARTH_POS.z, EARTH_RADIUS * 7);
    this.earthGlow.points.name = 'earth-glow';
    this.earthGlow.points.renderOrder = -1;
    g.add(this.earthGlow.points);
    return g;
  }

  private buildHab() {
    const g = new THREE.Group();
    const [x, z] = SPOT.hab;
    const dome = mesh(new THREE.IcosahedronGeometry(2.3, 1), mat(C.hab), 0, 0.2, 0);
    dome.scale.y = 0.85;
    g.add(dome);
    const ring = mesh(new THREE.CylinderGeometry(2.35, 2.45, 0.5, 12), mat(C.habShade), 0, 0.25, 0);
    g.add(ring);
    const winMat = mat('#3a2a1a', { emissive: new THREE.Color(C.amber), emissiveIntensity: 0.3 });
    this.glow.hab.push(winMat);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const w = mesh(new THREE.BoxGeometry(0.5, 0.35, 0.1), winMat, Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2);
      w.lookAt(0, 0.9, 0);
      g.add(w);
    }
    const door = mesh(new THREE.BoxGeometry(1, 1.2, 1.2), mat(C.habShade), 0, 0.6, 2.6);
    g.add(door);
    // Heater vents: glow orange when the heaters have power.
    const ventMat = mat('#3b2b23', { emissive: new THREE.Color(C.orange), emissiveIntensity: 0 });
    this.glow.heater.push(ventMat);
    for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), ventMat, sx * 1.6, 0.3, -1.6));
    // Radio antenna on the roof: messages from Earth (like storm warnings) come in here.
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 5), mat(C.metal), -0.85, 2.15, -0.85));
    const dish = mesh(new THREE.SphereGeometry(0.42, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(C.white, { side: THREE.DoubleSide }), -0.85, 2.7, -0.85);
    dish.name = 'comms-dish';
    dish.quaternion.setFromUnitVectors(DOWN, EARTH_DIR_MARS);
    g.add(dish);
    this.commsDish = dish;
    this.commsLight = mat('#103030', { emissive: new THREE.Color(C.cyan), emissiveIntensity: 0.3 });
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), this.commsLight, -0.85, 2.68, -0.85));
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildO2() {
    const g = new THREE.Group();
    const [x, z] = SPOT.o2;
    g.add(mesh(new THREE.BoxGeometry(2.2, 1.4, 1.6), mat(C.metal), 0, 0.7, 0));
    g.add(mesh(new THREE.BoxGeometry(2.3, 0.2, 1.7), mat(C.dark), 0, 1.45, 0));
    const tankMat = mat(C.white);
    for (const dz of [-0.5, 0.5]) {
      const t = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 8), tankMat, 1.6, 0.8, dz);
      g.add(t);
    }
    // Intake fan spins when the plant has power.
    const fan = new THREE.Group();
    fan.name = 'fan';
    for (let i = 0; i < 3; i++) {
      const blade = mesh(new THREE.BoxGeometry(0.7, 0.08, 0.16), mat(C.dark));
      blade.rotation.y = (i / 3) * Math.PI;
      fan.add(blade);
    }
    fan.position.set(-0.5, 1.6, 0);
    g.add(fan);
    const airLight = mat('#183040', { emissive: new THREE.Color('#8fd3ff'), emissiveIntensity: 0 });
    const fuelLight = mat('#103030', { emissive: new THREE.Color(C.cyan), emissiveIntensity: 0 });
    this.glow.o2.push(airLight);
    this.glow.fuel.push(fuelLight);
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), airLight, -0.5, 0.9, 0.82));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), fuelLight, 0.2, 0.9, 0.82));
    // Pipe toward the rocket.
    const pipe = mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.2, 5), fuelLight, 3.0, 0.15, 2.4);
    pipe.rotation.set(Math.PI / 2, 0, -0.95);
    g.add(pipe);
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildGreenhouse(spot: readonly [number, number], radius: number) {
    const g = new THREE.Group();
    const [x, z] = spot;
    const glass = mat(C.glass, { transparent: true, opacity: 0.6, emissive: new THREE.Color('#2f8f3a'), emissiveIntensity: 0.2 });
    this.glow.greenhouse.push(glass);
    const dome = mesh(new THREE.SphereGeometry(radius, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.2, 0);
    dome.castShadow = false;
    g.add(dome);
    g.add(mesh(new THREE.CylinderGeometry(radius + 0.05, radius + 0.15, 0.3, 10), mat(C.habShade), 0, 0.15, 0));
    const leaf = mat('#3f8f3a');
    const r = rand(Math.round(x * 10));
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * radius * 0.6;
      g.add(mesh(new THREE.ConeGeometry(0.22, 0.5, 4), leaf, Math.cos(a) * d, 0.5, Math.sin(a) * d));
    }
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildShelter() {
    const g = new THREE.Group();
    const [x, z] = SPOT.shelter;
    const mound = mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.4, 8, 1, false, 0, Math.PI), mat(C.soil), 0, 0, 0);
    mound.rotation.z = Math.PI / 2;
    mound.rotation.y = Math.PI / 2;
    g.add(mound);
    const doorMat = mat('#2a1a10', { emissive: new THREE.Color(C.amber), emissiveIntensity: 0 });
    this.glow.shelter.push(doorMat);
    const frame = mesh(new THREE.BoxGeometry(1.1, 1.2, 0.3), mat(C.metal), 0, 0.6, 1.62);
    g.add(frame);
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.95, 0.1), doorMat, 0, 0.55, 1.8));
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildBerm() {
    const g = new THREE.Group();
    const [x, z] = SPOT.shelter;
    const mound = mesh(new THREE.CylinderGeometry(2.3, 2.5, 4.6, 9, 1, false, 0, Math.PI), mat('#7d3d1c'), 0, 0, -0.2);
    mound.rotation.z = Math.PI / 2;
    mound.rotation.y = Math.PI / 2;
    g.add(mound);
    // Sandbags.
    const bag = mat(C.dust);
    for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), bag, -1.6 + i * 0.65, 0.15, 2.05));
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildWorkshop() {
    const g = new THREE.Group();
    const [x, z] = SPOT.workshop;
    g.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.6, 8, 1, false, 0, Math.PI), mat(C.habShade), 0, 0, 0));
    g.children[0].rotation.z = Math.PI / 2;
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), mat(C.dark), 1.32, 0.45, 0));
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildPanelRow([x, z]: [number, number]) {
    const g = new THREE.Group();
    const cell = mat(C.panel, { emissive: new THREE.Color('#0d1a40'), emissiveIntensity: 0.4, shininess: 40, specular: new THREE.Color('#6a7fb8') });
    const leg = mat(C.metal);
    for (let i = 0; i < 2; i++) {
      const p = mesh(new THREE.BoxGeometry(1.9, 0.08, 1.1), cell, i * 2.05 - 1.02, 0.75, 0);
      p.rotation.x = -0.45;
      g.add(p);
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), leg, i * 2.05 - 1.02, 0.35, 0));
    }
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildRocket() {
    const [x, z] = SPOT.rocket;
    // The launch pad and tower stay on the ground; only the rocket (group g) flies.
    const pad = new THREE.Group();
    pad.name = 'launch-pad';
    pad.add(mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.35, 10), mat(C.dark), 0, 0.17, 0));
    pad.add(mesh(new THREE.BoxGeometry(0.3, 5.4, 0.3), mat(C.metal), -1.4, 2.7, 0));
    pad.add(mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), mat(C.metal), -0.95, 4.2, 0));
    // Countdown lights on the tower: amber one by one, then green for liftoff.
    for (let i = 0; i < 3; i++) {
      const m = mat('#401010', { emissive: RED.clone(), emissiveIntensity: 0.25 });
      this.towerLights.push(m);
      const l = mesh(new THREE.BoxGeometry(0.26, 0.26, 0.1), m, -1.4, 2.1 + i * 0.9, 0.19);
      l.name = `tower-light-${i}`;
      l.castShadow = false;
      pad.add(l);
    }
    pad.position.set(x, this.height(x, z), z);
    const g = new THREE.Group();
    g.name = 'rocket';
    // Two stages: the upper stage (with the crew cabin) and the booster below it, which drops away in flight.
    const white = mat(C.white);
    const dark = mat(C.dark);
    // The hull (upper stage, nose cone and booster) shares one material, so a Hangar paint job covers it all.
    this.rocketHull = white;
    const upper = mesh(new THREE.CylinderGeometry(0.55, 0.585, 2.2, 10), white, 0, 3.7, 0);
    const nose = mesh(new THREE.ConeGeometry(0.55, 1.3, 10), white, 0, 5.45, 0);
    g.add(upper, nose);
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.3, 8), dark, 0, 2.45, 0)); // upper-stage engine, hidden until staging
    const booster: THREE.Object3D[] = [];
    const part = (o: THREE.Object3D) => (booster.push(o), g.add(o), o);
    const lower = mesh(new THREE.CylinderGeometry(0.585, 0.62, 2.2, 10), white, 0, 1.5, 0);
    part(lower);
    for (const m of [upper, nose, lower]) rocketUV(m);
    part(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 10), dark, 0, 2.6, 0));
    part(mesh(new THREE.CylinderGeometry(0.3, 0.45, 0.35, 8), dark, 0, 0.22, 0));
    const finMat = mat(C.oxide);
    this.rocketFins = finMat;
    for (let i = 0; i < 4; i++) {
      const fin = mesh(new THREE.BoxGeometry(0.1, 0.9, 0.7), finMat, Math.cos((i * Math.PI) / 2) * 0.62, 0.85, Math.sin((i * Math.PI) / 2) * 0.62);
      fin.rotation.y = -(i * Math.PI) / 2;
      part(fin);
    }
    // Fuel gauge stripe: its height shows how full the tank is.
    part(mesh(new THREE.BoxGeometry(0.26, 3.4, 0.06), mat('#163030'), 0, 2.6, 0.6));
    const barMat = mat('#0f3f3c', { emissive: new THREE.Color(C.cyan), emissiveIntensity: 1.2 });
    this.glow.fuel.push(barMat);
    const bar = mesh(new THREE.BoxGeometry(0.2, 3.4, 0.08), barMat, 0, 0.9, 0.62);
    bar.geometry.translate(0, 1.7, 0);
    bar.castShadow = false;
    part(bar);
    this.boosterParts = booster;
    // Engine flame (an additive cone) and the light it throws on the ground.
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 2.6, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffb050', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    flame.rotation.x = Math.PI;
    flame.visible = false;
    flame.name = 'rocket-flame';
    g.add(flame);
    this.rocketFlame = flame;
    this.plume = new THREE.PointLight('#ff9a4a', 0, 28, 1.3);
    this.plume.position.set(0, -0.6, 0);
    g.add(this.plume);
    g.position.set(x, this.height(x, z), z);
    return { pad, rocket: g, bar };
  }

  private buildMonitor() {
    const g = new THREE.Group();
    const [x, z] = SPOT.monitor;
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 5), mat(C.metal), 0, 1.6, 0));
    const dish = mesh(new THREE.SphereGeometry(0.6, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(C.white, { side: THREE.DoubleSide }), 0, 3.2, 0);
    dish.quaternion.setFromUnitVectors(DOWN, MONITOR_DIR);
    g.add(dish);
    this.monitorDish = dish;
    const lightMat = mat('#301030', { emissive: new THREE.Color('#c58bff'), emissiveIntensity: 0.2 });
    this.glow.monitor.push(lightMat);
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), lightMat, 0, 3.45, 0));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), mat(C.habShade), 0, 0.2, 0));
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildBattery() {
    const g = new THREE.Group();
    const [x, z] = SPOT.battery;
    const box = mat(C.habShade);
    const light = mat('#302010', { emissive: new THREE.Color(C.amber), emissiveIntensity: 0.2 });
    this.glow.battery.push(light);
    for (let i = 0; i < 3; i++) {
      g.add(mesh(new THREE.BoxGeometry(0.8, 0.9, 0.7), box, i * 0.95, 0.45, 0));
      g.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), light, i * 0.95, 0.7, 0.37));
    }
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildMoxie2() {
    const g = new THREE.Group();
    const [x, z] = SPOT.moxie2;
    g.add(mesh(new THREE.BoxGeometry(1.8, 1.8, 1.6), mat(C.metal), 0, 0.9, 0));
    const tank = mat(C.white);
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.2, 8), tank, -1.3 + i * 0.0, 1.1, -0.9 + i * 0.9));
    const l = mat('#103030', { emissive: new THREE.Color(C.cyan), emissiveIntensity: 0 });
    this.glow.fuel.push(l);
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.05), l, 0, 1.2, 0.82));
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildReactor() {
    const g = new THREE.Group();
    const [x, z] = SPOT.reactor;
    g.add(mesh(new THREE.CylinderGeometry(0.9, 1.1, 2.2, 8), mat(C.habShade), 0, 1.1, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.9, 0.6, 8), mat(C.metal), 0, 2.5, 0));
    const core = mat('#0f3030', { emissive: new THREE.Color(C.cyan), emissiveIntensity: 1 });
    this.glow.reactor.push(core);
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.2, 0.05), core, 0, 1.4, 1.02));
    // Radiator panels: reactors on Mars shed heat through big fins.
    const rad = mat('#d8d4cc');
    for (const s of [-1, 1]) {
      const p = mesh(new THREE.BoxGeometry(2.4, 1.6, 0.06), rad, s * 2.1, 1.4, 0);
      g.add(p);
    }
    g.position.set(x, this.height(x, z), z);
    return g;
  }

  private buildAstronaut(i: number) {
    const g = new THREE.Group();
    const suit = mesh(new THREE.CapsuleGeometry(0.16, 0.3, 2, 6), this.suitMats[i % 2], 0, 0.35, 0);
    suit.name = 'suit';
    g.add(suit);
    g.add(mesh(new THREE.IcosahedronGeometry(0.17, 0), this.helmetMat, 0, 0.72, 0));
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), this.visorMat, 0, 0.73, 0.15));
    const pack = mesh(new THREE.BoxGeometry(0.22, 0.26, 0.12), this.packMat, 0, 0.42, -0.17);
    pack.name = 'suit-pack';
    g.add(pack);
    g.visible = false;
    this.group.add(g);
    const p = this.waypoint(i);
    g.position.copy(p);
    return { obj: g, from: p.clone(), to: this.waypoint(i + 3), t: Math.random(), speed: 0.12 + Math.random() * 0.08, running: false, inside: false };
  }

  private waypoint(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const pts: Array<readonly [number, number]> = [
      [1.5, 3],
      [3.2, 0.6],
      [-2.6, 0.4],
      [-6, 2.5],
      [2.6, -2.8],
      [6.4, 2.6],
      [-1.5, -3],
      [0.5, 6.4],
    ];
    const [x, z] = pts[((i % pts.length) + pts.length) % pts.length];
    return out.set(x, this.height(x, z), z);
  }

  /**
   * Where the lamps are: a soft glow around each (a cheap stand-in for bloom), and for the bigger ones a pool of
   * light on the ground at night. Each follows its own material's glow, so power, blinking and the Hangar's light
   * color all show up in the glow too.
   */
  private buildGlows(hab: THREE.Object3D, o2: THREE.Object3D, greenhouse: THREE.Object3D, shelter: THREE.Object3D, workshop: THREE.Object3D, pad: THREE.Object3D) {
    const add = (m: THREE.MeshPhongMaterial, root: THREE.Object3D, hx: number, hy: number, hz: number, size: number, haloK: number, pool?: [number, number, number, number?], poolK = 0, color?: string) => {
      const halo = this.halos.add(hx, hy, hz, size);
      const p = pool ? this.pools.add(pool[0], 0.03, pool[1], pool[2], pool[3] ?? pool[2]) : -1;
      this.glowSrc.push({ m, root, halo, haloK, pool: p, poolK, color: color ? new THREE.Color(color) : undefined });
    };
    // Habitat windows, heater vents and the roof antenna's light.
    const win = this.glow.hab[0];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      add(win, hab, Math.cos(a) * 2.5, 0.92, Math.sin(a) * 2.5, 1.3, 0.75, [Math.cos(a) * 3.4, Math.sin(a) * 3.4, 1.5], 0.45);
    }
    for (const sx of [-1, 1]) add(this.glow.heater[0], hab, sx * 1.6, 0.32, -1.95, 0.9, 0.5, [sx * 1.6, -2.5, 0.9], 0.35);
    add(this.commsLight, hab, -0.85, 2.72, -0.85, 0.7, 0.6);
    // The shelter door, the greenhouses' grow lights, the O2 plant's lights.
    const [sx, sz] = SPOT.shelter;
    add(this.glow.shelter[0], shelter, sx, 0.6, sz + 1.95, 1.7, 0.75, [sx, sz + 2.9, 1.9], 0.6);
    const [gx, gz] = SPOT.greenhouse;
    add(this.glow.greenhouse[0], greenhouse, gx, 1.0, gz, 4.4, 0.32, [gx, gz, 3.0], 0.5, '#8fe36a');
    const [dx, dz] = SPOT.dome2;
    add(this.glow.greenhouse[1], this.upgrades.dome2[0], dx, 0.9, dz, 4, 0.32, [dx, dz, 2.7], 0.5, '#8fe36a');
    const [ox, oz] = SPOT.o2;
    add(this.glow.o2[0], o2, ox - 0.5, 0.9, oz + 0.95, 0.9, 0.6, [ox - 0.1, oz + 1.6, 1.3], 0.3);
    add(this.glow.fuel[0], o2, ox + 0.2, 0.9, oz + 0.95, 0.9, 0.6);
    // Upgrades: battery lamps, the radiation monitor, the reactor core, the second O2 plant.
    const [bx, bz] = SPOT.battery;
    for (let i = 0; i < 3; i++) add(this.glow.battery[0], this.upgrades.battery[0], bx + i * 0.95, 0.7, bz + 0.5, 0.75, 0.6, i === 1 ? [bx + 0.95, bz + 1.3, 1.8, 1.2] : undefined, 0.35);
    const [mx, mz] = SPOT.monitor;
    add(this.glow.monitor[0], this.upgrades.monitor[0], mx, 3.5, mz, 1.1, 0.7);
    const [rx, rz] = SPOT.reactor;
    add(this.glow.reactor[0], this.upgrades.reactor[0], rx, 1.4, rz + 1.2, 1.3, 0.6, [rx, rz + 1.9, 1.6], 0.4);
    const [x2, z2] = SPOT.moxie2;
    add(this.glow.fuel[2], this.upgrades.moxie2[0], x2, 1.2, z2 + 0.95, 0.9, 0.6);
    // The countdown lights on the launch tower.
    const [kx, kz] = SPOT.rocket;
    this.towerLights.forEach((m, i) => add(m, pad, kx - 1.4, 2.1 + i * 0.9, kz + 0.32, 0.75, 0.4));

    // Blob shadows (only shown on the 'low' tier, where real shadows are off).
    const blob = (root: THREE.Object3D, x: number, z: number, rx: number, rz = rx) => this.blobSrc.push({ root, i: this.blobs.add(x, 0.025, z, rx, rz) });
    blob(hab, 0.2, 0.2, 3.1);
    blob(greenhouse, gx, gz, 2.2);
    blob(this.upgrades.dome2[0], dx, dz, 2);
    blob(shelter, sx, sz, 2.1, 2.3);
    blob(workshop, SPOT.workshop[0], SPOT.workshop[1], 1.7, 1.4);
    blob(o2, ox + 0.2, oz, 1.8, 1.2);
    blob(pad, kx, kz, 2.1);
    blob(this.upgrades.battery[0], bx + 0.95, bz, 1.7, 0.8);
    blob(this.upgrades.moxie2[0], x2 - 0.3, z2, 1.6);
    blob(this.upgrades.reactor[0], rx, rz, 3.4, 1.4);
    blob(this.upgrades.monitor[0], mx, mz, 0.7);
  }

  /** Update the lamp glows, light pools and blob shadows (a few numbers each; nothing allocated). */
  private updateGlows() {
    const g = this.gloom;
    for (const s of this.glowSrc) {
      const e = this.shown(s.root) ? Math.min(2.5, s.m.emissiveIntensity) : 0;
      const color = s.color ?? s.m.emissive;
      this.halos.set(s.halo, color, e * s.haloK * (0.18 + 0.82 * g));
      // Pools of lamplight only show once it is dark.
      if (s.pool >= 0) this.pools.set(s.pool, color, e * s.poolK * this.night * 0.7);
    }
    this.halos.commit();
    this.pools.commit();
    if (this.blobs.mesh.visible) {
      const k = 0.2 + 0.35 * (1 - this.night);
      for (const b of this.blobSrc) this.blobs.set(b.i, WHITE, this.shown(b.root) ? k : 0);
      this.blobs.commit();
    }
  }

  /**
   * The quality tier: 'low' turns real shadows off (soft blob shadows under the buildings instead) and keeps much
   * less dust in the air.
   */
  setQuality(q: Quality) {
    this.quality = q;
    this.sunLight.castShadow = q === 'high';
    this.blobs.mesh.visible = q === 'low';
    this.motes.setQuality(q);
  }

  get qualityTier(): Quality {
    return this.quality;
  }

  /**
   * On the Moon: which way the sunlight falling on the Earth comes from (its phase), and how much of the Earth's
   * face is lit (0 new .. 1 full), for its glow.
   */
  setEarthLight(dir: THREE.Vector3, lit: number) {
    this.earthSun?.(dir);
    if (this.earthGlow) {
      this.earthGlow.set(0, EARTH_GLOW, 0.18 + 0.5 * lit);
      this.earthGlow.commit();
    }
  }

  /** A glowing rectangle at the blueprint's build line (a unit square, scaled to fit). */
  private buildScanLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1), new THREE.Vector3(1, 0, 1), new THREE.Vector3(-1, 0, 1)]);
    const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: '#bffff8', transparent: true, opacity: 0.9, depthWrite: false }));
    line.name = 'build-line';
    line.visible = false;
    return line;
  }

  private buildTrail() {
    const n = 160;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffd28a', size: 0.5, transparent: true, opacity: 0 }));
    pts.frustumCulled = false;
    return pts;
  }

  // ------------------------------------------------------------------ updating

  /**
   * Switch the scenery: Mars at Gale Crater, Mars at the ice landing site (landing 'arcadia'), or the Moon.
   * The base itself stays where it is.
   */
  setSite(site: Site, landing?: string) {
    const land: MarsLanding = site !== 'moon' && landing === 'arcadia' ? 'arcadia' : 'gale';
    if (site === this.site && land === this.landing) return;
    this.site = site;
    this.landing = land;
    const moon = site === 'moon';
    const ice = land === 'arcadia';
    if (moon && !this.moonGround) {
      this.moonGround = this.buildMoonGround();
      this.group.add(this.moonGround);
    }
    if (ice && !this.arcadiaGround) {
      this.arcadiaGround = this.buildArcadiaGround();
      this.group.add(this.arcadiaGround);
    }
    this.marsGround.visible = !moon && !ice;
    if (this.moonGround) this.moonGround.visible = moon;
    if (this.arcadiaGround) this.arcadiaGround.visible = ice;
    // Hulls look a little whiter on the Moon: no red dust settling on them.
    for (const h of this.hull) this.applyTint(h);
    this.ambient.groundColor.set(moon ? '#3a3a40' : '#6b2e16');
    // No air, no dust.
    this.motes.setWeather((this.scene?.weather ?? 'clear') as DustWeather, !moon);
    // Worn paths look darker than the undisturbed ground, on both worlds.
    (this.paths.material as THREE.MeshPhongMaterial).color.set(moon ? '#3c3c40' : ice ? '#5a2c18' : '#4a2010');
    // With no air, dust kicked up on the Moon flies out and falls back instead of billowing.
    this.puffs.drag = moon ? 0 : 1.4;
    this.puffs.gravity = moon ? 1.6 : -0.15;
    // The roof antenna points at Earth (low over the horizon, seen from the Moon).
    this.commsDish.quaternion.setFromUnitVectors(DOWN, this.earthDir(vT));
    this.lander.clear();
    this.beam.hide();
  }

  get currentSite(): Site {
    return this.site;
  }

  /** A white hull color is a little brighter on the Moon (no red dust on it); other colors stay as painted. */
  private applyTint(h: { m: THREE.MeshPhongMaterial; base: THREE.Color }) {
    h.m.color.copy(h.base).lerp(WHITE, this.site === 'moon' && HULL_COLORS.has(h.base.getHex()) ? 0.35 : 0);
  }

  /** Repaint a material, keeping the Moon's brighter-white-hulls rule. */
  private tint(m: THREE.MeshPhongMaterial, color: THREE.ColorRepresentation) {
    let h = this.hull.find((e) => e.m === m);
    if (!h) this.hull.push((h = { m, base: new THREE.Color() }));
    h.base.set(color);
    this.applyTint(h);
  }

  // ------------------------------------------------------------------ the Hangar's looks

  /** Suit colors for the whole crew, the rocket's paint job, the rover pet (or none) and the base lights. */
  setCosmetics(c: Cosmetics) {
    for (const m of this.suitMats) {
      this.tint(m, c.suit.body);
      m.emissive.set(c.suit.body);
    }
    this.tint(this.packMat, c.suit.trim);
    this.suitGlow = !!c.suit.glow;
    this.setNight(this.night);

    this.paintRocket(c.rocket);

    if (c.pet) {
      if (!this.pet) {
        // A new pet rolls out of the habitat door.
        this.pet = new RoverPet();
        this.pet.place(PET_HOME.x, PET_HOME.z, this.heightAt);
        this.group.add(this.pet.group);
      }
      this.pet.setLook(c.pet);
    } else if (this.pet) {
      this.group.remove(this.pet.group);
      this.pet.dispose();
      this.pet = null;
    }

    for (const m of [...this.glow.hab, ...this.glow.shelter, ...this.glow.battery]) m.emissive.set(c.lights);
  }

  /** The paint picture becomes a tiny texture (nearest-neighbor, no mipmaps: crisp, blocky pixels). */
  private paintRocket(p: Cosmetics['rocket']) {
    const tex = new THREE.DataTexture(paintPixels(p), PAINT_W, PAINT_H, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    const hull = this.rocketHull;
    if (!hull.map) hull.needsUpdate = true; // the shader needs its texture slot, once
    this.rocketPaint?.dispose();
    this.rocketPaint = tex;
    hull.map = tex;
    this.tint(hull, '#ffffff'); // the picture has the colors
    hull.shininess = p.shiny ? 70 : 26;
    hull.specular.set(p.shiny ? '#fff0b0' : '#4a463e');
    this.tint(this.rocketFins, p.fins);
  }

  /** The rover pet, if the player has one (for tests). */
  get roverPet(): RoverPet | null {
    return this.pet;
  }

  /** The astronaut the pet follows: the first one outside. */
  private petLeader(): THREE.Vector3 | null {
    for (const c of this.crew) if (c.obj.visible) return c.obj.position;
    return null;
  }

  /** Let go of the paint texture and the pet (the 3D view is closing). */
  disposeCosmetics() {
    this.rocketPaint?.dispose();
    this.rocketPaint = null;
    this.pet?.dispose();
  }

  /** Where on Mars the base is shown ('gale' on the Moon too). */
  get currentLanding(): MarsLanding {
    return this.landing;
  }

  /** Ground height at a scene position, for the current site. */
  groundHeight(x: number, z: number) {
    return this.height(x, z);
  }

  /** Direction from the roof antenna to Earth. */
  private earthDir(out: THREE.Vector3) {
    if (this.site !== 'moon') return out.copy(EARTH_DIR_MARS);
    worldPoint(this.commsDish, 0, 0, 0, vU);
    return out.copy(EARTH_POS).sub(vU).normalize();
  }

  setScene(s: StageScene) {
    this.setSite(s.site ?? 'mars', s.landing);
    this.motes.setWeather(s.weather as DustWeather, this.site !== 'moon');
    const prev = this.prevLevels;
    this.scene = s;
    // Panels: 3 rows to start, plus one per upgrade.
    this.panels.forEach((p, i) => {
      const show = i < 3 + s.levels.panel;
      if (show && !p.visible && prev) this.pops.push({ obj: p, t: 0 });
      p.visible = show;
    });
    for (const id of Object.keys(this.upgrades) as UpgradeId[]) {
      for (const o of this.upgrades[id]) {
        const show = s.levels[id] > 0;
        if (show && !o.visible && prev) this.pops.push({ obj: o, t: 0 });
        o.visible = show;
      }
    }
    this.prevLevels = { ...s.levels };

    // Fuel gauge on the rocket.
    this.fuelBar.scale.y = Math.max(0.02, Math.min(1, s.fuel / 100));

    this.updateBlueprint(s);

    // Crew: walk around outside by day (unless sheltering from a storm).
    this.crewCount = s.crew;
    this.crew.forEach((c, i) => (c.obj.visible = i < s.crew && !c.inside));

    // Module lights follow the power budget.
    const a = s.alloc;
    const set = (list: THREE.MeshPhongMaterial[], v: number) => list.forEach((m) => (m.emissiveIntensity = v));
    set(this.glow.heater, a.heaters ? 0.9 : 0);
    set(this.glow.shelter, a.shelter ? 1.2 : 0);
    set(this.glow.o2, a.air ? 1.1 : 0.05);
    set(
      this.glow.fuel.filter((m) => m !== (this.fuelBar.material as THREE.MeshPhongMaterial)),
      a.fuel ? 1.2 : 0.05,
    );
    set(this.glow.monitor, a.monitor ? 1.5 : 0.1);
    set(this.glow.battery, a.battery ? 1.4 : 0.2);

    this.updateBeam(s.warning ?? null);
  }

  /**
   * Blueprint of the project the Workshop is building. It fills in from the bottom up: the part built so far is
   * bright, the rest faint, and a glowing line marks where the crew is working.
   */
  private updateBlueprint(s: StageScene) {
    let src: THREE.Object3D | null = null;
    if (s.project && s.projectProgress !== undefined) {
      const o = s.project === 'panel' ? this.panels[Math.min(this.panels.length - 1, 3 + s.levels.panel)] : this.upgrades[s.project][0];
      if (o && !(s.project !== 'panel' && s.levels[s.project] > 0)) src = o;
    }
    const changed = src !== this.ghostSrc;
    if (changed) {
      this.ghost.clear();
      this.ghostSrc = src;
      if (src) {
        this.ghost.add(this.blueprintCopy(src, this.ghostMat), this.blueprintCopy(src, this.ghostFaintMat));
        this.ghost.updateMatrixWorld(true);
        this.ghostBox.setFromObject(this.ghost.children[0]);
      }
    }
    if (!src) {
      this.buildSite = null;
      this.scan.visible = false;
      return;
    }
    const b = this.ghostBox;
    const k = THREE.MathUtils.clamp(s.projectProgress ?? 0, 0, 1);
    this.cutTarget = b.min.y + (b.max.y - b.min.y) * k;
    if (changed) this.cut = this.cutTarget;
    const hx = (b.max.x - b.min.x) / 2;
    const hz = (b.max.z - b.min.z) / 2;
    this.scan.position.set((b.min.x + b.max.x) / 2, this.cut, (b.min.z + b.max.z) / 2);
    this.scan.scale.set(hx + 0.25, 1, hz + 0.25);
    this.scan.visible = true;
    this.buildSite = { x: this.scan.position.x, z: this.scan.position.z, r: Math.max(hx, hz), y: this.cut };
    this.applyCut();
  }

  private blueprintCopy(src: THREE.Object3D, material: THREE.Material) {
    const copy = src.clone(true);
    copy.visible = true;
    copy.scale.set(1, 1, 1);
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = material;
        o.castShadow = o.receiveShadow = false;
      }
    });
    return copy;
  }

  private applyCut() {
    this.clipBuilt.constant = this.cut + 0.001; // keeps what is below the line
    this.clipTodo.constant = -this.cut; // keeps what is above it
    this.scan.position.y = this.cut + 0.04;
    if (this.buildSite) this.buildSite.y = this.cut;
  }

  /** How far up the blueprint is built (0..1), for tests. */
  get blueprintFill() {
    const b = this.ghostBox;
    return this.ghostSrc ? (this.cut - b.min.y) / Math.max(1e-6, b.max.y - b.min.y) : 0;
  }

  /** A storm warning is in: a beam from the dish that heard it (the roof antenna for Earth, or the monitor). */
  private updateBeam(w: 'monitor' | 'earth' | null) {
    if (!w || (w === 'monitor' && !this.upgrades.monitor[0].visible)) {
      this.beam.hide();
      return;
    }
    this.beamFrom = w;
    const dish = w === 'monitor' ? this.monitorDish : this.commsDish;
    worldPoint(dish, 0, 0, 0, vU);
    let len = 70;
    if (w === 'monitor') vT.copy(MONITOR_DIR);
    else {
      this.earthDir(vT);
      if (this.site === 'moon') len = EARTH_POS.distanceTo(vU) - EARTH_RADIUS - 0.5;
    }
    this.beam.show(`${w}-${this.site}`, vU, vT, len, w === 'monitor' ? '#c58bff' : C.cyan, this.reducedMotion ? 1 : 3);
  }

  setNight(night: number) {
    this.night = night;
    this.glow.hab.forEach((m) => (m.emissiveIntensity = 0.45 + night * 1.5));
    // Glow-in-the-dark suits: a soft glow by day, bright as the sky darkens.
    for (const m of this.suitMats) m.emissiveIntensity = this.suitGlow ? 0.3 + night * 1.4 : 0;
  }

  /** 0 = sunrise, 0.5 = sunset (as the stage's setTimeOfDay). Dust devils come out on clear afternoons. */
  setDayTime(t: number) {
    this.dayT = t;
  }

  storm(intensity: number) {
    this.storming = Math.max(this.storming, intensity);
    // The warning has done its job.
    this.beam.hide();
  }

  /** Act out a moment of the sol. */
  cue(c: StageCue) {
    if (c.kind === 'lander') this.lander.start(c.crate);
    else if (c.kind === 'shelter') this.runForShelter();
  }

  /** A storm is coming and the shelter has power: everyone outside runs for the shelter door. */
  private runForShelter() {
    this.rush = 3.5;
    this.crew.forEach((c, i) => {
      if (i >= this.crewCount || c.inside || !c.obj.visible) return;
      if (this.reducedMotion) {
        c.inside = true; // gentler: they just go in
        return;
      }
      c.running = true;
      c.from.copy(c.obj.position);
      c.to.set(SHELTER_DOOR.x + ((i % 3) - 1) * 0.35, this.height(SHELTER_DOOR.x, SHELTER_DOOR.z), SHELTER_DOOR.z + 0.2);
      c.t = 0;
      c.speed = 1 / THREE.MathUtils.clamp(c.from.distanceTo(c.to) / 6, 0.6, 1.1);
    });
  }

  /** Crew members outside right now. */
  get crewOutside() {
    let n = 0;
    for (const c of this.crew) if (c.obj.visible) n++;
    return n;
  }

  tick(dt: number, time: number, reduced: boolean) {
    this.reducedMotion = reduced;
    const s = this.scene;
    if (!s) return;
    // Fan spins with power.
    if (s.alloc.air + s.alloc.fuel > 0 && !reduced) this.fan.rotation.y += dt * (2 + s.alloc.air + s.alloc.fuel);
    // Monitor blink.
    if (s.alloc.monitor) this.glow.monitor.forEach((m) => (m.emissiveIntensity = Math.sin(time * 6) > 0 ? 1.6 : 0.2));
    // Greenhouse grow lights: brighter with more power, and they glow through the night.
    const gh = 0.15 + Math.min(1, s.alloc.greenhouse / 3) * 0.8 + this.night * 0.9;
    this.glow.greenhouse.forEach((m) => (m.emissiveIntensity = gh));
    // Reactor hum.
    this.glow.reactor.forEach((m) => (m.emissiveIntensity = 0.8 + Math.sin(time * 2) * 0.3));

    // Crew walk between waypoints by day; inside at night or when sheltering. Before a storm they run for the
    // shelter door, and come back out when it has passed.
    const stormHide = s.sheltered && this.storming > 0.05;
    this.rush = Math.max(0, this.rush - dt);
    const holdInside = this.rush > 0 || stormHide;
    const day = this.night < 0.5;
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (c.inside && !holdInside) {
        c.inside = false;
        c.running = false;
        c.from.set(SHELTER_DOOR.x, this.height(SHELTER_DOOR.x, SHELTER_DOOR.z), SHELTER_DOOR.z);
        this.waypoint(i + 3, c.to);
        c.t = 0;
        c.speed = 0.12 + Math.random() * 0.08;
      }
      c.obj.visible = day && i < this.crewCount && !c.inside && (c.running || !stormHide);
      if (!c.obj.visible) continue;
      if (c.running) {
        c.t = Math.min(1, c.t + dt * c.speed);
        if (c.t >= 1) {
          c.running = false;
          c.inside = true;
          c.obj.visible = false;
          continue;
        }
      } else {
        c.t += dt * c.speed;
        if (c.t >= 1) {
          c.t = 0;
          c.from.copy(c.to);
          this.waypoint(Math.floor(Math.random() * 8), c.to);
        }
      }
      c.obj.position.lerpVectors(c.from, c.to, c.t);
      const bob = reduced ? 0 : Math.abs(Math.sin(time * (c.running ? 16 : 8) + i)) * (c.running ? 0.1 : 0.05);
      c.obj.position.y = this.height(c.obj.position.x, c.obj.position.z) + bob;
      c.obj.lookAt(c.to.x, c.obj.position.y, c.to.z);
    }
    // The shelter door flashes while the crew hurries in and while the storm lasts.
    const alarm = this.rush > 0 || stormHide;
    const door = alarm ? (reduced ? 2 : 1.4 + Math.abs(Math.sin(time * 6)) * 1.4) : s.alloc.shelter ? 1.2 : 0;
    for (const m of this.glow.shelter) m.emissiveIntensity = door;
    // The rover pet trails after whoever is outside, or naps by the habitat door.
    this.pet?.update(dt, time, this.petLeader(), this.heightAt, reduced, this.night);

    // Pop-in animation for freshly built pieces.
    this.pops = this.pops.filter((p) => {
      p.t += dt * 1.6;
      const k = Math.min(1, p.t);
      const s2 = reduced ? 1 : 1 + Math.sin(k * Math.PI) * 0.25;
      p.obj.scale.set(s2, Math.max(0.01, k) * s2, s2);
      if (k >= 1) p.obj.scale.set(1, 1, 1);
      return k < 1;
    });

    // Blueprint: the build line rises smoothly to today's progress, and drones carry parts to it.
    if (this.buildSite && Math.abs(this.cut - this.cutTarget) > 1e-4) {
      this.cut += (this.cutTarget - this.cut) * Math.min(1, dt * (reduced ? 30 : 2.5));
      this.applyCut();
    }
    this.ghostMat.opacity = reduced ? 0.6 : 0.55 + 0.1 * Math.sin(time * 3);
    (this.scan.material as THREE.LineBasicMaterial).opacity = reduced ? 0.8 : 0.55 + 0.4 * Math.abs(Math.sin(time * 4));
    this.drones.update(dt, time, this.buildSite ? Math.min(3, s.alloc.build) : 0, this.buildSite, this.sparks, reduced);

    // Dust in the air: specks on calm days, blowing streaks in a storm (never on the Moon: no wind to lift it).
    // The GPU moves it; this only eases the amount toward the weather.
    this.motes.update(dt, reduced, this.moteColor);
    this.storming = Math.max(0, this.storming - dt * 0.35);

    // Life around the base.
    this.rover.update(dt, day, reduced, this.heightAt);
    // Dust devils whirl when the ground is hottest: late morning to late afternoon (about 10:00 to 17:00).
    const afternoon = this.dayT > 0.16 && this.dayT < 0.45;
    this.devils.update(dt, time, this.site === 'mars' && s.weather === 'clear' && afternoon && !reduced, this.heightAt, this.puffs);
    this.lander.update(dt, time, reduced, this.sparks, this.puffs, this.site === 'moon' ? MOON_DUST : MARS_DUST);
    if (this.beam.update(dt, time, reduced)) this.pulseArrived();
    this.dishFlash = Math.max(0, this.dishFlash - dt * 2);
    const earthBeam = this.beam.showing && this.beamFrom === 'earth';
    this.commsLight.emissiveIntensity = 0.3 + (earthBeam ? 0.5 + this.dishFlash * 2.5 : 0);
    if (this.beamFrom === 'monitor' && this.dishFlash > 0) this.glow.monitor.forEach((m) => (m.emissiveIntensity = 1.6 + this.dishFlash * 2));

    this.sparks.update(dt);
    this.puffs.update(dt);
    this.updateGlows();
  }

  /** A radio pulse reached the dish: a flash and a little burst of light. */
  private pulseArrived() {
    this.dishFlash = 1;
    worldPoint(this.beamFrom === 'monitor' ? this.monitorDish : this.commsDish, 0, 0, 0, vU);
    const color = this.beamFrom === 'monitor' ? PULSE_VIOLET : PULSE_CYAN;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.sparks.emit(vU.x, vU.y, vU.z, Math.cos(a) * 1.5, 1 + Math.random(), Math.sin(a) * 1.5, 0.45, 0.16, color);
    }
  }

  get stormLevel() {
    return this.storming;
  }

  dustLevel() {
    return this.motes.opacity;
  }

  // ------------------------------------------------------------------ tapping parts of the base

  private shown(o: THREE.Object3D) {
    for (let p: THREE.Object3D | null = o; p && p !== this.group; p = p.parent) if (!p.visible) return false;
    return true;
  }

  private hasLook(o: THREE.Object3D) {
    return this.shown(o) && (o !== this.ghost || o.children.length > 0);
  }

  /** The parts of the base you can look at right now (built ones only), in menu order. */
  focusTargets(): Array<{ key: FocusKey; label: string }> {
    const out: Array<{ key: FocusKey; label: string }> = [];
    for (const key of FOCUS_ORDER) if (this.targets.get(key)!.some((o) => this.hasLook(o))) out.push({ key, label: FOCUS_LABELS[key] });
    return out;
  }

  /** Which part of the base a ray hits first (null: the ground, rocks or sky). */
  pick(ray: THREE.Raycaster): FocusKey | null {
    const hits = this.hits;
    hits.length = 0;
    this.group.updateMatrixWorld();
    ray.intersectObjects(this.pickRoots, true, hits);
    for (const hit of hits) {
      if (!this.shown(hit.object)) continue;
      for (let o: THREE.Object3D | null = hit.object; o && o !== this.group; o = o.parent) {
        const key = this.pickKeys.get(o);
        if (key) return key;
      }
    }
    return null;
  }

  /** Where a part of the base is, for framing it with the camera. False if it isn't built. */
  focusFrame(key: FocusKey, out: { center: THREE.Vector3; radius: number; top: number }): boolean {
    const box = this.focusBox.makeEmpty();
    for (const o of this.targets.get(key) ?? []) {
      if (!this.hasLook(o)) continue;
      o.updateWorldMatrix(true, true);
      o.traverseVisible((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || (m.material as THREE.Material).blending === THREE.AdditiveBlending) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.union(PART_BOX.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
      });
    }
    if (box.isEmpty()) return false;
    box.getCenter(out.center);
    out.radius = Math.max(1.2, box.getSize(vT).length() / 2);
    out.top = box.max.y;
    return true;
  }

  // ------------------------------------------------------------------ launch

  rocketPosition() {
    return this.rocket.position;
  }

  /**
   * k: 0..1 through the launch (see LAUNCH_TIMELINE): countdown lights on the tower, ignition with a ring of dust,
   * liftoff with the plume lighting the ground, then the booster drops away. Returns the rocket's height above the pad.
   */
  launchStep(k: number, dt = 1 / 60) {
    const L = LAUNCH_TIMELINE;
    const [x, z] = SPOT.rocket;
    const base = this.height(x, z);
    const span = 1 - L.liftoff;
    const h = k < L.liftoff ? 0 : Math.pow((k - L.liftoff) / span, 2.2) * LAUNCH_HEIGHT;
    this.rocket.position.y = base + h;
    // The rocket strains on the pad while the engine builds up (no shaking with reduced motion).
    const shake = !this.reducedMotion && k >= L.ignite && k < L.liftoff + 0.05 ? (Math.random() - 0.5) * 0.08 : 0;
    this.rocket.position.x = x + shake;
    this.rocket.position.z = z;

    // Countdown lights: amber one by one, all green at ignition, then back to standby red.
    for (let i = 0; i < this.towerLights.length; i++) {
      const m = this.towerLights[i];
      const go = k >= L.ignite && k < 0.6;
      const lit = k >= L.count[i] && k < L.ignite;
      m.emissive.copy(go ? GREEN : lit ? AMBER : RED);
      m.emissiveIntensity = go || lit ? 1.8 : 0.25;
    }

    const st = this.launchState;
    if (k >= L.ignite && !st.ignited) {
      st.ignited = true;
      this.dustRing(x, base, z, this.reducedMotion ? 24 : 64);
    }
    // Staging: the empty booster drops away, and the upper stage lights its own engine.
    if (k >= L.stage && !st.staged) {
      st.staged = true;
      st.stageY = this.rocket.position.y;
      this.booster.position.copy(this.rocket.position);
      this.booster.rotation.set(0, 0, 0);
      for (const p of this.boosterParts) this.booster.add(p);
    }
    if (st.staged) {
      const sk = k - L.stage;
      const v0 = (LAUNCH_HEIGHT * 2.2 * Math.pow((L.stage - L.liftoff) / span, 1.2)) / span;
      const by = st.stageY + v0 * 0.45 * sk - 1500 * sk * sk;
      this.booster.position.set(x + sk * 14, by, z + sk * 5);
      this.booster.rotation.set(sk * 2, 0, -sk * 7);
      this.booster.visible = by > base + 0.5;
    }

    const burning = k >= L.ignite && !(k >= L.stage && k < L.relight);
    const upper = st.staged;
    const flick = this.reducedMotion ? 1 : 0.85 + Math.random() * 0.3;
    const size = upper ? 0.55 : Math.min(1, 0.55 + ((k - L.ignite) / (L.liftoff - L.ignite)) * 0.45);
    this.rocketFlame.visible = burning;
    if (burning) {
      const sy = flick * size * 1.15;
      this.rocketFlame.scale.set(flick * size, sy, flick * size);
      this.rocketFlame.position.y = (upper ? 2.3 : 0.05) - 1.3 * sy;
    }
    // The plume lights the pad and the ground around it, fading as the rocket climbs.
    this.plume.position.y = upper ? 1.9 : -0.6;
    this.plume.intensity = burning ? (upper ? 4 : 16) * flick * THREE.MathUtils.clamp(1 - h / 45, 0, 1) : 0;
    // Dust keeps billowing off the pad while the rocket is low.
    if (burning && !upper && h < 12) {
      const color = this.site === 'moon' ? MOON_DUST : MARS_DUST;
      const n = Math.min(6, Math.round(dt * (this.reducedMotion ? 25 : 80)));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 3;
        this.puffs.emit(x + Math.cos(a) * 1.4, base + 0.3, z + Math.sin(a) * 1.4, Math.cos(a) * sp, 0.5 + Math.random(), Math.sin(a) * sp, 1.2 + Math.random() * 0.6, 0.7, color, 0.5, 1.4);
      }
    }
    // Exhaust trail.
    const tm = this.trail.material as THREE.PointsMaterial;
    tm.opacity = burning ? 0.9 : 0;
    if (burning) {
      const top = this.rocket.position.y + (upper ? 2.2 : 0) - 0.2;
      const p = this.trail.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const f = i / p.count;
        const y = Math.max(base, top - f * 20);
        const spread = f * 2.2;
        p.setXYZ(i, x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
      }
      p.needsUpdate = true;
    }
    return h;
  }

  /** True once the booster has separated (for tests). */
  get staged() {
    return this.launchState.staged;
  }

  /** The plume's light on the ground right now (for tests). */
  get plumeLight() {
    return this.plume.intensity;
  }

  private dustRing(x: number, y: number, z: number, n: number) {
    const color = this.site === 'moon' ? MOON_DUST : MARS_DUST;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const sp = 5 + Math.random() * 4;
      this.puffs.emit(x + Math.cos(a) * 1.8, y + 0.25, z + Math.sin(a) * 1.8, Math.cos(a) * sp, 0.4 + Math.random() * 0.8, Math.sin(a) * sp, 1.6 + Math.random() * 0.6, 0.8, color, 0.6, 1.6);
    }
  }

  resetLaunch() {
    const [x, z] = SPOT.rocket;
    this.rocket.position.set(x, this.height(x, z), z);
    (this.trail.material as THREE.PointsMaterial).opacity = 0;
    // Put the booster back under the upper stage, ready for the next crew.
    for (const p of this.boosterParts) this.rocket.add(p);
    this.booster.visible = false;
    this.rocketFlame.visible = false;
    this.plume.intensity = 0;
    for (const m of this.towerLights) {
      m.emissive.copy(RED);
      m.emissiveIntensity = 0.25;
    }
    this.launchState.ignited = false;
    this.launchState.staged = false;
  }
}
