// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The 3D world of a rover drive (loaded only when a drive starts, so three.js and the elevation grids never slow the
// title screen). The game's retro look: low-resolution rendering, PS1 vertex wobble and the dithered post-process
// from src/render/retro.ts.
//
// The ground (see ./sites.ts for the scales, said so on the start card):
// - Gale Crater and Arcadia Planitia: REAL heights from NASA Mars Trek (MOLA + HRSC, 200 m/pixel), read through the
//   same samplers as the base diorama (galeRelativeMeters in src/render/gale.ts, arcadiaRelativeMeters in
//   src/render/arcadia.ts). 1 game meter = MARS_SHRINK (100) real meters side to side; heights shrunk the same and
//   then exaggerated x MARS_EXAGGERATION (1.5), like the diorama. North is +z and east is -x, as in the diorama.
//   Small bumps (under about a meter), rocks and frost patches are made up.
// - The Moon: the diorama's made-up cratered ground (src/render/moon.ts), drawn MOON_SCALE (9) game meters per unit.
//
// Draw calls stay low (instanced rocks, targets, beacons and wheels; one terrain mesh; two particle clouds), and
// dispose() frees every geometry, material, render target and the WebGL context.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { galeRelativeMeters } from '../../render/gale';
import { arcadiaRelativeMeters } from '../../render/arcadia';
import { buildEarth, moonCraters, moonHeight, moonTone } from '../../render/moon';
import { SNAP, makePostMaterial, makeSkyMaterial, mat } from '../../render/retro';
import { Heightfield } from './terrain';
import { MARS_EXAGGERATION, MARS_SHRINK, MOON_SCALE, WORLD_RADIUS, DRIVE_RADIUS, type RoverSite } from './sites';
import { RARITY_COLOR, sampleKind, type Rarity } from './samples';
import { PAD_RADIUS, devilAt, forward, slopeAt, type DustDevil, type RoverState } from './physics';
import { seeded } from './rng';
import type { TargetPlan } from './targets';

const smooth = (x: number, a: number, b: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Made-up small bumps (under about a meter) for the feel of driving: the real data is too coarse to show them. */
function bumps(x: number, z: number): number {
  return 0.6 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 - 0.4) + 0.35 * Math.sin((x + z) * 0.09) + 0.2 * Math.sin(x * 0.13 - z * 0.11 + 2);
}

/** Diorama units (1 km of Mars each) for a game position. */
const kmUnits = (m: number) => (m * MARS_SHRINK) / 1000;
/** Real meters of height to game meters: shrunk like the map, then exaggerated. */
const marsUp = (realM: number) => (realM / MARS_SHRINK) * MARS_EXAGGERATION;

/** Ground height at a game position, for each site. Flat on the charging pad. */
export function siteHeight(site: RoverSite): (x: number, z: number) => number {
  if (site === 'moon') {
    return (x, z) => {
      const r = Math.hypot(x, z);
      return moonHeight(x / MOON_SCALE, z / MOON_SCALE) * MOON_SCALE + bumps(x, z) * 0.6 * smooth(r, 20, 60);
    };
  }
  const real = site === 'arcadia' ? arcadiaRelativeMeters : galeRelativeMeters;
  const bump = site === 'arcadia' ? 0.7 : 1;
  return (x, z) => {
    const k = smooth(Math.hypot(x, z), 16, 46);
    if (k <= 0) return 0;
    return k * (marsUp(real(kmUnits(x), kmUnits(z))) + bumps(x, z) * bump);
  };
}

/** Grid cells across the map (about 10 m each). */
export const GRID = 180;

export function buildField(site: RoverSite): Heightfield {
  return new Heightfield(siteHeight(site), WORLD_RADIUS, GRID);
}

export interface PlacedTarget extends TargetPlan {
  y: number;
  rarity: Rarity;
}

/**
 * Settle each planned target onto drivable ground near its planned spot (the same for everyone: no randomness).
 * Moon crater samples go onto the floor of the nearest crater that is big enough.
 */
