// Raised ways: an elevated railway's viaduct (world/railgen.ts). It runs along one line of the grid
// (its own corridor through the blocks, world/corridors.ts) on its own strip off the map (world/
// levels.ts: strip WAY0 + index), so nothing on it touches the street; drawing puts it back over its
// corridor at the height its profile gives. Sizes in metres.

export { MAX_WAYS, WAY0 } from './levels';

export interface Way {
  kind: 'rail';
  axis: 'h' | 'v';
  /** The line it runs along (index into city.xs for 'v', city.ys for 'h') and that line's
   *  position across the axis. */
  line: number;
  pos: number;
  /** Strip (world/levels.ts floor index) it lives on. */
  strip: number;
  /** Along-axis extent of its deck. */
  a0: number;
  a1: number;
  /** Height along the axis: [along, z] points, piecewise linear. */
  profile: [number, number][];
}

/** A point on a way: along its axis and across it, from ground coordinates. */
export function wayLocal(w: Way, x: number, y: number): { a: number; l: number } {
  return w.axis === 'h' ? { a: x, l: y - w.pos } : { a: y, l: x - w.pos };
}

/** Ground coordinates of (along, across) on a way. */
export function wayPoint(w: Way, a: number, l: number): { x: number; y: number } {
  return w.axis === 'h' ? { x: a, y: w.pos + l } : { x: w.pos + l, y: a };
}

/** Height of the way's deck at `a` along it (its profile). */
export function profileZ(w: Way, a: number): number {
  const p = w.profile;
  if (a <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (a <= p[i][0]) {
      const [a0, z0] = p[i - 1], [a1, z1] = p[i];
      return a1 === a0 ? z1 : z0 + ((a - a0) / (a1 - a0)) * (z1 - z0);
    }
  }
  return p[p.length - 1][1];
}
