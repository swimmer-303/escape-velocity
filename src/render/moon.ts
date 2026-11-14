// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Moon scenery for the diorama: gray regolith full of craters, low hills on the horizon, and
// the Earth hanging low in the black sky. All of it is made up in code for the look; none of it
// is real lunar map data.

import * as THREE from 'three';
import { rand } from './retro';

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

/** The base pad stays perfectly flat out to here, exactly like on Mars. */
const PAD = 11;
/** A crater's raised rim and ejecta reach this many radii from its center. */
const REACH = 1.6;

/** Where the Earth hangs: low over the horizon, in front of the opening camera view. */
export const EARTH_POS = new THREE.Vector3(-88, 4.5, -121);
/** About the Earth's real apparent size from the Moon (1.9 degrees across) at this distance. */
export const EARTH_RADIUS = 2.5;
const EARTH_AZ = Math.atan2(EARTH_POS.z, EARTH_POS.x);

function makeCraters(): Crater[] {
  const r = rand(1969);
  const out: Crater[] = [];
  const add = (count: number, rMin: number, rMax: number, dMin: number, dMax: number) => {
    for (let tries = 0; count > 0 && tries < 400; tries++) {
      const cr = rMin + r() * (rMax - rMin);
      const a = r() * Math.PI * 2;
      const d = dMin + r() * (dMax - dMin);
      if (d - cr * REACH < PAD + 0.5) continue; // never dent the base pad
      out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: cr, depth: cr * (0.22 + r() * 0.12) });
      count--;
    }
  };
  add(34, 0.8, 2.6, 12, 42); // small fresh craters around the base
  add(14, 3, 7, 22, 75);
  add(5, 9, 15, 48, 100); // a few big old ones further out
  return out;
}

const CRATERS = makeCraters();

/** Crater cross-section at d = distance / radius: a bowl, a raised rim, then nothing. */
function profile(d: number): number {
  if (d >= REACH) return 0;
  const bowl = d < 1 ? d * d - 1 : 0;
  const rim = 0.32 * Math.exp(-(((d - 1) / 0.2) ** 2)) * (1 - THREE.MathUtils.smoothstep(d, 1.3, REACH));
  return bowl + rim;
}

/** Low hills around the horizon, dipping where the Earth hangs so it is never hidden. */
function hills(x: number, z: number, r: number): number {
  const ring = THREE.MathUtils.smoothstep(r, 55, 105);
  if (ring <= 0) return 0;
  const a = Math.atan2(z, x);
  const da = Math.atan2(Math.sin(a - EARTH_AZ), Math.cos(a - EARTH_AZ));
  const dip = 1 - 0.7 * Math.exp(-((da / 0.45) ** 2));
  return ring * (2.4 + 1.3 * Math.sin(a * 3 + 1.3) + 0.7 * Math.sin(a * 7 + 0.4)) * dip;
}

/** Ground height on the Moon at a scene position. Exactly 0 on the base pad (within 11 units). */
export function moonHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= PAD) return 0;
  let h = (Math.sin(x * 0.19) * Math.cos(z * 0.23) * 0.35 + Math.sin(x * 0.47 + z * 0.29) * 0.12) * THREE.MathUtils.smoothstep(r, PAD, 16);
  for (const c of CRATERS) {
    const dx = x - c.x;
    const dz = z - c.z;
    const lim = c.r * REACH;
    const dd = dx * dx + dz * dz;
    if (dd < lim * lim) h += profile(Math.sqrt(dd) / c.r) * c.depth;
  }
  return h + hills(x, z, r);
}

/** Light/dark variation of the regolith: dark crater floors, bright fresh rims and highlands. */
export function moonTone(x: number, z: number): number {
  let t = 0;
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d < 0.85) t -= 0.12;
    else if (d < 1.25) t += 0.14;
  }
  t += THREE.MathUtils.smoothstep(Math.hypot(x, z), 55, 105) * 0.1;
  return THREE.MathUtils.clamp(t, -0.2, 0.22);
}

/** A small blue-and-white Earth: ocean, a little land, swirls of cloud, lit from one side. */
export function buildEarth(): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(EARTH_RADIUS, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const ocean = new THREE.Color('#2a63c9');
  const land = new THREE.Color('#6f8f4a');
  const cloud = new THREE.Color('#f4f6ff');
  const light = new THREE.Vector3(0.75, 0.35, 0.55).normalize();
  const n = new THREE.Vector3();
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const swirl = Math.sin(n.x * 7 + Math.sin(n.y * 5) * 2) * Math.cos(n.z * 6 - n.y * 3);
    const continent = Math.sin(n.x * 3 + 1) * Math.sin(n.z * 4 - 0.5) + n.y * 0.3;
    const c = (swirl > 0.45 || Math.abs(n.y) > 0.88 ? cloud : continent > 0.45 ? land : ocean).clone();
    c.multiplyScalar(0.3 + 0.7 * THREE.MathUtils.clamp(n.dot(light) + 0.35, 0, 1));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const earth = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  earth.name = 'earth';
  earth.position.copy(EARTH_POS);
  earth.castShadow = false;
  earth.receiveShadow = false;
  return earth;
}
