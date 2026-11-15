// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The drivable ground as a grid of heights. The 3D mesh is built from exactly these heights and triangles, and the
// rover's physics reads them back the same way, so the wheels always sit on what you see. Pure: no three.js.

import type { Ground } from './physics';

export class Heightfield implements Ground {
  /** Grid cells along one side. */
  readonly n: number;
  /** Half the grid's width, m (the grid spans -half..half on x and z). */
  readonly half: number;
  readonly cell: number;
  /** (n + 1)^2 heights, row by row along z: index = iz * (n + 1) + ix. */
  readonly h: Float32Array;

  constructor(fn: (x: number, z: number) => number, half: number, n: number) {
    this.n = n;
    this.half = half;
    this.cell = (2 * half) / n;
    this.h = new Float32Array((n + 1) * (n + 1));
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const v = fn(this.coord(ix), this.coord(iz));
        this.h[iz * (n + 1) + ix] = Number.isFinite(v) ? v : 0;
      }
    }
  }

  /** The x (or z) position of grid line i. */
  coord(i: number): number {
    return -this.half + i * this.cell;
  }

  at(ix: number, iz: number): number {
    return this.h[iz * (this.n + 1) + ix];
  }

  /**
   * Height at any spot, on the same two triangles per cell as the mesh (see triangleIndex): corner a = (ix, iz),
   * b = (ix + 1, iz), c = (ix, iz + 1), d = (ix + 1, iz + 1), split along the b-c diagonal.
   */
  height(x: number, z: number): number {
    const n = this.n;
    const gx = Math.min(n - 1e-6, Math.max(0, (x + this.half) / this.cell));
    const gz = Math.min(n - 1e-6, Math.max(0, (z + this.half) / this.cell));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const a = this.at(ix, iz);
    const b = this.at(ix + 1, iz);
    const c = this.at(ix, iz + 1);
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    const d = this.at(ix + 1, iz + 1);
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Unit normal of the ground (averaged over about a rover's length). */
  normal(x: number, z: number, span = 1.6): { x: number; y: number; z: number } {
    const gx = (this.height(x + span, z) - this.height(x - span, z)) / (2 * span);
    const gz = (this.height(x, z + span) - this.height(x, z - span)) / (2 * span);
    const len = Math.hypot(gx, 1, gz);
    return { x: -gx / len, y: 1 / len, z: -gz / len };
  }

  /** Triangle indices for the mesh: (a, c, b) and (b, c, d) per cell, facing up. */
  triangleIndex(): Uint32Array {
    const n = this.n;
    const out = new Uint32Array(n * n * 6);
    let k = 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const a = iz * (n + 1) + ix;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        out[k++] = a;
        out[k++] = c;
        out[k++] = b;
        out[k++] = b;
        out[k++] = c;
        out[k++] = d;
      }
    }
    return out;
  }
}