export function placeTargets(plans: TargetPlan[], site: RoverSite, field: Heightfield): PlacedTarget[] {
  const craters = site === 'moon' ? moonCraters().map((c) => ({ x: c.x * MOON_SCALE, z: c.z * MOON_SCALE, r: c.r * MOON_SCALE })) : [];
  const used = new Set<number>();
  const out: PlacedTarget[] = [];
  for (const p of plans) {
    const kind = sampleKind(p.kind);
    let x = p.x;
    let z = p.z;
    if (kind?.place.kind === 'crater' && craters.length) {
      let best = -1;
      let bestD = Infinity;
      craters.forEach((c, i) => {
        const fromPad = Math.hypot(c.x, c.z);
        if (c.r < 14 || fromPad < 120 || fromPad > DRIVE_RADIUS - 60) return;
        const d = Math.hypot(c.x - p.x, c.z - p.z) + (used.has(i) ? 400 : 0);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) {
        const c = craters[best];
        const shift = used.has(best) ? 0.45 * c.r : 0;
        used.add(best);
        x = c.x + shift;
        z = c.z;
      }
    } else {
      // Look outward in rings for gentle ground (rise under 0.3 per meter), away from the pad and the map edge.
      search: for (let ring = 0; ring <= 6; ring++) {
        const steps = ring === 0 ? 1 : 10;
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2 + ring;
          const cx = p.x + Math.cos(a) * ring * 12;
          const cz = p.z + Math.sin(a) * ring * 12;
          const r = Math.hypot(cx, cz);
          if (r < 90 || r > DRIVE_RADIUS - 40) continue;
          if (slopeAt(field, cx, cz).steep < 0.3) {
            x = cx;
            z = cz;
            break search;
          }
        }
      }
    }
    out.push({ ...p, x, z, y: field.height(x, z), rarity: kind?.rarity ?? 'common' });
  }
  return out;
}

// ------------------------------------------------------------------ looks per site
interface Look {
  zenith: string;
  horizon: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: THREE.Vector3;
  sunColor: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  rock: string;
  dust: string;
  airless: boolean;
  postDust: number;
}

const LOOKS: Record<RoverSite, Look> = {
  gale: {
    zenith: '#b98a5d', horizon: '#e9bd8c', fog: '#d9a066', fogNear: 140, fogFar: 760,
    sun: new THREE.Vector3(0.45, 0.78, -0.35).normalize(), sunColor: '#fff1d6', sunI: 2.0,
    hemiSky: '#f2d2a8', hemiGround: '#6b2e16', hemiI: 1.05, rock: '#6e3418', dust: '#c98a52', airless: false, postDust: 0.06,
  },
  arcadia: {
    zenith: '#b0906f', horizon: '#e6c9a6', fog: '#dcb592', fogNear: 150, fogFar: 780,
    sun: new THREE.Vector3(0.5, 0.62, -0.5).normalize(), sunColor: '#fff4e2', sunI: 1.8,
    hemiSky: '#f0dcc4', hemiGround: '#5e3020', hemiI: 1.05, rock: '#5a3020', dust: '#c79a74', airless: false, postDust: 0.05,
  },
  moon: {
    // Near the south pole the Sun stays close to the horizon.
    zenith: '#000000', horizon: '#06060a', fog: '#000000', fogNear: 520, fogFar: 1300,
    sun: new THREE.Vector3(0.82, 0.12, -0.56).normalize(), sunColor: '#ffffff', sunI: 2.8,
    hemiSky: '#c9ccd6', hemiGround: '#151518', hemiI: 0.32, rock: '#5d5d60', dust: '#a19f99', airless: true, postDust: 0,
  },
};

