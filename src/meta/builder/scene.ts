// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: the 3D build space. A graded build pad on the real terrain of the chosen site (Gale Crater or
// Arcadia Planitia from NASA Mars Trek elevations, or the game's Moon ground), the parts, a ghost that shows where
// the next part goes (red where it won't fit), an orbit, pan and zoom camera, tap or click to place, a drop-in bounce
// with a dust puff, and the stress test acted out (dust dims the sky and lights, night falls, shelter doors glow in
// a solar storm). Same retro look as the game: low internal resolution, PS1 vertex snapping, dithered colors.
// Performance: renders only when something changes, at about 360 internal lines (pixel ratio 1, well under 1.5);
// rocks are one instanced mesh; part pieces are merged by material. dispose() frees everything.
// Loaded lazily (a dynamic import from ./view.ts), so it never runs where WebGL isn't available (or in tests).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SNAP, makePostMaterial, makeSkyMaterial, mat, rand } from '../../render/retro';
import { marsHeight } from '../../render/gale';
import { arcadiaHeight, frostAmount } from '../../render/arcadia';
import { moonHeight, moonTone, buildEarth } from '../../render/moon';
import { Particles, POINT_SCALE } from '../../render/fx';
import { isTap } from '../../render/focus';
import { CELL, PartMaterials, buildTemplate, disposeTemplate, type GlowKey, type Template } from './meshes';
import { GRID, footprint, type Layout, type Placed, type Rot, type SiteId } from './layout';
import type { PartId } from './parts';

const TARGET_LINES = 360;
const HALF = (GRID * CELL) / 2;
const PAD_TOP = 0.12;

/** What the stress test is acting out (each 0..1). */
export interface Mood {
  dust: number;
  night: number;
  storm: number;
  /** Shelter doors lit (the crew is inside). */
  shelter: number;
  cold: number;
  /** Power for the lights (1 = plenty). */
  power: number;
}
export const CALM: Mood = { dust: 0, night: 0, storm: 0, shelter: 0, cold: 0, power: 1 };

export interface SceneOptions {
  reduced: boolean;
  /** A grid square was tapped/clicked ('tap') or the pointer moved over one ('hover'). null: off the pad. */
  onCell(cell: { x: number; z: number } | null, kind: 'tap' | 'hover'): void;
}

interface PartView {
  group: THREE.Group;
  key: string;
  x: number;
  z: number;
  rot: Rot;
  drop: number;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function bounce(t: number) {
  // Ease-out bounce: fall, then two small hops.
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export class BuilderScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.5, 400);
  private controls: OrbitControls;
  private target: THREE.WebGLRenderTarget;
  private post: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private sky: THREE.ShaderMaterial;
  private sun = new THREE.DirectionalLight('#fff1d6', 1.6);
  private ambient = new THREE.HemisphereLight('#f2d2a8', '#5a3a2a', 1.0);
  private ground = new THREE.Group();
  private parts = new Map<number, PartView>();
  private templates = new Map<string, Template>();
  private M = new PartMaterials();
  private ghost = new THREE.Group();
  private ghostKey = '';
  private ghostMat = new THREE.MeshBasicMaterial({ color: '#5ef2e6', transparent: true, opacity: 0.45, depthWrite: false });
  private footMat = new THREE.MeshBasicMaterial({ color: '#5ef2e6', transparent: true, opacity: 0.35, depthWrite: false });
  private foot: THREE.Mesh;
  private select: THREE.LineSegments | null = null;
  private dust: Particles;
  private site: SiteId = 'gale';
  private padY = 0;
  private last = -1;
  private time = 0;
  private raf = 0;
  private dirty = true;
  private disposed = false;
  private mood: Mood = { ...CALM };
  private goal: Mood = { ...CALM };
  private flash = 0;
  private reduced: boolean;
  private resizeObs?: ResizeObserver;
  private down: { x: number; y: number; t: number; id: number } | null = null;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private savedSnap = SNAP.value.clone();
  private savedPoint = POINT_SCALE.value;
  private host: HTMLElement;
  private onCell: SceneOptions['onCell'];
  private fogBase = new THREE.Color();

