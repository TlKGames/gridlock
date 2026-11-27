// Contact and ray tests between the static world's shapes (axis-aligned boxes, circles) and an
// oriented box or a segment. Pure geometry; collision.ts re-exports them.

export interface Box2 { x0: number; y0: number; x1: number; y1: number; h: number; gate?: number }
export interface Hit { nx: number; ny: number; depth: number }
export interface RayHit { t: number; nx: number; ny: number }

/** SAT between an OBB and an AABB; returns the minimum translation for the OBB. */
export function obbVsAabb(x: number, y: number, c: number, s: number, hl: number, hw: number, b: Box2): Hit | null {
  const bx = (b.x0 + b.x1) / 2, by = (b.y0 + b.y1) / 2, bhx = (b.x1 - b.x0) / 2, bhy = (b.y1 - b.y0) / 2;
  const dx = x - bx, dy = y - by;
  const axes: [number, number][] = [[1, 0], [0, 1], [c, s], [-s, c]];
  let best = Infinity, nx = 0, ny = 0;
  for (const [ax, ay] of axes) {
    const ra = hl * Math.abs(c * ax + s * ay) + hw * Math.abs(-s * ax + c * ay);
    const rb = bhx * Math.abs(ax) + bhy * Math.abs(ay);
    const d = dx * ax + dy * ay;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d < 0 ? -1 : 1; nx = ax * sg; ny = ay * sg; }
  }
  return { nx, ny, depth: best };
}

export function obbVsCircle(x: number, y: number, c: number, s: number, hl: number, hw: number, ci: { x: number; y: number; r: number }): Hit | null {
  const dx = ci.x - x, dy = ci.y - y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const px = Math.max(-hl, Math.min(hl, lx)), py = Math.max(-hw, Math.min(hw, ly));
  const ex = lx - px, ey = ly - py;
  const d2 = ex * ex + ey * ey;
  if (d2 >= ci.r * ci.r) return null;
  if (d2 < 1e-9) {
    // Circle centre inside the box: push along the nearest local face.
    const ox = hl - Math.abs(lx), oy = hw - Math.abs(ly);
    const [lnx, lny, depth] = ox < oy ? [-Math.sign(lx) || -1, 0, ox + ci.r] : [0, -Math.sign(ly) || -1, oy + ci.r];
    return { nx: lnx * c - lny * s, ny: lnx * s + lny * c, depth };
  }
  const d = Math.sqrt(d2);
  const wx = (ex * c - ey * s) / d, wy = (ex * s + ey * c) / d;
  return { nx: -wx, ny: -wy, depth: ci.r - d };
}

export function rayAabb(x0: number, y0: number, dx: number, dy: number, b: Box2): RayHit | null {
  let tmin = 0, tmax = 1, nx = 0, ny = 0;
  if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 || x0 > b.x1) return null; }
  else {
    let t1 = (b.x0 - x0) / dx, t2 = (b.x1 - x0) / dx, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (y0 < b.y0 || y0 > b.y1) return null; }
  else {
    let t1 = (b.y0 - y0) / dy, t2 = (b.y1 - y0) / dy, n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? { t: tmin, nx, ny } : null;
}

export function rayCircle(x0: number, y0: number, dx: number, dy: number, cx: number, cy: number, r: number): RayHit | null {
  const fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return null;
  const hx = x0 + dx * t - cx, hy = y0 + dy * t - cy;
  return { t, nx: hx / r, ny: hy / r };
}
