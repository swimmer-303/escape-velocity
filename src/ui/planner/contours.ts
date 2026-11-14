// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Contour lines for the porkchop plot, by marching squares on the grid of trips.
// Output is in grid coordinates: x = departure index (fractional), y = trip-length index (fractional).

/** One straight piece of a contour line: [x1, y1, x2, y2]. */
export type Segment = [number, number, number, number];

/**
 * All segments of the line where `values` crosses `level`. `values` is row-major with `nx` columns (index j * nx + i).
 * NaN counts as "very high" (a trip with no solution is never cheap). Saddle squares are split using the
 * square's center value, so lines never cross.
 */
export function contourSegments(values: ArrayLike<number>, nx: number, ny: number, level: number): Segment[] {
  const at = (i: number, j: number) => {
    const v = values[j * nx + i];
    return Number.isNaN(v) ? Infinity : v;
  };
  const out: Segment[] = [];
  // Where the line crosses each edge of the square, by linear interpolation.
  const cross = (va: number, vb: number) => {
    if (!Number.isFinite(va)) return 1;
    if (!Number.isFinite(vb)) return 0;
    return (level - va) / (vb - va);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = at(i, j); // (i, j)
      const v1 = at(i + 1, j); // (i+1, j)
      const v2 = at(i + 1, j + 1); // (i+1, j+1)
      const v3 = at(i, j + 1); // (i, j+1)
      const b0 = v0 > level;
      const b1 = v1 > level;
      const b2 = v2 > level;
      const b3 = v3 > level;
      if (b0 === b1 && b1 === b2 && b2 === b3) continue;
      // Edge crossing points: e0 bottom (v0-v1), e1 right (v1-v2), e2 top (v3-v2), e3 left (v0-v3).
      const e: Array<[number, number] | null> = [
        b0 !== b1 ? [i + cross(v0, v1), j] : null,
        b1 !== b2 ? [i + 1, j + cross(v1, v2)] : null,
        b3 !== b2 ? [i + cross(v3, v2), j + 1] : null,
        b0 !== b3 ? [i, j + cross(v0, v3)] : null,
      ];
      const hits = e.filter((p): p is [number, number] => p !== null);
      if (hits.length === 2) {
        out.push([hits[0][0], hits[0][1], hits[1][0], hits[1][1]]);
        continue;
      }
      // Saddle: cut off each corner that disagrees with the center.
      const vals = [v0, v1, v2, v3];
      const finite = vals.filter(Number.isFinite);
      const center = finite.length === 4 ? (v0 + v1 + v2 + v3) / 4 > level : true;
      const corners = [b0, b1, b2, b3];
      const edgesOf = [
        [3, 0],
        [0, 1],
        [1, 2],
        [2, 3],
      ];
      for (let k = 0; k < 4; k++) {
        if (corners[k] === center) continue;
        const [ea, eb] = edgesOf[k];
        const pa = e[ea];
        const pb = e[eb];
        if (pa && pb) out.push([pa[0], pa[1], pb[0], pb[1]]);
      }
    }
  }
  return out;
}
