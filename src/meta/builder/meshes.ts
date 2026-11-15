// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: low-poly models for every part, built from code in the same style and palette as the game's
// outpost (src/render/diorama.ts) and with the same PS1 vertex-snapping materials (src/render/retro.ts).
// Each part type is built once as a template whose pieces are merged by material (a few draw calls per part);
// every placed part shares the template's geometry and materials. Glowing bits share one material per kind, so the
// stress test can dim every light in a dust storm or make every shelter door glow in a solar storm at once.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from '../../render/retro';
import { PARTS, FLAG_DESIGNS, type PartId } from './parts';

/** World units per grid square. */
export const CELL = 1.2;

const C = {
  rust: '#8a3a1c',
  soil: '#6e3418',
  dust: '#c98a52',
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
  oxide: '#b2552a',
  leaf: '#3f8f3a',
  violet: '#c58bff',
  gold: '#ffd84a',
  path: '#a89070',
};

export type GlowKey = 'lights' | 'heater' | 'shelter' | 'fuel' | 'monitor' | 'greenhouse' | 'reactor' | 'beacon';

/** Every material the parts use, made once and disposed together. */
export class PartMaterials {
  private plain = new Map<string, THREE.Material>();
  readonly glow: Record<GlowKey, THREE.MeshPhongMaterial>;
  readonly glowBase: Record<GlowKey, number>;
  readonly glass: THREE.MeshPhongMaterial;
  readonly panel: THREE.MeshPhongMaterial;
  private flags = new Map<number, THREE.MeshBasicMaterial>();

  constructor() {
    const g = (base: string, emissive: string, k: number) => mat(base, { emissive: new THREE.Color(emissive), emissiveIntensity: k });
    this.glow = {
      lights: g('#3a2a1a', C.amber, 0.6),
      heater: g('#3b2b23', C.orange, 0.15),
      shelter: g('#2a1a10', C.amber, 0.1),
      fuel: g('#0f3f3c', C.cyan, 0.8),
      monitor: g('#301030', C.violet, 0.5),
      greenhouse: g('#2f5f2a', '#2f8f3a', 0.3),
      reactor: g('#0f3030', C.cyan, 1),
      beacon: g('#401010', '#ff3b2f', 0.6),
    };
    this.glowBase = Object.fromEntries(Object.entries(this.glow).map(([k, m]) => [k, m.emissiveIntensity])) as Record<GlowKey, number>;
    this.glass = mat(C.glass, { transparent: true, opacity: 0.55, emissive: new THREE.Color('#2f8f3a'), emissiveIntensity: 0.2, depthWrite: false });
    this.panel = mat(C.panel, { emissive: new THREE.Color('#0d1a40'), emissiveIntensity: 0.4, shininess: 40, specular: new THREE.Color('#6a7fb8') });
  }

  color(c: string, opts: THREE.MeshPhongMaterialParameters = {}): THREE.Material {
    const key = `${c}|${opts.side ?? ''}`;
    let m = this.plain.get(key);
    if (!m) {
      m = mat(c, opts);
      this.plain.set(key, m);
    }
    return m;
  }

  /** A pixel-art flag (a tiny canvas texture) for a design. */
  flag(style: number): THREE.MeshBasicMaterial {
    const s = ((style % FLAG_DESIGNS.length) + FLAG_DESIGNS.length) % FLAG_DESIGNS.length;
    let m = this.flags.get(s);
    if (m) return m;
    const d = FLAG_DESIGNS[s];
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 10;
    let tex: THREE.Texture | null = null;
    try {
      const g = canvas.getContext('2d');
      if (g) {
        drawFlag(g, d.shape, d.field, d.mark);
        tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
      }
    } catch {
      tex = null;
    }
    m = new THREE.MeshBasicMaterial({ color: tex ? '#ffffff' : d.field, map: tex, side: THREE.DoubleSide });
    this.flags.set(s, m);
    return m;
  }