function groundColors(site: RoverSite, field: Heightfield): Float32Array {
  const n = field.n + 1;
  const out = new Float32Array(n * n * 3);
  const r = seeded(77 + site.length);
  const c = new THREE.Color();
  const tones =
    site === 'gale' ? ['#8a3a1c', '#b2552a', '#9c4a24'] : site === 'arcadia' ? ['#94543a', '#a2623f', '#b27a55'] : ['#8d8b87', '#7d7c79', '#96948f'];
  const toneC = tones.map((t) => new THREE.Color(t));
  const light = new THREE.Color(site === 'moon' ? '#c4c2bc' : site === 'arcadia' ? '#e3e8ec' : '#d9a066');
  const dark = new THREE.Color(site === 'moon' ? '#3a3a3e' : '#5a2a14');
  const band = new THREE.Color('#e0a878');
  const craters = site === 'moon' ? moonCraters() : [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = field.coord(ix);
      const z = field.coord(iz);
      const y = field.at(ix, iz);
      c.copy(toneC[Math.floor(r() * toneC.length)]);
      if (site === 'gale') {
        c.lerp(light, Math.max(0, Math.min(1, y / 70)) * 0.45);
        // Mount Sharp's layers: pale bands by height (for the look; real layers are much thinner).
        if (y > 14 && Math.sin(y * 0.9) > 0.55) c.lerp(band, 0.35);
      } else if (site === 'arcadia') {
        // Made-up frost patches, for the look.
        const f = Math.sin(x * 0.023 + 1.7) * Math.cos(z * 0.019 - 0.4) + 0.6 * Math.sin(x * 0.007 - z * 0.011 + 2.1);
        c.lerp(light, Math.max(0, Math.min(1, (f - 0.45) * 1.6)) * 0.75);
      } else {
        const t = moonTone(x / MOON_SCALE, z / MOON_SCALE);
        if (t >= 0) c.lerp(light, t * 2);
        else c.lerp(dark, -t * 2);
        // Crater floors near the pole sit in shadow: darker still.
        for (const cr of craters) {
          const d = Math.hypot(x / MOON_SCALE - cr.x, z / MOON_SCALE - cr.z) / cr.r;
          if (d < 0.75 && cr.r * MOON_SCALE >= 14) c.lerp(dark, 0.55 * (1 - d / 0.75) + 0.2);
        }
      }
      if (ix === 0 || iz === 0) c.multiplyScalar(0.9);
      out.set([c.r, c.g, c.b], (iz * n + ix) * 3);
    }
  }
  return out;
}

function terrainMesh(site: RoverSite, field: Heightfield): THREE.Mesh {
  const n = field.n + 1;
  const pos = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) pos.set([field.coord(ix), field.at(ix, iz), field.coord(iz)], (iz * n + ix) * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(groundColors(site, field), 3));
  geo.setIndex(new THREE.BufferAttribute(field.triangleIndex(), 1));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat('#ffffff', { vertexColors: true }));
  m.name = 'ground';
  return m;
}

