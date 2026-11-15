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

/**
 * The outpost's Earth: the same blue-and-white ball, but lit by the Sun's real direction in the scene, so it shows
 * phases (a thin crescent when the Sun is beside it, full when the Sun is behind you), with a thin bright rim of air.
 * From one spot on the Moon's near side the Earth stays in about the same part of the sky all the time (the Moon
 * always keeps the same face toward it), only wobbling a little; near the south pole that spot is low on the horizon.
 * Call setSun(direction toward the Sun) whenever the Sun moves.
 */
export function buildLitEarth(): { mesh: THREE.Mesh; setSun: (dir: THREE.Vector3) => void } {
  const geo = new THREE.IcosahedronGeometry(EARTH_RADIUS, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const ocean = new THREE.Color('#2a63c9');
  const land = new THREE.Color('#6f8f4a');
  const cloud = new THREE.Color('#f4f6ff');
  const n = new THREE.Vector3();
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const swirl = Math.sin(n.x * 7 + Math.sin(n.y * 5) * 2) * Math.cos(n.z * 6 - n.y * 3);
    const continent = Math.sin(n.x * 3 + 1) * Math.sin(n.z * 4 - 0.5) + n.y * 0.3;
    const c = swirl > 0.45 || Math.abs(n.y) > 0.88 ? cloud : continent > 0.45 ? land : ocean;
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sun = new THREE.Vector3(0.75, 0.35, 0.55).normalize();
  const material = new THREE.ShaderMaterial({
    vertexColors: true,
    fog: false,
    uniforms: { uSun: { value: sun } },
    vertexShader: /* glsl */ `
      varying vec3 vColor; varying vec3 vN; varying vec3 vView;
      void main() {
        vColor = color;
        vN = normalize(position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vColor; varying vec3 vN; varying vec3 vView;
      void main() {
        vec3 n = normalize(vN);
        float lit = smoothstep(-0.08, 0.3, dot(n, uSun));
        vec3 c = vColor * (0.05 + 1.05 * lit);
        // A thin glowing rim of atmosphere on the sunlit side.
        float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
        c += vec3(0.35, 0.55, 1.0) * rim * (0.15 + 0.85 * lit);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const earth = new THREE.Mesh(geo, material);
  earth.name = 'earth';
  earth.position.copy(EARTH_POS);
  earth.castShadow = false;
  earth.receiveShadow = false;
  earth.renderOrder = -1;
  return { mesh: earth, setSun: (dir) => sun.copy(dir).normalize() };
}

/** How high the Sun climbs in the outpost's sky on the Moon, in degrees (see moonSunDirection). */
export const MOON_SUN_MAX_DEG = 9;

/**
 * Where the Sun is in the Moon outpost's sky at time of day `t` (0 = sunrise, 0.5 = sunset), written into `out`.
 * Near the lunar south pole the Sun never climbs high: it creeps sideways around the horizon, so light comes in at a
 * low angle and shadows are very long. (At the pole itself it stays within about 1.5 degrees of the horizon; it is
 * lifted to MOON_SUN_MAX_DEG here so the base stays readable.) By day it swings across the side of the sky beside the
 * Earth; at night it is below the horizon.
 */
export function moonSunDirection(t: number, out: THREE.Vector3): THREE.Vector3 {
  const day = t < 0.5;
  const u = day ? t / 0.5 : (t - 0.5) / 0.5;
  const az = day ? EARTH_AZ + Math.PI / 2 + (u - 0.5) * 2.2 : EARTH_AZ + Math.PI / 2 + 1.1 + u * (2 * Math.PI - 2.2);
  const elev = THREE.MathUtils.degToRad(day ? 1 + Math.sin(u * Math.PI) * (MOON_SUN_MAX_DEG - 1) : -4 - Math.sin(u * Math.PI) * 10);
  return out.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
}

/** Direction from the outpost toward the Earth. */
export const EARTH_DIR = EARTH_POS.clone().normalize();

/** The made-up craters (centers, radii and depths in diorama units), for things that sit inside them (Rover Expeditions). */
export function moonCraters(): Array<{ x: number; z: number; r: number; depth: number }> {
  return CRATERS.map((c) => ({ ...c }));
}
