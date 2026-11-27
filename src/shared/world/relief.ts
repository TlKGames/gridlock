// The lie of the land in open country: one height map for the whole world, so rises, ridges and
// washes run on across block edges. Pure arithmetic on integer hashes (no trig, no Math.random),
// so the server's world generation (rock formations on the high ground) and every client's ground
// painting agree bit for bit. How hilly each zone is, and its colours, are nouns (WildSpec.relief).
// Movement stays flat: the relief is something you see, and the rock on it is what you ride round.

/** A hash of a lattice point to [0, 1). */
function hash(ix: number, iy: number, s: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) at (x, y) in lattice units. */
export function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Feature sizes (m) and weights: long swells, hills, then the knolls and hummocks you see within a
 *  screen of the street camera (about 70 m across). */
const OCTAVES: [number, number][] = [[620, 0.3], [240, 0.24], [95, 0.2], [40, 0.15], [17, 0.11]];

/**
 * The land's shape at (x, y), 0 (the bottom of a wash) to 1 (a ridge top). Rolling swells, with
 * ridges sharpened where it runs high, and washes cut along the low lines.
 */
export function relief(seed: number, x: number, y: number): number {
  let h = 0;
  for (let k = 0; k < OCTAVES.length; k++) {
    const [size, w] = OCTAVES[k];
    h += vnoise(x / size, y / size, seed + k * 101) * w;
  }
  // Ridged on the high ground: 1 - |2n - 1| turns rounded tops into crests.
  const r = vnoise(x / 170, y / 170, seed + 977);
  const ridge = 1 - Math.abs(2 * r - 1);
  h = h * 0.8 + ridge * ridge * 0.2 * h;
  // Washes: along slow wandering lines the ground dips into a gully with soft banks and a broad
  // sandy floor (a smooth profile, not a V that would shade as a hard stripe).
  const wash = Math.abs(vnoise(x / 220, y / 220, seed + 1531) - 0.5);
  if (wash < 0.06) {
    const t = Math.min(1, (0.06 - wash) / 0.035);
    h -= t * t * (3 - 2 * t) * 0.11;
  }
  return h < 0 ? 0 : h > 1 ? 1 : h;
}

/**
 * The broad swell of the land at (x, y), about 0..1: only the long rises and hills of `relief`
 * (no knolls, ridges or washes, which are finer than the ground's height grid can carry), for the
 * ground's real height (world/terrainGen.ts); the fine shape stays painted.
 */
export function swell(seed: number, x: number, y: number): number {
  let h = 0, w = 0;
  for (let k = 0; k < 3; k++) {
    const [size, wk] = OCTAVES[k];
    h += vnoise(x / size, y / size, seed + k * 101) * wk;
    w += wk;
  }
  return h / w;
}

/** A gentle wobble (m) for blending zones into each other along wandering edges, not ruled lines. */
export function warp(seed: number, x: number, y: number, amp: number): [number, number] {
  return [(vnoise(x / 90, y / 90, seed + 211) - 0.5) * 2 * amp, (vnoise(x / 90, y / 90, seed + 419) - 0.5) * 2 * amp];
}