  constructor(host: HTMLElement, opts: SceneOptions) {
    this.host = host;
    this.onCell = opts.onCell;
    this.reduced = opts.reduced;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', alpha: false });
    this.renderer.setPixelRatio(1);
    const canvas = this.renderer.domElement;
    canvas.className = 'ev-builder-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);

    this.target = new THREE.WebGLRenderTarget(320, 180, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.post = makePostMaterial(this.target);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));

    this.sky = makeSkyMaterial();
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(160, 20, 10), this.sky);
    skyMesh.frustumCulled = false;
    this.scene.add(skyMesh);
    this.scene.fog = new THREE.Fog('#d9a066', 40, 120);
    this.sun.position.set(20, 30, 10);
    this.scene.add(this.sun, this.ambient, this.ground, this.ghost);

    // Footprint marker under the ghost (and the keyboard cursor).
    this.foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.footMat);
    this.foot.rotation.x = -Math.PI / 2;
    this.foot.visible = false;
    this.foot.renderOrder = 3;
    this.scene.add(this.foot);
    this.ghost.visible = false;

    this.dust = new Particles({ capacity: 220, additive: false, gravity: 2.5, drag: 1.5 });
    this.scene.add(this.dust.points);

    this.camera.position.set(14, 13, 17);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 42;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.35;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => (this.dirty = true));

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    this.setSite('gale');
    this.resize();
    try {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(host);
    } catch {
      window.addEventListener('resize', this.resize);
    }
    this.loop();
  }

  // ---------------------------------------------------------------- site and ground
  private height(x: number, z: number): number {
    return this.site === 'moon' ? moonHeight(x, z) : this.site === 'arcadia' ? arcadiaHeight(x, z) : marsHeight(x, z);
  }

  setSite(site: SiteId) {
    if (site === this.site && this.ground.children.length) return;
    this.site = site;
    this.disposeGroup(this.ground);
    this.padY = this.height(0, 0);
    this.ground.add(this.buildGround(), this.buildPad());
    if (site === 'moon') this.ground.add(buildEarth());
    // Re-seat every part on the new pad height.
    for (const v of this.parts.values()) v.group.position.y = this.padY + PAD_TOP;
    this.applyMood(true);
    this.dirty = true;
  }

  private buildGround(): THREE.Object3D {
    const R = 70;
    const seg = 56;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const r = rand(this.site === 'moon' ? 1972 : this.site === 'arcadia' ? 4666 : 7);
    const tones =
      this.site === 'moon'
        ? ['#8d8b87', '#7d7c79', '#96948f']
        : this.site === 'arcadia'
          ? ['#94543a', '#a2623f', '#b27a55']
          : ['#8a3a1c', '#b2552a', '#c98a52'];
    const cols = tones.map((c) => new THREE.Color(c));
    const frost = new THREE.Color('#e3e8ec');
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const k = smooth(HALF + 0.6, HALF + 9, edge);
      const y = this.padY + (this.height(x, z) - this.padY) * k - 0.05;
      pos.setY(i, y);
      const c = cols[Math.floor(r() * cols.length)].clone();
      if (this.site === 'arcadia') c.lerp(frost, frostAmount(x, z) * 0.7);
      if (this.site === 'moon') {
        const t = moonTone(x, z);
        c.lerp(t >= 0 ? new THREE.Color('#c4c2bc') : new THREE.Color('#4f4f52'), Math.abs(t) * 2);
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    const ground = new THREE.Mesh(flat, mat('#ffffff', { vertexColors: true }));
    const g = new THREE.Group();
    g.add(ground);
    // Rocks around the pad: one instanced mesh, one draw call.
    const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, mat(this.site === 'moon' ? '#5d5d60' : '#6e3418'), 46);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < rocks.count; i++) {
      const a = r() * Math.PI * 2;
      const d = HALF + 3 + r() * 22;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = 0.5 + r() * 1.5;
      const k = smooth(HALF + 0.6, HALF + 9, Math.max(Math.abs(x), Math.abs(z)));
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      m4.compose(new THREE.Vector3(x, this.padY + (this.height(x, z) - this.padY) * k + 0.05, z), q, new THREE.Vector3(s, s * 0.6, s));
      rocks.setMatrixAt(i, m4);
    }
    g.add(rocks);
    return g;
  }

  private buildPad(): THREE.Object3D {
    const g = new THREE.Group();
    const size = GRID * CELL;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(size + 0.5, 0.3, size + 0.5), mat(this.site === 'moon' ? '#6d6c6a' : this.site === 'arcadia' ? '#8a5a44' : '#7a4a30'));
    slab.position.y = this.padY + PAD_TOP - 0.15;
    g.add(slab);
    const pts: number[] = [];
    const y = this.padY + PAD_TOP + 0.01;
    for (let i = 0; i <= GRID; i++) {
      const t = -HALF + i * CELL;
      pts.push(-HALF, y, t, HALF, y, t, t, y, -HALF, t, y, HALF);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#ffe0b0', transparent: true, opacity: 0.22 }));
    g.add(lines);
    // Corner posts with little lights, like a real landing zone.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), this.M.glow.beacon);
        post.position.set(sx * (HALF + 0.15), this.padY + PAD_TOP + 0.2, sz * (HALF + 0.15));
        g.add(post);
      }
    return g;
  }

  // ---------------------------------------------------------------- parts
  private template(part: PartId, style = 0): Template {
    const key = part === 'flag' ? `${part}|${style}` : part;
    let t = this.templates.get(key);
    if (!t) {
      t = buildTemplate(part, this.M, style);
      this.templates.set(key, t);
    }
    return t;
  }

  private center(p: Pick<Placed, 'part' | 'x' | 'z' | 'rot'>, out = new THREE.Vector3()): THREE.Vector3 {
    const { w, d } = footprint(p.part, p.rot);
    return out.set((p.x + w / 2) * CELL - HALF, this.padY + PAD_TOP, (p.z + d / 2) * CELL - HALF);
  }

  private makeGroup(p: Placed, material?: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    for (const m of this.template(p.part, p.style ?? 0).meshes) {
      const mesh = new THREE.Mesh(m.geo, material ?? m.m);
      g.add(mesh);
    }
    this.center(p, g.position);
    g.rotation.y = -p.rot * (Math.PI / 2);
    return g;
  }

  /** Show this layout. `dropUid`: the part just placed (it drops in with a bounce and a puff of dust). */
  sync(layout: Layout, dropUid?: number) {
    if (layout.site !== this.site) this.setSite(layout.site);
    const seen = new Set<number>();
    for (const p of layout.parts) {
      seen.add(p.uid);
      const key = `${p.part}|${p.style ?? 0}`;
      const v = this.parts.get(p.uid);
      if (v && v.key === key && v.x === p.x && v.z === p.z && v.rot === p.rot) continue;
      if (v) {
        this.scene.remove(v.group);
      }
      const group = this.makeGroup(p);
      this.scene.add(group);
      const drop = p.uid === dropUid && !this.reduced ? 0 : 1;
      this.parts.set(p.uid, { group, key, x: p.x, z: p.z, rot: p.rot, drop });
      if (p.uid === dropUid) {
        if (drop === 1) this.puff(p);
        else group.position.y += 3;
      }
    }
    for (const [uid, v] of this.parts) {
      if (seen.has(uid)) continue;
      this.scene.remove(v.group);
      this.parts.delete(uid);
      if (!this.reduced) this.puffAt(v.group.position, 1, 10);
    }
    this.dirty = true;
  }

  private puff(p: Pick<Placed, 'part' | 'x' | 'z' | 'rot'>) {
    const { w, d } = footprint(p.part, p.rot);
    this.puffAt(this.center(p), Math.max(w, d), this.reduced ? 0 : 18 + 6 * w * d);
  }

  private puffAt(c: THREE.Vector3, size: number, n: number) {
    const color = new THREE.Color(this.site === 'moon' ? '#b8b6b0' : '#d9a066');
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (size * CELL) / 2;
      const sp = 1.2 + Math.random() * 1.8;
      this.dust.emit(c.x + Math.cos(a) * r * 0.8, c.y + 0.1, c.z + Math.sin(a) * r * 0.8, Math.cos(a) * sp, 0.8 + Math.random() * 1.2, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, 0.35 + Math.random() * 0.3, color, 0.8, 0.6);
    }
  }

  // ---------------------------------------------------------------- ghost, cursor and selection
  /** The ghost of the part about to be placed (null hides it). `ok` false paints it red. */
  setGhost(g: { part: PartId; x: number; z: number; rot: Rot; style?: number; ok: boolean } | null) {
    if (!g) {
      this.ghost.visible = false;
      this.foot.visible = false;
      this.dirty = true;
      return;
    }
    const key = `${g.part}|${g.style ?? 0}`;
    if (key !== this.ghostKey) {
      this.ghost.clear();
      for (const m of this.template(g.part, g.style ?? 0).meshes) this.ghost.add(new THREE.Mesh(m.geo, this.ghostMat));
      this.ghostKey = key;
    }
    const color = g.ok ? '#5ef2e6' : '#ff5a4f';
    this.ghostMat.color.set(color);
    this.footMat.color.set(color);
    this.center(g, this.ghost.position);
    this.ghost.position.y += 0.02;
    this.ghost.rotation.y = -g.rot * (Math.PI / 2);
    this.ghost.visible = true;
    this.showFoot(g.part, g.x, g.z, g.rot);
    this.dirty = true;
  }

  /** Just the square under the cursor (nothing in hand). */
  setCursor(c: { x: number; z: number } | null) {
    this.ghost.visible = false;
    if (!c) {
      this.foot.visible = false;
    } else {
      this.footMat.color.set('#ffb627');
      this.showFoot('path', c.x, c.z, 0);
    }
    this.dirty = true;
  }

  private showFoot(part: PartId, x: number, z: number, rot: Rot) {
    const { w, d } = footprint(part, rot);
    this.foot.scale.set(w * CELL, d * CELL, 1);
    this.foot.position.set((x + w / 2) * CELL - HALF, this.padY + PAD_TOP + 0.03, (z + d / 2) * CELL - HALF);
    this.foot.visible = true;
  }

  /** Outline a placed part (null clears). */
  setSelected(p: Placed | null) {
    if (this.select) {
      this.scene.remove(this.select);
      this.select.geometry.dispose();
      (this.select.material as THREE.Material).dispose();
      this.select = null;
    }
    if (p) {
      const { w, d } = footprint(p.part, p.rot);
      const h = Math.max(0.6, this.template(p.part, p.style ?? 0).height + 0.15);
      const box = new THREE.BoxGeometry(w * CELL - 0.05, h, d * CELL - 0.05);
      const edges = new THREE.EdgesGeometry(box);
      box.dispose();
      this.select = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#ffd84a' }));
      this.center(p, this.select.position);
      this.select.position.y += h / 2;
      this.scene.add(this.select);
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- camera
  orbitBy(angle: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
    this.dirty = true;
  }

  zoomBy(f: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() * f, this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
    this.dirty = true;
  }

  resetView() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(14, 13, 17);
    this.controls.update();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- the stress test
  /** Act out a moment of the stress test (eases there). `flash`: a solar storm just hit. */
  setMood(m: Partial<Mood>, flash = false) {
    this.goal = { ...this.goal, ...m };
    if (flash) this.flash = this.reduced ? 0.12 : 0.6;
    if (this.reduced) this.mood = { ...this.goal };
    this.dirty = true;
  }

  private applyMood(force = false) {
    const k = this.mood;
    const u = this.sky.uniforms;
    const fog = this.scene.fog as THREE.Fog;
    const moon = this.site === 'moon';
    const dust = moon ? 0 : k.dust;
    if (moon) {
      (u.uZenith.value as THREE.Color).set('#000000');
      (u.uHorizon.value as THREE.Color).set('#06060a');
      (u.uSunGlow.value as THREE.Color).set('#4a4a4a');
      u.uStars.value = 1;
      u.uSunDisc.value = 1 - k.night;
      fog.color.set('#000000');
      fog.near = 200;
      fog.far = 500;
      this.sun.color.set('#ffffff');
      this.sun.intensity = (1 - k.night) * 2.4;
      this.ambient.intensity = 0.35 + (1 - k.night) * 0.4;
      this.ambient.color.set(k.night > 0.5 ? '#3a4766' : '#c9ccd6');
      this.ambient.groundColor.set('#26262a');
    } else {
      this.ambient.groundColor.set('#5a3a2a');
      const zen = new THREE.Color(this.site === 'arcadia' ? '#a88a6c' : '#b98a5d').lerp(new THREE.Color('#0b0a18'), k.night);
      const hor = new THREE.Color(this.site === 'arcadia' ? '#e2c7a6' : '#e9bd8c').lerp(new THREE.Color('#1d1836'), k.night);
      (u.uZenith.value as THREE.Color).copy(zen).lerp(new THREE.Color('#b0703a'), dust * 0.5);
      (u.uHorizon.value as THREE.Color).copy(hor).lerp(new THREE.Color('#c98a52'), dust * 0.7);
      (u.uSunGlow.value as THREE.Color).set('#f6e7c8');
      u.uStars.value = 0;
      u.uSunDisc.value = 0;
      this.fogBase.copy(u.uHorizon.value as THREE.Color);
      fog.color.copy(this.fogBase);
      fog.near = 40 - dust * 30;
      fog.far = 130 - dust * 95;
      this.sun.color.set('#fff1d6');
      this.sun.intensity = (1.7 - k.night * 1.6) * (1 - dust * 0.6);
      this.ambient.intensity = 0.3 + (1 - k.night) * 0.75 * (1 - dust * 0.3);
      this.ambient.color.set(k.night > 0.5 ? '#4a4f7a' : '#f2d2a8');
    }
    u.uNight.value = k.night;
    (u.uSunDir.value as THREE.Vector3).set(0.5, 0.75 - k.night * 1.1, -0.35).normalize();
    this.post.uniforms.uDust.value = dust * 0.5;
    this.post.uniforms.uSparkle.value = k.storm * (1 - k.shelter * 0.6);
    // Lights: brighter at night, dimmer when power is short (or the dust hides the Sun).
    const glow = this.M.glow;
    const base = this.M.glowBase;
    const set = (key: GlowKey, v: number) => (glow[key].emissiveIntensity = v);
    const lamps = (0.4 + k.night * 0.9 + dust * 0.4) * (0.25 + 0.75 * k.power);
    set('lights', base.lights * (lamps / 0.6) * 1.0);
    set('heater', base.heater + k.cold * 1.3 + k.night * 0.2);
    set('shelter', base.shelter + k.shelter * 1.6);
    set('monitor', base.monitor + k.storm * 0.8);
    set('fuel', base.fuel * (0.35 + 0.65 * k.power));
    set('greenhouse', base.greenhouse * (0.4 + 0.6 * k.power) + k.night * 0.2);
    void force;
  }

  // ---------------------------------------------------------------- input
  private cellAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.plane.constant = -(this.padY + PAD_TOP);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
    const x = Math.floor((this.hit.x + HALF) / CELL);
    const z = Math.floor((this.hit.z + HALF) / CELL);
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
    return { x, z };
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== e.pointerId) return;
    if (!isTap(e.clientX - d.x, e.clientY - d.y, performance.now() - d.t)) return;
    this.onCell(this.cellAt(e.clientX, e.clientY), 'tap');
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.buttons) return;
    this.onCell(this.cellAt(e.clientX, e.clientY), 'hover');
  };

  private onLeave = () => {
    this.onCell(null, 'hover');
  };

  // ---------------------------------------------------------------- frame
  private resize = () => {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const scale = Math.max(1, Math.round(h / TARGET_LINES));
    const iw = Math.max(64, Math.round(w / scale));
    const ih = Math.max(36, Math.round(h / scale));
    this.renderer.setSize(iw, ih, false);
    this.target.setSize(iw, ih);
    SNAP.value.set(iw * 0.75, ih * 0.75);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.1 ? 58 : 45;
    this.camera.updateProjectionMatrix();
    POINT_SCALE.value = ih / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.dirty = true;
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = this.last < 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const time = this.time;
    if (this.controls.update()) this.dirty = true;
    // Parts dropping in.
    for (const v of this.parts.values()) {
      if (v.drop >= 1) continue;
      v.drop = Math.min(1, v.drop + dt / 0.45);
      const k = bounce(v.drop);
      v.group.position.y = this.padY + PAD_TOP + (1 - k) * 3;
      const squash = v.drop > 0.35 && v.drop < 0.6 ? 1 - Math.sin(((v.drop - 0.35) / 0.25) * Math.PI) * 0.12 : 1;
      v.group.scale.set(2 - squash, squash, 2 - squash);
      if (v.drop >= 0.36 && v.drop - dt / 0.45 < 0.36) this.puffAt(v.group.position, 1.5, 22);
      if (v.drop >= 1) v.group.scale.set(1, 1, 1);
      this.dirty = true;
    }
    if (this.dust.alive > 0) {
      this.dust.update(dt);
      this.dirty = true;
    }
    // Ease the mood toward the goal.
    let moving = false;
    for (const key of Object.keys(this.goal) as Array<keyof Mood>) {
      const diff = this.goal[key] - this.mood[key];
      if (Math.abs(diff) > 0.002) {
        this.mood[key] += diff * Math.min(1, dt * 3);
        moving = true;
      } else this.mood[key] = this.goal[key];
    }
    if (moving) this.applyMood();
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 1.6);
      this.dirty = true;
    }
    if (this.mood.storm > 0.01 || moving) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.post.uniforms.uFlash.value = this.flash;
    this.post.uniforms.uTime.value = time;
    this.sky.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  };

  private disposeGroup(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mm && !Object.values(this.M.glow).includes(mm as THREE.MeshPhongMaterial)) {
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm.dispose();
      }
    });
    g.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    window.removeEventListener('resize', this.resize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerleave', this.onLeave);
    this.controls.dispose();
    this.setSelected(null);
    this.disposeGroup(this.ground);
    for (const v of this.parts.values()) this.scene.remove(v.group);
    this.parts.clear();
    this.ghost.clear();
    for (const t of this.templates.values()) disposeTemplate(t);
    this.templates.clear();
    this.M.dispose();
    this.ghostMat.dispose();
    this.footMat.dispose();
    this.foot.geometry.dispose();
    this.dust.points.geometry.dispose();
    (this.dust.points.material as THREE.Material).dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.sky.dispose();
    this.post.dispose();
    this.postScene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.target.dispose();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* already gone */
    }
    canvas.remove();
    // Give the game's own stage its retro grid and particle scale back.
    SNAP.value.copy(this.savedSnap);
    POINT_SCALE.value = this.savedPoint;
  }
}