/** Stripes so a spinning wheel or a twisting dust devil shows its turn. */
function striped(geo: THREE.BufferGeometry, a: string, b: string, axis: 'y' | 'x', parts: number): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  geo.dispose();
  const p = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  for (let i = 0; i < p.count; i += 3) {
    let u = 0;
    let v = 0;
    for (let k = 0; k < 3; k++) {
      u += axis === 'y' ? p.getX(i + k) : p.getY(i + k);
      v += p.getZ(i + k);
    }
    const ang = Math.atan2(v, u) + Math.PI;
    const c = Math.floor((ang / (Math.PI * 2)) * parts) % 2 ? ca : cb;
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function colored(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Wheel spots on the rover (local: +z is forward, +x is the rover's left). Six wheels, like Curiosity. */
export const WHEELS: Array<[number, number]> = [
  [1.15, 1.2], [-1.15, 1.2], [1.25, 0], [-1.25, 0], [1.15, -1.2], [-1.15, -1.2],
];
const WHEEL_R = 0.45;

// ------------------------------------------------------------------ the world
export interface FrameView {
  rover: RoverState;
  dt: number;
  time: number;
  lights: boolean;
  boosting: boolean;
  /** Index of the target being scanned (-1: none), and how far along (0..1). */
  scanning: number;
  scanProgress: number;
  devils: DustDevil[];
}

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TARGET_HEIGHT = 300;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class RoverWorld {
  readonly field: Heightfield;
  readonly targets: PlacedTarget[];
  readonly canvas: HTMLCanvasElement;
  private readonly site: RoverSite;
  private readonly look: Look;
  private readonly reduced: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 1800);
  private rt: THREE.WebGLRenderTarget;
  private post: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sky: THREE.ShaderMaterial;
  private skyMesh: THREE.Mesh;
  private rover = new THREE.Group();
  private chassis = new THREE.Group();
  private wheels: THREE.InstancedMesh;
  private wheelSpin = 0;
  private lampMat: THREE.MeshBasicMaterial;
  private headlight: THREE.SpotLight;
  private rocks: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private markers: THREE.InstancedMesh;
  private devilMesh: THREE.InstancedMesh | null = null;
  private homeBeam: THREE.Object3D | null = null;
  private scanBeam: THREE.Mesh;
  private dust: Particles;
  private sparks: Particles;
  private targetState: Array<'open' | 'aboard' | 'banked'>;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camReady = false;
  private shake = 0;
  private savedSnap = SNAP.value.clone();
  private disposed = false;
  private size = { w: 0, h: 0 };

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor(site: RoverSite, plans: TargetPlan[], devils: DustDevil[], reduced: boolean) {
    this.site = site;
    this.look = LOOKS[site];
    this.reduced = reduced;
    this.field = buildField(site);
    this.targets = placeTargets(plans, site, this.field);
    this.targetState = this.targets.map(() => 'open');

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', alpha: false });
    // Pixel ratio 1 at a low internal resolution, upscaled with crisp pixels (well under the 1.5 cap).
    this.renderer.setPixelRatio(1);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'ev-rover-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.rt = new THREE.WebGLRenderTarget(320, 180, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.post = makePostMaterial(this.rt);
    this.post.uniforms.uDust.value = this.look.postDust;
    this.post.uniforms.uVignette.value = 0.5;
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));

    const L = this.look;
    // Sky and air.
    this.sky = makeSkyMaterial();
    const u = this.sky.uniforms;
    (u.uZenith.value as THREE.Color).set(L.zenith);
    (u.uHorizon.value as THREE.Color).set(L.horizon);
    (u.uSunDir.value as THREE.Vector3).copy(L.sun);
    (u.uSunGlow.value as THREE.Color).set(L.airless ? '#4a4a4a' : '#f6e7c8');
    u.uStars.value = L.airless ? 1 : 0;
    u.uSunDisc.value = L.airless ? 1 : 0;
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), this.sky);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
    this.scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    this.scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiI));
    const sun = new THREE.DirectionalLight(L.sunColor, L.sunI);
    sun.position.copy(L.sun).multiplyScalar(100);
    this.scene.add(sun);

    this.scene.add(terrainMesh(site, this.field));
    this.scene.add(this.buildOutpost());
    this.rocks = this.buildRocks();
    this.scene.add(this.rocks);
    if (site === 'moon') {
      // The Earth hangs low over the horizon near the lunar south pole, about its real size in the sky (1.9 degrees).
      const earth = buildEarth();
      earth.scale.setScalar(8);
      earth.position.set(-760, 60, -980);
      this.scene.add(earth);
    }

    // Targets: rocks to scan, tall beacons and little spinning markers (one draw call each).
    const n = Math.max(1, this.targets.length);
    const sampleMat = mat('#ffffff');
    this.markers = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.1, 0), sampleMat, n);
    this.beams = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.8, 0.8, 140, 8, 1, true).translate(0, 70, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
      n,
    );
    this.beams.frustumCulled = false;
    this.markers.frustumCulled = false;
    const c = new THREE.Color();
    this.targets.forEach((t, i) => {
      c.set(sampleKind(t.kind)?.color ?? '#888888');
      this.markers.setColorAt(i, c);
      c.set(RARITY_COLOR[t.rarity]);
      this.beams.setColorAt(i, c);
    });
    this.scene.add(this.markers, this.beams);

    const built = this.buildRover();
    this.wheels = built.wheels;
    this.lampMat = built.lampMat;
    this.headlight = built.headlight;
    this.scene.add(this.rover);

    this.scanBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 1.3, 1, 10, 1, true).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: '#5ef2e6', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.scanBeam.visible = false;
    this.scene.add(this.scanBeam);

    if (devils.length) {
      const geo = striped(new THREE.CylinderGeometry(6, 1.2, 34, 12, 1, true).translate(0, 17, 0), '#d9a066', '#b07040', 'y', 6);
      this.devilMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }), devils.length);
      this.devilMesh.frustumCulled = false;
      this.scene.add(this.devilMesh);
    }

    this.dust = new Particles(reduced ? 120 : 220, L.dust, 0.2, 0.75);
    this.sparks = new Particles(reduced ? 40 : 140, '#ffffff', 0.22, 1, true);
    this.scene.add(this.dust.points, this.sparks.points);
    this.updateTargets(0);
  }

  // ---------------------------------------------------------------- building
  private buildOutpost(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'outpost';
    const y0 = this.field.height(0, 0);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS + 0.5, 0.3, 20), mat('#4a4f63'));
    pad.position.set(0, y0 + 0.05, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(PAD_RADIUS - 1.1, PAD_RADIUS - 0.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5ef2e6' }));
    ring.position.set(0, y0 + 0.22, 0);
    // A tall cyan light over the pad, so home is easy to find.
    const home = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 160, 8, 1, true).translate(0, 80, 0),
      new THREE.MeshBasicMaterial({ color: '#5ef2e6', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    home.position.set(0, y0, 0);
    this.homeBeam = home;
    // The habitat, solar panels and a radio mast beside the pad (merged into one mesh).
    const parts: THREE.BufferGeometry[] = [];
    const hy = (x: number, z: number) => this.field.height(x, z);
    parts.push(colored(new THREE.SphereGeometry(4.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#e9e3d6', 17, hy(17, 13) - 0.2, 13));
    parts.push(colored(new THREE.CylinderGeometry(4.3, 4.3, 0.8, 10), '#c9c2b4', 17, hy(17, 13) + 0.2, 13));
    for (let i = 0; i < 3; i++) {
      const px = -15 - i * 4.4;
      const panel = new THREE.BoxGeometry(3.8, 0.15, 2.4).rotateX(-0.5);
      parts.push(colored(panel, '#26386e', px, hy(px, -8) + 1.4, -8));
      parts.push(colored(new THREE.BoxGeometry(0.2, 1.4, 0.2), '#9aa0b5', px, hy(px, -8) + 0.7, -8));
    }
    parts.push(colored(new THREE.CylinderGeometry(0.15, 0.2, 7, 6), '#9aa0b5', 13, hy(13, -15) + 3.5, -15));
    parts.push(colored(new THREE.SphereGeometry(0.9, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI * 0.75), '#e9e3d6', 13, hy(13, -15) + 7, -15));
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    const base = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), mat('#ffffff', { vertexColors: true }));
    g.add(pad, ring, home, base);
    return g;
  }

  private buildRocks(): THREE.InstancedMesh {
    const count = 260;
    const m = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), mat(this.look.rock), count);
    const r = seeded(4242 + this.site.length * 7);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = 22 + Math.sqrt(r()) * (WORLD_RADIUS - 60);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = r() < 0.08 ? 1.6 + r() * 1.8 : 0.3 + r() * 0.9;
      _q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      _m.compose(_v.set(x, this.field.height(x, z) + s * 0.15, z), _q, _s.set(s, s * (0.5 + r() * 0.5), s));
      m.setMatrixAt(i, _m);
    }
    return m;
  }

  private buildRover(): { wheels: THREE.InstancedMesh; lampMat: THREE.MeshBasicMaterial; headlight: THREE.SpotLight } {
    const parts: THREE.BufferGeometry[] = [];
    // Body, deck, the power unit at the back, and the mast with its camera head (about Curiosity's size: 3 m long).
    parts.push(colored(new THREE.BoxGeometry(2.0, 0.7, 2.9), '#e9e3d6', 0, 1.05, 0));
    parts.push(colored(new THREE.BoxGeometry(2.2, 0.12, 3.1), '#9aa0b5', 0, 1.46, 0));
    parts.push(colored(new THREE.BoxGeometry(1.2, 0.6, 0.8), '#4a4f63', 0, 1.3, -1.6));
    parts.push(colored(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 6), '#9aa0b5', 0.6, 2.2, 1.0));
    parts.push(colored(new THREE.BoxGeometry(0.7, 0.36, 0.42), '#e9e3d6', 0.6, 3.0, 1.05));
    parts.push(colored(new THREE.BoxGeometry(0.5, 0.18, 0.08), '#202838', 0.6, 3.02, 1.28));
    parts.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 4), '#4a4f63', -0.7, 2.0, -0.6));
    // Rocker-bogie legs.
    for (const side of [1, -1]) {
      parts.push(colored(new THREE.BoxGeometry(0.12, 0.12, 2.6), '#4a4f63', side * 1.15, 0.85, 0.05));
      parts.push(colored(new THREE.BoxGeometry(0.12, 0.5, 0.12), '#4a4f63', side * 1.15, 0.65, 1.2));
      parts.push(colored(new THREE.BoxGeometry(0.12, 0.5, 0.12), '#4a4f63', side * 1.15, 0.65, -1.2));
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    const body = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), mat('#ffffff', { vertexColors: true }));
    this.chassis.add(body);

    const lampMat = new THREE.MeshBasicMaterial({ color: '#7a6a40' });
    const lamps = new THREE.Mesh(
      mergeGeometries([new THREE.BoxGeometry(0.3, 0.16, 0.06).translate(0.6, 1.2, 1.47), new THREE.BoxGeometry(0.3, 0.16, 0.06).translate(-0.6, 1.2, 1.47)]) ?? new THREE.BufferGeometry(),
      lampMat,
    );
    this.chassis.add(lamps);
    const headlight = new THREE.SpotLight('#fff1d0', 0, 90, 0.55, 0.45, 1);
    headlight.position.set(0, 1.3, 1.5);
    headlight.target.position.set(0, -0.6, 12);
    this.chassis.add(headlight, headlight.target);

    const wheelGeo = striped(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 10).rotateZ(Math.PI / 2), '#2b2b33', '#55555f', 'x', 10);
    const wheels = new THREE.InstancedMesh(wheelGeo, mat('#ffffff', { vertexColors: true }), WHEELS.length);
    wheels.frustumCulled = false;
    this.chassis.add(wheels);
    this.rover.add(this.chassis);
    return { wheels, lampMat, headlight };
  }

  // ---------------------------------------------------------------- per frame
  setTarget(i: number, state: 'open' | 'aboard' | 'banked') {
    if (this.targetState[i] !== undefined) this.targetState[i] = state;
  }

  /** A burst of sparkles (a find); bigger for rarer samples. */
  burst(x: number, y: number, z: number, color: string, big: boolean) {
    const n = this.reduced ? (big ? 24 : 10) : big ? 110 : 40;
    const speed = this.reduced ? 3 : big ? 9 : 6;
    this.sparks.emit(n, x, y + 1, z, speed, color, 1.6);
  }

  /** A little jolt (hard landings), never with reduced motion. */
  bump(amount: number) {
    if (!this.reduced) this.shake = Math.max(this.shake, Math.min(0.6, amount));
  }

  private updateTargets(time: number, rx = 0, rz = 0) {
    const pulse = this.reduced ? 1 : 1 + 0.15 * Math.sin(time * 3);
    this.targets.forEach((t, i) => {
      const st = this.targetState[i];
      if (st === 'open') {
        // Thin the beam as the rover gets close, so the camera never sits inside it.
        const near = Math.max(0.12, Math.min(1, (Math.hypot(t.x - rx, t.z - rz) - 6) / 40));
        _q.setFromAxisAngle(Y_AXIS, time * (this.reduced ? 0.3 : 0.9) + i);
        _m.compose(_v.set(t.x, t.y + 1.0 + (this.reduced ? 0 : Math.sin(time * 2 + i) * 0.25), t.z), _q, _s.set(1, 1, 1));
        this.markers.setMatrixAt(i, _m);
        _m.compose(_v.set(t.x, t.y, t.z), _q.identity(), _s.set(pulse * near, 1, pulse * near));
        this.beams.setMatrixAt(i, _m);
      } else {
        this.markers.setMatrixAt(i, HIDDEN);
        this.beams.setMatrixAt(i, HIDDEN);
      }
    });
    this.markers.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  private placeRover(v: FrameView) {
    const s = v.rover;
    this.rover.position.set(s.x, s.y, s.z);
    // Tilt with the ground (or keep the last tilt in the air, nose following the climb or fall).
    const f = forward(s.heading);
    const up = s.grounded ? this.field.normal(s.x, s.z) : { x: 0, y: 1, z: 0 };
    _v.set(up.x, up.y, up.z).normalize();
    _v2.set(f.x, 0, f.z);
    _v2.addScaledVector(_v, -_v2.dot(_v)).normalize();
    if (!s.grounded) _v2.y += Math.max(-0.35, Math.min(0.35, s.vy * 0.04));
    _v2.normalize();
    const xAxis = new THREE.Vector3().crossVectors(_v, _v2).normalize();
    const yAxis = new THREE.Vector3().crossVectors(_v2, xAxis).normalize();
    _m.makeBasis(xAxis, yAxis, _v2);
    _q.setFromRotationMatrix(_m);
    const k = 1 - Math.exp(-v.dt * (s.grounded ? 12 : 4));
    this.chassis.quaternion.slerp(_q, k);

    this.wheelSpin += (s.speed * v.dt) / WHEEL_R;
    WHEELS.forEach(([wx, wz], i) => {
      // Each wheel follows the ground under it a little (a simple suspension).
      let drop = 0;
      if (s.grounded) {
        _v.set(wx, 0, wz).applyQuaternion(this.chassis.quaternion);
        const gy = this.field.height(s.x + _v.x, s.z + _v.z);
        drop = Math.max(-0.25, Math.min(0.25, gy - (s.y + _v.y)));
      }
      _q.setFromAxisAngle(X_AXIS, this.wheelSpin);
      _m.compose(_v.set(wx, WHEEL_R + drop, wz), _q, _s.set(1, 1, 1));
      this.wheels.setMatrixAt(i, _m);
    });
    this.wheels.instanceMatrix.needsUpdate = true;

    this.headlight.intensity = v.lights ? 40 : 0;
    this.lampMat.color.set(v.lights ? '#fff4c8' : '#7a6a40');
  }

  private placeCamera(v: FrameView) {
    const s = v.rover;
    const f = forward(s.heading);
    const back = 10.5 + Math.min(4, Math.abs(s.speed) * 0.18);
    const goal = _v.set(s.x - f.x * back, s.y + 4.4, s.z - f.z * back);
    const look = _v2.set(s.x + f.x * 5, s.y + 1.6, s.z + f.z * 5);
    if (!this.camReady) {
      this.camPos.copy(goal);
      this.camLook.copy(look);
      this.camReady = true;
    }
    const k = 1 - Math.exp(-v.dt * (this.reduced ? 3 : 4.5));
    this.camPos.lerp(goal, k);
    this.camLook.lerp(look, Math.min(1, k * 1.6));
    const floor = this.field.height(this.camPos.x, this.camPos.z) + 1.6;
    if (this.camPos.y < floor) this.camPos.y = floor;
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() * 2 - 1) * this.shake;
      this.camera.position.y += (Math.random() * 2 - 1) * this.shake;
      this.shake *= Math.exp(-v.dt * 10);
    }
    this.camera.lookAt(this.camLook);
    const fov = 62 + (v.boosting && !this.reduced ? 6 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, v.dt * 4);
      this.camera.updateProjectionMatrix();
    }
    this.skyMesh.position.copy(this.camera.position);
  }

  private placeScanBeam(v: FrameView) {
    const t = v.scanning >= 0 ? this.targets[v.scanning] : null;
    if (!t || v.scanProgress <= 0) {
      this.scanBeam.visible = false;
      return;
    }
    // From the mast's camera head down to the sample.
    _v.set(0.6, 3.0, 1.05);
    this.chassis.localToWorld(_v);
    _v2.set(t.x, t.y + 1, t.z).sub(_v);
    const len = _v2.length();
    this.scanBeam.visible = true;
    this.scanBeam.position.copy(_v);
    this.scanBeam.quaternion.setFromUnitVectors(Y_AXIS, _v2.normalize());
    const wobble = this.reduced ? 1 : 1 + 0.25 * Math.sin(v.time * 30);
    this.scanBeam.scale.set(wobble * (0.6 + v.scanProgress * 0.6), len, wobble * (0.6 + v.scanProgress * 0.6));
    (this.scanBeam.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * v.scanProgress;
  }

  private placeDevils(v: FrameView) {
    if (!this.devilMesh) return;
    v.devils.forEach((d, i) => {
      const p = devilAt(d, v.time);
      _q.setFromAxisAngle(Y_AXIS, v.time * (this.reduced ? 1 : 3));
      _m.compose(_v.set(p.x, this.field.height(p.x, p.z) - 0.5, p.z), _q, _s.set(1, 1, 1));
      this.devilMesh!.setMatrixAt(i, _m);
    });
    this.devilMesh.instanceMatrix.needsUpdate = true;
  }

  private kickDust(v: FrameView) {
    const s = v.rover;
    const sp = Math.abs(s.speed);
    if (!s.grounded || sp < 2) return;
    const f = forward(s.heading);
    const n = Math.min(3, Math.floor(sp / 5) + (Math.random() < (sp % 5) / 5 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const x = s.x - f.x * 1.3 + -f.z * side * 1.15;
      const z = s.z - f.z * 1.3 + f.x * side * 1.15;
      const up = this.look.airless ? 1.5 + sp * 0.18 : 0.8 + sp * 0.08;
      this.dust.add(x, s.y + 0.3, z, -f.x * sp * 0.25 + (Math.random() - 0.5) * 1.5, up * (0.6 + Math.random() * 0.6), -f.z * sp * 0.25 + (Math.random() - 0.5) * 1.5, this.look.airless ? 2.2 : 1.4);
    }
  }

  frame(v: FrameView) {
    if (this.disposed) return;
    this.placeRover(v);
    this.placeCamera(v);
    // The light over the pad shows the way home; it switches off while you are on the pad.
    if (this.homeBeam) this.homeBeam.visible = Math.hypot(v.rover.x, v.rover.z) > PAD_RADIUS + 6;
    this.placeScanBeam(v);
    this.placeDevils(v);
    this.updateTargets(v.time, v.rover.x, v.rover.z);
    this.kickDust(v);
    // Moon dust flies in clean arcs and falls straight back (no air); Mars dust hangs in the thin air a while.
    const g = this.look.airless ? 1.62 : 3.71;
    this.dust.step(v.dt, this.look.airless ? g : g * 0.12, this.look.airless ? 0 : 1.6);
    this.sparks.step(v.dt, 2.5, 0.8);
    this.post.uniforms.uTime.value = v.time;
    this.sky.uniforms.uTime.value = v.time;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  resize(w: number, h: number) {
    if (this.disposed || !w || !h || (w === this.size.w && h === this.size.h)) return;
    this.size = { w, h };
    const scale = Math.max(1, Math.round(h / TARGET_HEIGHT));
    const iw = Math.max(64, Math.round(w / scale));
    const ih = Math.max(36, Math.round(h / scale));
    this.renderer.setSize(iw, ih, false);
    this.rt.setSize(iw, ih);
    SNAP.value.set(iw * 0.75, ih * 0.75);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const seen = new Set<object>();
    const free = (o: { dispose?: () => void } | null | undefined) => {
      if (!o || seen.has(o)) return;
      seen.add(o);
      o.dispose?.();
    };
    for (const sc of [this.scene, this.postScene]) {
      sc.traverse((obj) => {
        const m = obj as THREE.Mesh;
        free(m.geometry);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mm of mats) free(mm as THREE.Material | undefined);
        if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose();
      });
    }
    this.rt.dispose();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* already gone */
    }
    this.canvas.remove();
    SNAP.value.copy(this.savedSnap);
  }
}

