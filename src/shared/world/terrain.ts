// The ground's real height: open country's rolling swells, plateaus behind sheer cliffs, gorges
// cut down to a river, trestles over them where a trail crosses; towns, water and the railway
// level. Built once at world generation (world/terrainGen.ts) as smooth fields on a grid every
// STEP metres; the cliffs and canyon walls are sharp profiles of those fields worked out at each
// point asked about, so a wall is a couple of metres across however coarse the grid. Shared and
// deterministic (no trig): the server and every client agree bit for bit. A flat world has none.
//
// Heights are where the ground is; a body's z stays above its own ground, so collision and cover
// work as on flat ground. Movement asks `grade` (climbs slow you) and `cliff` (a cliff is a wall);
// sight lines ask `terrainHit` so ridges hide what's behind them.

export const STEP = 8;

/** A timber trestle carrying a trail over a gorge: its deck (rect) and the deck's height at its two
 *  ends along the trail (`axis`). */
export interface Trestle { x0: number; y0: number; x1: number; y1: number; axis: 'h' | 'v'; z0: number; z1: number }

export interface Terrain {
  step: number;
  /** Points per side; point (i, j) is at (i * step, j * step). */
  n: number;
  /** Rolling ground (m). */
  base: Float32Array;
  /** Plateaus: height (m) where one would stand, signed distance (m) in from its rim, how gentle its
   *  edge is (0 a sheer cliff, 1 a slope you can climb). */
  mesaH: Float32Array;
  mesaD: Float32Array;
  ramp: Float32Array;
  /** Gorges: depth (m), signed distance (m) across from the centre line, rim half-width (m). */
  gorgeD: Float32Array;
  gorgeS: Float32Array;
  gorgeW: Float32Array;
  /** Which gorge floors carry a river (1) or are dry (0). */
  river: Float32Array;
  trestles: Trestle[];
  /** Per grid cell, 1 + the trestle over it (0: none), so a height lookup needn't search them. */
  deck: Int16Array;
}

/** How the land breaks: a sheer wall's half-width and the talus at its foot (m), the share of a
 *  plateau's height the talus climbs, how far in (m) a second tier stands and its share, a canyon
 *  wall's width, and the share of its depth the ledge is at. */
const WALL = 2.4, TALUS = 7, TALUS_H = 0.16, TIER_IN = 18, TIER_H = 0.45, CANYON_WALL = 3.4, LEDGE = 0.5;
/** How steep a move may be (rise per metre) before the ground is a wall. */
export const CLIFF = 1.25;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** A plateau's rise (0..1) at signed distance d in from its rim, its wall `w` metres half-wide. */
function mesaRise(d: number, w: number): number {
  if (d >= w) return 1;
  if (d >= -w) return TALUS_H + (1 - TALUS_H) * smooth((d + w) / (2 * w));
  const t = (d + w + TALUS) / TALUS;
  return t > 0 ? TALUS_H * t * t : 0;
}

/** A gorge's floor half-width for rim half-width W: sheer walls, and in a wide one a ledge between
 *  two of them. */
const ledged = (W: number) => W >= 12;
export const gorgeFloor = (W: number): number => Math.max(1.5, ledged(W) ? W - CANYON_WALL * 2 - 3 : W - CANYON_WALL);

/** A gorge's cut (0..1 of its depth) at distance s from its centre line, rim half-width W. */
function gorgeCut(s: number, W: number): number {
  const F = gorgeFloor(W);
  if (s <= F) return 1;
  if (s >= W) return 0;
  if (!ledged(W)) return 1 - smooth((s - F) / (W - F)); // one sheer wall
  if (s <= F + CANYON_WALL) return 1 - (1 - LEDGE) * smooth((s - F) / CANYON_WALL);
  if (s >= W - CANYON_WALL) return LEDGE * (1 - smooth((s - (W - CANYON_WALL)) / CANYON_WALL));
  return LEDGE;
}

/** What the land is at a point: height, how far up a plateau (0..1), how deep in a gorge (0..1),
 *  and whether it's river. Bilinear on the fields, then the sharp profiles. `raw`: the ground
 *  itself, ignoring trestle decks over it. */
export interface Ground { z: number; mesa: number; gorge: number; rise: number; cut: number; water: boolean }
const out: Ground = { z: 0, mesa: 0, gorge: 0, rise: 0, cut: 0, water: false };
export function groundOf(t: Terrain, x: number, y: number, raw = false): Ground {
  out.z = 0; out.mesa = 0; out.gorge = 0; out.rise = 0; out.cut = 0; out.water = false;
  const fx = x / t.step, fy = y / t.step;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= t.n - 1 || j >= t.n - 1) return out;
  const u = fx - i, v = fy - j, k = j * t.n + i, n = t.n;
  const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
  const at = (a: Float32Array) => a[k] * w00 + a[k + 1] * w10 + a[k + n] * w01 + a[k + n + 1] * w11;
  let z = at(t.base);
  const mh = at(t.mesaH);
  if (mh > 0.05) {
    const ramp = at(t.ramp), w = WALL + ramp * 16;
    const d = at(t.mesaD);
    const m = mesaRise(d, w);
    out.mesa = m;
    out.rise = mh * m;
    // Flat-topped: the swell of the land mostly smoothed out up there; broad ones rise again.
    z = z * (1 - 0.75 * m) + mh * m + mh * TIER_H * mesaRise(d - TIER_IN, w) * smooth((mh - 8) / 6);
  }
  const gd = at(t.gorgeD);
  if (gd > 0.05) {
    const s = Math.abs(at(t.gorgeS)), W = at(t.gorgeW);
    const g = gorgeCut(s, W);
    if (g > 0) {
      z -= gd * g;
      out.gorge = g;
      out.cut = gd * g;
      out.water = g >= 1 && gd > 3 && at(t.river) > 0.5 && s < gorgeFloor(W) - 0.8;
    }
  }
  const d = raw ? 0 : t.deck[k];
  if (d) {
    const inside = (b: Trestle) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    // The cell's trestle, or (where two meet in one cell, over a crossroads) whichever holds it.
    const b = inside(t.trestles[d - 1]) ? t.trestles[d - 1] : t.trestles.find(inside);
    if (b) {
      const f = b.axis === 'h' ? (x - b.x0) / (b.x1 - b.x0) : (y - b.y0) / (b.y1 - b.y0);
      z = b.z0 + (b.z1 - b.z0) * f;
      out.water = false;
    }
  }
  out.z = z;
  return out;
}

