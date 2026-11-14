// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The retro look: PS1-style vertex snapping (polygons wobble on a coarse grid), and a
// post-process pass with ordered (Bayer) dithering, posterized color, vignette, dust tint,
// solar-storm flash, and "particle snow" like the speckles radiation leaves on rover cameras.

import * as THREE from 'three';

/** Seeded random numbers (0..1), so the scenery comes out the same every time. */
export function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared uniform: the snap grid, in half-pixels of the internal resolution. */
export const SNAP = { value: new THREE.Vector2(160, 90) };

/** Make a built-in material snap its vertices to a low-res grid (the classic PS1 wobble). */
export function ps1<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = SNAP;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSnap;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 p = gl_Position;
          p.xy = floor(p.xy / p.w * uSnap + 0.5) / uSnap * p.w;
          gl_Position = p;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'ps1';
  return material;
}

/** Flat-shaded, slightly snapped material in one call. */
export function mat(color: THREE.ColorRepresentation, opts: THREE.MeshPhongMaterialParameters = {}): THREE.MeshPhongMaterial {
  return ps1(new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 4, ...opts }));
}

export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uLevels;
uniform float uTime;
uniform float uSparkle;
uniform float uFlash;
uniform float uDust;
uniform vec3 uDustColor;
uniform float uVignette;
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  // Dust storms wash the scene toward butterscotch.
  c = mix(c, uDustColor * (0.55 + 0.45 * dot(c, vec3(0.33))), uDust);
  // Storm flash.
  c += uFlash * vec3(0.9, 0.85, 1.0);
  // Vignette.
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.6;
  // Ordered dither + posterize (in roughly perceptual space).
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float t = bayer4(gl_FragCoord.xy) - 0.5;
  c = floor(c * uLevels + t + 0.5) / uLevels;
  c = pow(clamp(c, 0.0, 1.0), vec3(2.2));
  // Radiation "snow": bright single pixels, like hits on a rover camera sensor.
  float h = hash(floor(gl_FragCoord.xy) + floor(uTime * 24.0) * 17.0);
  if (h > 1.0 - uSparkle * 0.012) c = vec3(1.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function makePostMaterial(target: THREE.WebGLRenderTarget) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: target.texture },
      uLevels: { value: 12 },
      uTime: { value: 0 },
      uSparkle: { value: 0 },
      uFlash: { value: 0 },
      uDust: { value: 0 },
      uDustColor: { value: new THREE.Color('#d99a5b') },
      uVignette: { value: 0.55 },
    },
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Sky dome: horizon and zenith colors, a sun glow, and Mars' blue glow around the setting Sun.
 * For an airless sky (the Moon), uStars = 1 shows steady stars all day and uSunDisc = 1 draws a hard
 * white Sun. Both default to 0, which leaves the Mars sky exactly as it was.
 */
export function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#b9875a') },
      uHorizon: { value: new THREE.Color('#e7b98a') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunGlow: { value: new THREE.Color('#f6e7c8') },
      uBlue: { value: 0 },
      uNight: { value: 0 },
      uStars: { value: 0 },
      uSunDisc: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunGlow;
      uniform float uBlue; uniform float uNight; uniform float uTime;
      uniform float uStars; uniform float uSunDisc;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.6));
        float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        c += uSunGlow * pow(s, 24.0) * (1.0 - uNight);
        // Mars sunsets are blue: fine dust scatters blue light forward, around the Sun.
        c = mix(c, vec3(0.36, 0.52, 0.80), uBlue * pow(s, 4.0));
        // No air (the Moon): the Sun is a sharp white disc (drawn bigger than real, so it shows up).
        c = mix(c, vec3(1.0), uSunDisc * smoothstep(0.99990, 0.99993, s));
        // Stars at night; with no air they shine all day, all the way down, and do not twinkle.
        vec3 cell = floor(vDir * 180.0);
        float fade = mix(smoothstep(0.0, 0.2, h), step(-0.05, vDir.y), uStars);
        float star = step(0.9975, hash(cell)) * fade;
        float twinkle = mix(0.7 + 0.3 * sin(uTime * 3.0 + hash(cell) * 40.0), 1.0, uStars);
        c += vec3(star) * max(uNight, uStars) * twinkle;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
