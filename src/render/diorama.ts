// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The low-poly outpost. Built from code (no model files), so it's tiny to download.
// The base visibly grows: every upgrade has its own piece, and the Workshop's current
// project shows as a see-through blueprint that fills in as the crew builds it.
// On Mars the ground around the base is real Gale Crater terrain (see gale.ts); on the Moon it is
// made-up gray, cratered regolith with the Earth in the sky (see moon.ts).

import * as THREE from 'three';
import { mat, rand } from './retro';
import { marsHeight, GROUND_RADIUS } from './gale';
import { moonHeight, moonTone, buildEarth } from './moon';
import type { StageScene } from './stage';
import type { UpgradeId, Levels } from '../sim/upgrades';

export type Site = NonNullable<StageScene['site']>;

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

/** Hull colors that turn a little brighter on the Moon (no red dust settling on them). */
const HULL_COLORS = new Set([C.hab, C.habShade, C.white, '#d8d4cc'].map((c) => new THREE.Color(c).getHex()));

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
  private ghostMat = new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.4 });
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
  private crew: Array<{ obj: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number; speed: number }> = [];
  private crewCount = 0;
  private scene?: StageScene;
  private prevLevels?: Levels;
  private pops: Array<{ obj: THREE.Object3D; t: number }> = [];
  private dust: THREE.Points;
  private trail: THREE.Points;
  private night = 0;
  private storming = 0;
  private site: Site = 'mars';
  private marsGround: THREE.Group;
  /** Built the first time the Moon is shown. */
  private moonGround?: THREE.Group;
  private hull: Array<{ m: THREE.MeshPhongMaterial; base: THREE.Color }> = [];

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
    this.group.add(this.ambient, this.sunLight, this.sunLight.target);

    this.marsGround = this.buildMarsGround();
    this.group.add(this.marsGround);
    this.group.add(this.buildHab());
    const o2 = this.buildO2();
    this.fan = o2.getObjectByName('fan')!;
    this.group.add(o2);
    this.group.add(this.buildGreenhouse(SPOT.greenhouse, 1.8));
    this.group.add(this.buildShelter());
    this.group.add(this.buildWorkshop());
    const { pad, rocket, bar } = this.buildRocket();
    this.group.add(pad);
    this.rocket = rocket;
    this.fuelBar = bar;
    this.group.add(rocket);

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

    this.group.add(this.ghost);
    for (let i = 0; i < 6; i++) this.crew.push(this.buildAstronaut(i));

    this.dust = this.buildDust();
    this.group.add(this.dust);
    this.trail = this.buildTrail();
    this.group.add(this.trail);

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

  /** Ground height. Both sites keep the base pad (within 11 units) perfectly flat at 0. */
  private height(x: number, z: number) {
    return this.site === 'moon' ? moonHeight(x, z) : marsHeight(x, z);
  }

  /** Gale Crater from real Mars Trek elevations (Mount Sharp included), plus rocks near the base. */
  private buildMarsGround() {
    const g = new THREE.Group();
    g.name = 'mars-ground';
    const r = rand(7);
    const cA = new THREE.Color(C.rust);
    const cB = new THREE.Color(C.oxide);
    const cC = new THREE.Color(C.dust);
    const geo = groundGeometry(GROUND_RADIUS, 72, 1.8, marsHeight, (_x, _z, y) => {
      const k = r();
      const c = k < 0.45 ? cA : k < 0.85 ? cB : cC;
      return c.clone().lerp(cC, THREE.MathUtils.clamp(y / 8, 0, 1) * 0.5);
    });
    const ground = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
    ground.receiveShadow = true;
    g.add(ground);

    // Rocks.
    const rockMat = mat('#6e3418');
    const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2;
      const d = 9 + r() * 16;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const rock = mesh(rockGeo, rockMat, x, marsHeight(x, z) + 0.1, z);
      const s = 0.5 + r() * 1.6;
      rock.scale.set(s, s * (0.5 + r() * 0.5), s);
      rock.rotation.set(r() * 3, r() * 3, r() * 3);
      g.add(rock);
    }
    return g;
  }

  /** Made-up Moon ground: gray regolith, lots of craters, boulders, and the Earth in the sky. */
  private buildMoonGround() {
    const g = new THREE.Group();
    g.name = 'moon-ground';
    const r = rand(1972);
    const greys = ['#8d8b87', '#7d7c79', '#96948f'].map((c) => new THREE.Color(c));
    const bright = new THREE.Color('#c4c2bc');
    const dark = new THREE.Color('#4f4f52');
    const geo = groundGeometry(110, 84, 1.2, moonHeight, (x, z) => {
      const base = greys[Math.floor(r() * greys.length)].clone();
      const t = moonTone(x, z);
      return t >= 0 ? base.lerp(bright, t * 2) : base.lerp(dark, -t * 2);
    });
    const ground = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
    ground.receiveShadow = true;
    g.add(ground);

    // Boulders.
    const rockMat = mat('#5d5d60');
    const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
    for (let i = 0; i < 80; i++) {
      const a = r() * Math.PI * 2;
      const d = 9 + r() * 30;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const rock = mesh(rockGeo, rockMat, x, moonHeight(x, z) + 0.1, z);
      const s = 0.4 + r() * 1.4;
      rock.scale.set(s, s * (0.6 + r() * 0.5), s);
      rock.rotation.set(r() * 3, r() * 3, r() * 3);
      g.add(rock);
    }

    g.add(buildEarth());
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
    pad.position.set(x, this.height(x, z), z);
    const g = new THREE.Group();
    g.name = 'rocket';
    const body = mesh(new THREE.CylinderGeometry(0.55, 0.62, 4.4, 10), mat(C.white), 0, 2.6, 0);
    g.add(body);
    g.add(mesh(new THREE.ConeGeometry(0.55, 1.3, 10), mat(C.white), 0, 5.45, 0));
    const finMat = mat(C.oxide);
    for (let i = 0; i < 4; i++) {
      const fin = mesh(new THREE.BoxGeometry(0.1, 0.9, 0.7), finMat, Math.cos((i * Math.PI) / 2) * 0.62, 0.85, Math.sin((i * Math.PI) / 2) * 0.62);
      fin.rotation.y = -(i * Math.PI) / 2;
      g.add(fin);
    }
    // Fuel gauge stripe: its height shows how full the tank is.
    g.add(mesh(new THREE.BoxGeometry(0.26, 3.4, 0.06), mat('#163030'), 0, 2.6, 0.6));
    const barMat = mat('#0f3f3c', { emissive: new THREE.Color(C.cyan), emissiveIntensity: 1.2 });
    this.glow.fuel.push(barMat);
    const bar = mesh(new THREE.BoxGeometry(0.2, 3.4, 0.08), barMat, 0, 0.9, 0.62);
    bar.geometry.translate(0, 1.7, 0);
    bar.castShadow = false;
    g.add(bar);
    g.position.set(x, this.height(x, z), z);
    return { pad, rocket: g, bar };
  }

  private buildMonitor() {
    const g = new THREE.Group();
    const [x, z] = SPOT.monitor;
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 5), mat(C.metal), 0, 1.6, 0));
    const dish = mesh(new THREE.SphereGeometry(0.6, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(C.white, { side: THREE.DoubleSide }), 0, 3.2, 0);
    dish.rotation.x = -2.2;
    g.add(dish);
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
    const suit = mat(i % 2 ? C.orange : C.white);
    g.add(mesh(new THREE.CapsuleGeometry(0.16, 0.3, 2, 6), suit, 0, 0.35, 0));
    g.add(mesh(new THREE.IcosahedronGeometry(0.17, 0), mat(C.white), 0, 0.72, 0));
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), mat('#202838', { emissive: new THREE.Color(C.amber), emissiveIntensity: 0.4 }), 0, 0.73, 0.15));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.26, 0.12), mat(C.habShade), 0, 0.42, -0.17));
    g.visible = false;
    this.group.add(g);
    const p = this.waypoint(i);
    g.position.copy(p);
    return { obj: g, from: p.clone(), to: this.waypoint(i + 3), t: Math.random(), speed: 0.12 + Math.random() * 0.08 };
  }

  private waypoint(i: number): THREE.Vector3 {
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
    return new THREE.Vector3(x, this.height(x, z), z);
  }

  private buildDust() {
    const n = 500;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const r = rand(99);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (r() - 0.5) * 50;
      p[i * 3 + 1] = r() * 10;
      p[i * 3 + 2] = (r() - 0.5) * 50;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#e8b57a', size: 0.18, transparent: true, opacity: 0 }));
    return pts;
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

  /** Switch the scenery between Mars and the Moon. The base itself stays where it is. */
  setSite(site: Site) {
    if (site === this.site) return;
    this.site = site;
    const moon = site === 'moon';
    if (moon && !this.moonGround) {
      this.moonGround = this.buildMoonGround();
      this.group.add(this.moonGround);
    }
    this.marsGround.visible = !moon;
    if (this.moonGround) this.moonGround.visible = moon;
    // Hulls look a little whiter on the Moon: no red dust settling on them.
    const white = new THREE.Color('#ffffff');
    for (const { m, base } of this.hull) m.color.copy(base).lerp(white, moon ? 0.35 : 0);
    this.ambient.groundColor.set(moon ? '#3a3a40' : '#6b2e16');
    // No air, no dust.
    if (moon) (this.dust.material as THREE.PointsMaterial).opacity = 0;
  }

  get currentSite(): Site {
    return this.site;
  }

  /** Ground height at a scene position, for the current site. */
  groundHeight(x: number, z: number) {
    return this.height(x, z);
  }

  setScene(s: StageScene) {
    this.setSite(s.site ?? 'mars');
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

    // Blueprint of the project the Workshop is building.
    this.ghost.clear();
    if (s.project && s.projectProgress !== undefined) {
      const src = s.project === 'panel' ? this.panels[Math.min(this.panels.length - 1, 3 + s.levels.panel)] : this.upgrades[s.project][0];
      if (src && !(s.project !== 'panel' && s.levels[s.project] > 0)) {
        const copy = src.clone(true);
        copy.visible = true;
        copy.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            (o as THREE.Mesh).material = this.ghostMat;
            o.castShadow = false;
          }
        });
        const k = Math.max(0.05, s.projectProgress);
        copy.scale.set(1, k, 1);
        this.ghostMat.opacity = 0.25 + 0.5 * k;
        this.ghost.add(copy);
      }
    }

    // Crew: walk around outside by day (unless sheltering from a storm).
    this.crewCount = s.crew;
    this.crew.forEach((c, i) => (c.obj.visible = i < s.crew));

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
  }

  setNight(night: number) {
    this.night = night;
    this.glow.hab.forEach((m) => (m.emissiveIntensity = 0.3 + night * 1.2));
  }

  storm(intensity: number) {
    this.storming = Math.max(this.storming, intensity);
  }

  tick(dt: number, time: number, reduced: boolean) {
    const s = this.scene;
    if (!s) return;
    // Fan spins with power.
    if (s.alloc.air + s.alloc.fuel > 0 && !reduced) this.fan.rotation.y += dt * (2 + s.alloc.air + s.alloc.fuel);
    // Monitor blink.
    if (s.alloc.monitor) this.glow.monitor.forEach((m) => (m.emissiveIntensity = Math.sin(time * 6) > 0 ? 1.6 : 0.2));
    // Greenhouse grow lights: brighter with more power, and they glow through the night.
    const gh = 0.1 + Math.min(1, s.alloc.greenhouse / 3) * 0.8 + this.night * 0.6;
    this.glow.greenhouse.forEach((m) => (m.emissiveIntensity = gh));
    // Reactor hum.
    this.glow.reactor.forEach((m) => (m.emissiveIntensity = 0.8 + Math.sin(time * 2) * 0.3));
    // Crew walk between waypoints by day; inside at night or when sheltering.
    const outside = this.night < 0.5 && !(s.sheltered && this.storming > 0.05);
    this.crew.forEach((c, i) => {
      c.obj.visible = outside && i < this.crewCount;
      if (!c.obj.visible) return;
      c.t += dt * c.speed;
      if (c.t >= 1) {
        c.t = 0;
        c.from.copy(c.to);
        c.to = this.waypoint(Math.floor(Math.random() * 8));
      }
      c.obj.position.lerpVectors(c.from, c.to, c.t);
      c.obj.position.y = this.height(c.obj.position.x, c.obj.position.z) + (reduced ? 0 : Math.abs(Math.sin(time * 8 + i)) * 0.05);
      c.obj.lookAt(c.to.x, c.obj.position.y, c.to.z);
    });
    // Pop-in animation for freshly built pieces.
    this.pops = this.pops.filter((p) => {
      p.t += dt * 1.6;
      const k = Math.min(1, p.t);
      const s2 = reduced ? 1 : 1 + Math.sin(k * Math.PI) * 0.25;
      p.obj.scale.set(s2, Math.max(0.01, k) * s2, s2);
      if (k >= 1) p.obj.scale.set(1, 1, 1);
      return k < 1;
    });
    // Ghost blueprint shimmer.
    if (!reduced) this.ghostMat.opacity = Math.max(0.15, this.ghostMat.opacity * 0.98 + (0.35 + 0.15 * Math.sin(time * 3)) * 0.02);
    // Dust particles drift when it's dusty (never on the Moon: there is no wind to lift it).
    const dustTarget = this.site === 'moon' ? 0 : s.weather === 'storm' ? 0.85 : s.weather === 'dusty' ? 0.5 : 0;
    const dm = this.dust.material as THREE.PointsMaterial;
    dm.opacity += (dustTarget - dm.opacity) * Math.min(1, dt * 2);
    if (dm.opacity > 0.01 && !reduced) {
      const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i) + dt * 3;
        if (x > 25) x -= 50;
        p.setX(i, x);
      }
      p.needsUpdate = true;
    }
    this.storming = Math.max(0, this.storming - dt * 0.35);
  }

  get stormLevel() {
    return this.storming;
  }

  dustLevel() {
    return (this.dust.material as THREE.PointsMaterial).opacity;
  }

  // ------------------------------------------------------------------ launch

  rocketPosition() {
    return this.rocket.position;
  }

  /** k: 0..1 through the launch. Returns rocket height above the pad. */
  launchStep(k: number) {
    const [x, z] = SPOT.rocket;
    const base = this.height(x, z);
    const h = k < 0.15 ? 0 : Math.pow((k - 0.15) / 0.85, 2.2) * 90;
    this.rocket.position.y = base + h;
    const shake = k < 0.2 ? (Math.random() - 0.5) * 0.08 : 0;
    this.rocket.position.x = x + shake;
    // Exhaust trail.
    const tm = this.trail.material as THREE.PointsMaterial;
    tm.opacity = k > 0.05 ? 0.9 : 0;
    const p = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const f = i / p.count;
      const y = base + Math.max(0, h - f * 20) - 0.2;
      const spread = f * 2.2;
      p.setXYZ(i, x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
    }
    p.needsUpdate = true;
    return h;
  }

  resetLaunch() {
    const [x, z] = SPOT.rocket;
    this.rocket.position.set(x, this.height(x, z), z);
    (this.trail.material as THREE.PointsMaterial).opacity = 0;
  }
}