/** Ground height (m) at (x, y): 0 off the map (and on upper floors, far past it) or in a flat world. */
export function groundZ(t: Terrain | undefined, x: number, y: number, raw = false): number {
  return t ? groundOf(t, x, y, raw).z : 0;
}

/** Rise per metre heading along (dx, dy) (a unit vector) at (x, y): + uphill, - downhill. */
export function grade(t: Terrain | undefined, x: number, y: number, dx: number, dy: number): number {
  if (!t) return 0;
  return (groundZ(t, x + dx * 2, y + dy * 2) - groundZ(t, x - dx * 2, y - dy * 2)) / 4;
}

/**
 * A cliff is a wall: a body that moved from (px, py) to (b.x, b.y) up or down anything steeper
 * than CLIFF is held back, sliding along the edge where it can. One already on a steep face (put
 * there) may always move down off it. Returns the push-back normal, or null.
 */
export function cliff(t: Terrain | undefined, b: { x: number; y: number }, px: number, py: number): { nx: number; ny: number } | null {
  if (!t) return null;
  const z0 = groundZ(t, px, py);
  const steep = (x: number, y: number): boolean => {
    const d = Math.hypot(x - px, y - py);
    const dz = groundZ(t, x, y) - z0;
    // No allowance: a body pushing at a wall moves a hair each tick, and would inch up it.
    return d > 1e-6 && Math.abs(dz) > CLIFF * d && !(dz < 0 && onFace(t, px, py));
  };
  if (!steep(b.x, b.y)) return null;
  const gx = groundZ(t, b.x + 0.5, b.y) - groundZ(t, b.x - 0.5, b.y), gy = groundZ(t, b.x, b.y + 0.5) - groundZ(t, b.x, b.y - 0.5);
  const up = groundZ(t, b.x, b.y) > z0;
  if (!steep(b.x, py)) b.y = py;
  else if (!steep(px, b.y)) b.x = px;
  else { b.x = px; b.y = py; }
  const g = Math.hypot(gx, gy) || 1;
  // Away from the wall: downhill if it was climbing, back up onto the top if it was going over.
  return up ? { nx: -gx / g, ny: -gy / g } : { nx: gx / g, ny: gy / g };
}

/** Standing on a face steeper than a cliff (only something put there can be). */
function onFace(t: Terrain, x: number, y: number): boolean {
  const gx = groundZ(t, x + 0.5, y) - groundZ(t, x - 0.5, y), gy = groundZ(t, x, y + 0.5) - groundZ(t, x, y - 0.5);
  return Math.hypot(gx, gy) > CLIFF;
}

/** Sample spacing (m) along a sight line, the stretch at each end left out (the slope you stand
 *  on doesn't hide you), and how far the ground must rise over the line to block it. */
const LOOK = 2, ENDS = 1.5, CLEAR = 0.15;

/**
 * Where the ground first rises over the line from (x0, y0) to (x1, y1), each end z above its own
 * ground (a fraction along it, before `until`), or null if nothing in between stands in the way.
 */
export function terrainHit(t: Terrain | undefined, x0: number, y0: number, x1: number, y1: number, z: number, until = 1): number | null {
  if (!t) return null;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len <= ENDS * 2) return null;
  const z0 = groundZ(t, x0, y0) + z, z1 = groundZ(t, x1, y1) + z;
  const n = Math.ceil(len / LOOK), lo = ENDS / len, hi = Math.min(until, 1 - ENDS / len);
  for (let k = 1; k < n; k++) {
    const f = k / n;
    if (f < lo) continue;
    if (f > hi) break;
    if (groundZ(t, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f) > z0 + (z1 - z0) * f + CLEAR) return f;
  }
  return null;
}

/** Steepest uphill slowdown and the downhill boost a body gets from the ground (factors on its top
 *  speed): a 10% climb costs about a quarter, a descent gives up to a tenth. */
const UPHILL = 2.6, DOWNHILL = 0.6, SLOWEST = 0.4, FASTEST = 1.1;
export function slopeFactor(g: number): number {
  return g > 0 ? Math.max(SLOWEST, 1 - g * UPHILL) : Math.min(FASTEST, 1 - g * DOWNHILL);
}

// ------------------------------------------------------------------ the client's installed ground

let installed: Terrain | undefined;
/** The client installs its city's ground once, for drawing (render code asks `groundAt`). */
export function installTerrain(t: Terrain | undefined): void { installed = t; }
export const installedTerrain = (): Terrain | undefined => installed;
export const groundAt = (x: number, y: number): number => groundZ(installed, x, y);
/** The lowest ground under a footprint of radius r: where to stand a thing so no side floats. */
export function groundUnder(x: number, y: number, r: number): number {
  if (!installed) return 0;
  return Math.min(groundAt(x, y), groundAt(x - r, y), groundAt(x + r, y), groundAt(x, y - r), groundAt(x, y + r));
}