  dispose() {
    for (const m of this.plain.values()) m.dispose();
    for (const m of Object.values(this.glow)) m.dispose();
    for (const m of this.flags.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.glass.dispose();
    this.panel.dispose();
    this.plain.clear();
    this.flags.clear();
  }
}

/** Draw a flag design, 16 x 10 pixels: shapes only (no real flags). Exported for the palette's preview too. */
export function drawFlag(g: CanvasRenderingContext2D, shape: (typeof FLAG_DESIGNS)[number]['shape'], field: string, mark: string) {
  g.fillStyle = field;
  g.fillRect(0, 0, 16, 10);
  g.fillStyle = mark;
  const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(x, y, w, h);
  switch (shape) {
    case 'star':
      px(7, 2, 2, 6);
      px(5, 4, 6, 2);
      px(6, 3, 4, 4);
      break;
    case 'rocket':
      px(7, 1, 2, 1);
      px(6, 2, 4, 5);
      px(5, 6, 1, 2);
      px(10, 6, 1, 2);
      px(7, 7, 2, 2);
      break;
    case 'planet':
      px(6, 3, 4, 4);
      px(7, 2, 2, 6);
      px(3, 5, 10, 1);
      px(2, 6, 2, 1);
      px(12, 4, 2, 1);
      break;
    case 'stripes':
      for (let y = 0; y < 10; y += 4) px(0, y, 16, 2);
      break;
    case 'moon':
      px(6, 2, 4, 6);
      px(5, 3, 1, 4);
      g.fillStyle = field;
      g.fillRect(8, 3, 3, 4);
      break;
    case 'bolt':
      px(8, 1, 2, 3);
      px(6, 4, 4, 2);
      px(6, 6, 2, 3);
      break;
  }
}

// ------------------------------------------------------------------ building pieces
type Piece = { geo: THREE.BufferGeometry; m: THREE.Material; at: THREE.Matrix4 };

class Kit {
  pieces: Piece[] = [];
  constructor(readonly M: PartMaterials) {}
  add(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const at = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this.pieces.push({ geo, m, at });
  }
  box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, ry);
  }
  cyl(rt: number, rb: number, h: number, seg: number, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z, rx, 0, rz);
  }
}

/** A built template: one mesh per material, and how tall the part is. */
export interface Template {
  meshes: Array<{ geo: THREE.BufferGeometry; m: THREE.Material }>;
  height: number;
}

function bake(kit: Kit): Template {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let top = 0;
  for (const p of kit.pieces) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    p.geo.dispose();
    g.applyMatrix4(p.at);
    // Same attributes everywhere, so pieces can merge.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count ?? 0) * 2), 2));
    g.computeBoundingBox();
    top = Math.max(top, g.boundingBox?.max.y ?? 0);
    const list = byMat.get(p.m) ?? [];
    list.push(g);
    byMat.set(p.m, list);
  }
  const meshes: Template['meshes'] = [];
  for (const [m, list] of byMat) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const g of list) g.dispose();
    if (merged) meshes.push({ geo: merged, m });
  }
  return { meshes, height: top };
}