/** A small pool of square particles (dust, sparkles) in one draw call. */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private col: Float32Array | null;
  private next = 0;
  private live = 0;
  private readonly cap: number;
  private readonly tmp = new THREE.Color();

  constructor(cap: number, color: string, size: number, opacity: number, colored = false) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3).fill(-1e4);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.col = colored ? new Float32Array(cap * 3).fill(1) : null;
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    if (this.col) geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: colored ? '#ffffff' : color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false, vertexColors: colored }),
    );
    this.points.frustumCulled = false;
  }

  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color?: string) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    if (this.col && color) {
      this.tmp.set(color);
      this.col.set([this.tmp.r, this.tmp.g, this.tmp.b], i * 3);
    }
    this.live = Math.min(this.cap, this.live + 1);
  }

  emit(n: number, x: number, y: number, z: number, speed: number, color: string, life: number) {
    const palette = [color, '#ffffff', '#ffd84a'];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random();
      this.add(x, y, z, Math.cos(a) * speed * Math.random(), up * speed, Math.sin(a) * speed * Math.random(), life * (0.6 + Math.random() * 0.6), palette[k % 3]);
    }
  }

  step(dt: number, g: number, drag: number) {
    if (!this.live) return;
    const d = Math.exp(-drag * dt);
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) {
        this.pos[j + 1] = -1e4;
        continue;
      }
      alive++;
      this.vel[j] *= d;
      this.vel[j + 2] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - g * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.live = alive;
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    if (this.col) (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