/** Build a part's template, centered on its footprint, facing +z at rotation 0. */
export function buildTemplate(part: PartId, M: PartMaterials, style = 0): Template {
  const k = new Kit(M);
  const p = PARTS[part];
  const W = p.w * CELL;
  const D = p.d * CELL;
  const c = (x: string) => M.color(x);
  switch (part) {
    case 'solar': {
      // A tilted panel on two legs, the long side along z.
      k.add(new THREE.BoxGeometry(W * 0.86, 0.06, D * 0.9), M.panel, 0, 0.62, 0, 0, 0, -0.45);
      k.box(0.08, 0.6, 0.08, c(C.metal), 0, 0.3, -D * 0.3);
      k.box(0.08, 0.6, 0.08, c(C.metal), 0, 0.3, D * 0.3);
      k.box(W * 0.5, 0.06, 0.08, c(C.metal), 0, 0.05, 0);
      break;
    }
    case 'battery': {
      k.box(0.8, 0.7, 0.7, c(C.habShade), 0, 0.35, 0);
      k.box(0.82, 0.08, 0.72, c(C.dark), 0, 0.72, 0);
      k.box(0.3, 0.1, 0.04, M.glow.lights, -0.18, 0.5, 0.36);
      k.box(0.12, 0.1, 0.04, M.glow.fuel, 0.22, 0.5, 0.36);
      break;
    }
    case 'reactor': {
      k.cyl(0.62, 0.75, 1.5, 8, c(C.habShade), 0, 0.75, 0);
      k.cyl(0.35, 0.62, 0.4, 8, c(C.metal), 0, 1.7, 0);
      k.box(0.36, 0.14, 0.04, M.glow.reactor, 0, 0.95, 0.72);
      for (const s of [-1, 1]) k.box(0.05, 1.1, 1.6, c('#d8d4cc'), s * 1.05, 0.95, 0);
      break;
    }
    case 'habitat': {
      k.add(new THREE.IcosahedronGeometry(1.05, 1), c(C.hab), 0, 0.12, 0, 0, 0, 0, 1, 0.85, 1);
      k.cyl(1.08, 1.12, 0.3, 12, c(C.habShade), 0, 0.15, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        k.add(new THREE.BoxGeometry(0.26, 0.18, 0.06), M.glow.lights, Math.cos(a) * 1.0, 0.5, Math.sin(a) * 1.0, 0, -a + Math.PI / 2);
      }
      k.box(0.5, 0.6, 0.5, c(C.habShade), 0, 0.3, 1.1);
      for (const sx of [-1, 1]) k.box(0.26, 0.2, 0.26, M.glow.heater, sx * 0.75, 0.12, -0.85);
      k.cyl(0.03, 0.04, 0.5, 5, c(C.metal), -0.4, 1.05, -0.4);
      k.box(0.08, 0.08, 0.08, M.glow.fuel, -0.4, 1.32, -0.4);
      break;
    }
    case 'o2': {
      k.box(1.5, 0.8, 0.85, c(C.metal), -0.3, 0.4, 0);
      k.box(1.56, 0.1, 0.9, c(C.dark), -0.3, 0.85, 0);
      for (const dz of [-0.24, 0.24]) k.cyl(0.22, 0.22, 0.9, 8, c(C.white), 0.82, 0.45, dz);
      k.box(0.18, 0.18, 0.04, M.glow.lights, -0.6, 0.5, 0.44);
      k.box(0.18, 0.18, 0.04, M.glow.fuel, -0.2, 0.5, 0.44);
      for (let i = 0; i < 3; i++) k.add(new THREE.BoxGeometry(0.42, 0.04, 0.09), c(C.dark), -0.55, 0.94, 0, 0, (i / 3) * Math.PI);
      break;
    }
    case 'bigo2': {
      k.box(1.5, 1.2, 1.4, c(C.metal), -0.35, 0.6, 0);
      k.box(1.56, 0.12, 1.46, c(C.dark), -0.35, 1.26, 0);
      for (let i = 0; i < 3; i++) k.cyl(0.24, 0.24, 1.4, 8, c(C.white), 0.75, 0.7, -0.6 + i * 0.6);
      k.box(0.3, 0.2, 0.04, M.glow.lights, -0.6, 0.75, 0.72);
      k.box(0.3, 0.2, 0.04, M.glow.fuel, -0.1, 0.75, 0.72);
      for (let i = 0; i < 3; i++) k.add(new THREE.BoxGeometry(0.6, 0.05, 0.12), c(C.dark), -0.35, 1.36, 0, 0, (i / 3) * Math.PI);
      break;
    }
    case 'greenhouse': {
      k.add(new THREE.SphereGeometry(1.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, 0, 0.15, 0);
      k.cyl(1.1, 1.15, 0.22, 10, c(C.habShade), 0, 0.11, 0);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        const d = i === 0 ? 0 : 0.35 + (i % 3) * 0.15;
        k.add(new THREE.ConeGeometry(0.14, 0.36, 4), M.glow.greenhouse, Math.cos(a) * d, 0.4, Math.sin(a) * d);
      }
      break;
    }
    case 'heater': {
      k.box(0.6, 0.45, 0.6, c(C.dark), 0, 0.23, 0);
      k.box(0.5, 0.12, 0.04, M.glow.heater, 0, 0.3, 0.31);
      k.box(0.5, 0.12, 0.04, M.glow.heater, 0, 0.3, -0.31);
      k.cyl(0.06, 0.06, 0.5, 6, c(C.metal), 0.18, 0.7, 0.1);
      break;
    }
    case 'shelter': {
      k.add(new THREE.CylinderGeometry(0.6, 0.6, W * 0.9, 8, 1, false, 0, Math.PI), c(C.soil), 0, 0, 0, 0, Math.PI / 2, Math.PI / 2);
      k.box(0.5, 0.55, 0.16, c(C.metal), 0, 0.28, 0.56);
      k.box(0.36, 0.42, 0.05, M.glow.shelter, 0, 0.25, 0.65);
      break;
    }
    case 'berm': {
      k.add(new THREE.CylinderGeometry(0.55, 0.62, W * 0.95, 9, 1, false, 0, Math.PI), c('#7d3d1c'), 0, 0, -0.05, 0, Math.PI / 2, Math.PI / 2);
      for (let i = 0; i < 4; i++) k.box(0.48, 0.2, 0.26, c(C.dust), -0.84 + i * 0.56, 0.1, 0.45);
      break;
    }
    case 'monitor': {
      k.cyl(0.05, 0.07, 1.5, 5, c(C.metal), 0, 0.75, 0);
      k.add(new THREE.SphereGeometry(0.34, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2.6), M.color(C.white, { side: THREE.DoubleSide }), 0, 1.5, 0, 2.6, 0, 0.3);
      k.box(0.14, 0.14, 0.14, M.glow.monitor, 0, 1.62, 0);
      k.box(0.46, 0.26, 0.36, c(C.habShade), 0, 0.13, 0);
      break;
    }
    case 'rocket': {
      k.cyl(1.0, 1.1, 0.22, 10, c(C.dark), 0, 0.11, 0);
      k.box(0.18, 3.6, 0.18, c(C.metal), -0.9, 1.8, 0);
      k.box(0.55, 0.08, 0.08, c(C.metal), -0.62, 2.7, 0);
      k.cyl(0.34, 0.37, 1.5, 10, c(C.white), 0, 1.25, 0);
      k.cyl(0.32, 0.34, 1.3, 10, c(C.white), 0, 2.65, 0);
      k.add(new THREE.ConeGeometry(0.32, 0.85, 10), c(C.white), 0, 3.72, 0);
      k.cyl(0.36, 0.36, 0.08, 10, c(C.dark), 0, 2.0, 0);
      k.cyl(0.18, 0.28, 0.24, 8, c(C.dark), 0, 0.36, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        k.add(new THREE.BoxGeometry(0.06, 0.55, 0.42), c(C.oxide), Math.cos(a) * 0.38, 0.75, Math.sin(a) * 0.38, 0, -a);
      }
      k.box(0.13, 2.2, 0.04, M.glow.fuel, 0, 1.8, 0.37);
      break;
    }
    case 'workshop': {
      k.add(new THREE.CylinderGeometry(0.62, 0.62, W * 0.9, 8, 1, false, 0, Math.PI), c(C.habShade), 0, 0, 0, 0, Math.PI / 2, Math.PI / 2);
      k.box(0.5, 0.5, 0.06, c(C.dark), 0.4, 0.26, 0.6);
      k.box(0.16, 0.12, 0.04, M.glow.lights, -0.5, 0.36, 0.6);
      break;
    }
    case 'garage': {
      k.box(2.0, 0.8, 1.9, c(C.habShade), 0, 0.4, -0.1);
      k.add(new THREE.CylinderGeometry(1.0, 1.0, 1.9, 10, 1, false, 0, Math.PI), c(C.hab), 0, 0.8, -0.1, Math.PI / 2, 0, Math.PI / 2, 1, 1, 0.45);
      k.box(1.3, 0.75, 0.05, c(C.dark), 0, 0.38, 0.86);
      k.box(0.2, 0.1, 0.04, M.glow.lights, 0.82, 0.95, 0.86);
      // The rover, parked out front.
      k.box(0.6, 0.22, 0.4, c(C.amber), 0.55, 0.26, 1.0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.09, 0.09, 0.08, 6, c(C.dark), 0.55 + sx * 0.24, 0.1, 1.0 + sz * 0.22, Math.PI / 2);
      break;
    }
    case 'path': {
      k.box(CELL * 0.96, 0.06, CELL * 0.96, c(C.path), 0, 0.03, 0);
      k.box(0.3, 0.02, 0.3, c('#8f7a5e'), -0.2, 0.07, 0.15);
      break;
    }
    case 'lamp': {
      k.cyl(0.04, 0.06, 1.1, 5, c(C.metal), 0, 0.55, 0);
      k.box(0.22, 0.16, 0.22, M.glow.lights, 0, 1.14, 0);
      k.box(0.3, 0.05, 0.3, c(C.dark), 0, 1.25, 0);
      break;
    }
    case 'antenna': {
      k.cyl(0.04, 0.06, 2.4, 5, c(C.metal), 0, 1.2, 0);
      for (const y of [0.9, 1.5, 2.0]) k.box(0.5 - y * 0.12, 0.04, 0.04, c(C.metal), 0, y, 0);
      k.box(0.1, 0.1, 0.1, M.glow.beacon, 0, 2.45, 0);
      break;
    }
    case 'flag': {
      k.cyl(0.03, 0.03, 1.5, 5, c(C.metal), 0, 0.75, 0);
      k.add(new THREE.PlaneGeometry(0.72, 0.45), M.flag(style), 0.38, 1.24, 0);
      break;
    }
    case 'statue': {
      k.box(0.6, 0.3, 0.6, c(C.habShade), 0, 0.15, 0);
      k.box(0.3, 0.38, 0.2, c(C.gold), 0, 0.62, 0);
      k.add(new THREE.SphereGeometry(0.15, 6, 4), c(C.gold), 0, 0.92, 0);
      for (const s of [-1, 1]) k.box(0.1, 0.32, 0.1, c(C.gold), s * 0.08, 0.3 + 0.15, 0);
      k.box(0.08, 0.3, 0.08, c(C.gold), 0.2, 0.86, 0);
      break;
    }
    case 'planter': {
      k.box(0.7, 0.3, 0.7, c(C.dark), 0, 0.15, 0);
      k.box(0.62, 0.04, 0.62, c(C.soil), 0, 0.31, 0);
      for (let i = 0; i < 4; i++) k.add(new THREE.ConeGeometry(0.1, 0.32, 4), c(C.leaf), (i % 2 ? 1 : -1) * 0.16, 0.48, (i < 2 ? 1 : -1) * 0.16);
      break;
    }
  }
  return bake(k);
}

/** Dispose a template's geometry (materials belong to PartMaterials). */
export function disposeTemplate(t: Template) {
  for (const m of t.meshes) m.geo.dispose();
}
