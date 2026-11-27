// Builds the ground's height (world/terrain.ts) for a generated city: open country's swells from
// the relief map, its zones' plateaus and gorges (WildSpec.mesas, .gorges: nouns), trestles where
// trails cross the gorges. Towns, water and a railway's bed are held level, the land easing down to
// them over FALL metres; plateaus keep back from the trails. Rng-free arithmetic, no trig.
import { ZONES } from '../packs';
import { MAP_SIZE } from './cityTypes';
import type { City } from './cityTypes';
import type { CityMap } from './city';
import { swell, vnoise } from './relief';
import { groundOf, STEP, type Terrain, type Trestle } from './terrain';
import { WORLD } from './worldSpec';

/** How far (m) hills ease down to level ground, the relief value at ground level, how wide (grid
 *  points) the blend of one zone's landforms into the next is, and how far plateaus keep from a
 *  trail (m: none nearer, full height past the second). */
const FALL = 60, LEVEL = 0.5, BLEND = 5, TRAIL_CLEAR: [number] = [16];

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The ground heights for a generated city, or undefined for a flat world. */
export function buildTerrain(city: City, map: CityMap): Terrain | undefined {
  const scale = WORLD.terrain?.scale ?? 0;
  if (scale <= 0) return undefined;
  const seed = city.seed;
  const n = Math.ceil(MAP_SIZE / STEP) + 1, N = n * n;
  const f = () => new Float32Array(N);
  // Each zone's nouns on the grid (blended across zone edges below), and where the land is open.
  const amp = f(), mesaH = f(), mesaC = f(), gorgeD = f(), gorgeC = f(), gw0 = f(), gw1 = f(), river = f();
  const open = new Uint8Array(N), road = new Uint8Array(N);
  const rail = city.railway;
  const railHalf = rail ? rail.width / 2 + 14 : 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * STEP, y = j * STEP, k = j * n + i;
      const z = map.zoneAt(x, y);
      const w = z >= 0 && ZONES[z].layout === 'wild' ? ZONES[z].wild : undefined;
      if (!w || map.isWater(x, y)) continue;
      if (rail && Math.abs((rail.axis === 'h' ? y : x) - rail.pos) < railHalf) continue;
      open[k] = 1;
      amp[k] = (w.relief ?? 0) * scale;
      if (w.mesas) { mesaH[k] = w.mesas.height; mesaC[k] = w.mesas.cover; }
      if (w.gorges) { gorgeD[k] = w.gorges.depth; gorgeC[k] = w.gorges.cover; gw0[k] = w.gorges.width[0]; gw1[k] = w.gorges.width[1]; river[k] = w.gorges.river ? 1 : 0; }
    }
  }
  // The trails, from their segments (a grid point every 8 m could miss a narrow one).
  for (const s of city.segs) {
    const half = s.width / 2 + STEP / 2;
    const x0 = Math.min(s.x0, s.x1) - (s.axis === 'v' ? half : 0), x1 = Math.max(s.x0, s.x1) + (s.axis === 'v' ? half : 0);
    const y0 = Math.min(s.y0, s.y1) - (s.axis === 'h' ? half : 0), y1 = Math.max(s.y0, s.y1) + (s.axis === 'h' ? half : 0);
    for (let j = Math.max(0, Math.ceil(y0 / STEP)); j <= Math.min(n - 1, Math.floor(y1 / STEP)); j++) {
      for (let i = Math.max(0, Math.ceil(x0 / STEP)); i <= Math.min(n - 1, Math.floor(x1 / STEP)); i++) road[j * n + i] = 1;
    }
  }
  // Water lies level to its banks: a grid step round each pond and the river is level too.
  for (const r of [...city.ponds, ...(map.river ? [map.river] : [])]) {
    const i0 = Math.max(0, Math.floor(r.x0 / STEP) - 1), i1 = Math.min(n - 1, Math.ceil(r.x1 / STEP) + 1);
    const j0 = Math.max(0, Math.floor(r.y0 / STEP) - 1), j1 = Math.min(n - 1, Math.ceil(r.y1 / STEP) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) open[j * n + i] = 0;
  }
  for (const a of [amp, mesaH, mesaC, gorgeD, gorgeC, gw0, gw1, river]) { blur(a, n, BLEND); blur(a, n, BLEND); }
  const level = distance(open, n);
  const trail = distance(road.map((r, k) => (open[k] && !r ? 1 : 0)), n);

  const t: Terrain = { step: STEP, n, base: f(), mesaH: f(), mesaD: f(), ramp: f(), gorgeD: f(), gorgeS: f(), gorgeW: f(), river, trestles: [], deck: new Int16Array(N) };
  // The noise fields whose contours are the plateaus' rims and the gorges' courses.
  const P = f(), G = f();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * STEP, y = j * STEP, k = j * n + i;
      P[k] = vnoise(x / 210, y / 210, seed + 2203) * 0.62 + vnoise(x / 75, y / 75, seed + 2297) * 0.28 + vnoise(x / 28, y / 28, seed + 2341) * 0.1;
      G[k] = vnoise(x / 260, y / 260, seed + 2411) * 0.8 + vnoise(x / 90, y / 90, seed + 2477) * 0.2;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!open[k]) continue;
      const x = i * STEP, y = j * STEP;
      // Distances wobbled so nothing eases off along a ruled line beside a town or trail.
      const wob = (vnoise(x / 55, y / 55, seed + 2749) - 0.5) * 28;
      // (No wobble right at the level ground's edge: there the land must meet it flat.)
      const mask = smooth(0, FALL, level[k] + wob * Math.min(1, level[k] / FALL));
      t.base[k] = (swell(seed, x, y) - LEVEL) * amp[k] * mask;
      const [px, py] = slope(P, n, i, j), [gx, gy] = slope(G, n, i, j);
      // Plateaus: where P stands above the level its cover asks for; d is metres in from the rim.
      if (mesaH[k] > 0.5 && mesaC[k] > 0.01) {
        const T = 0.72 - 0.42 * mesaC[k];
        // The rim stands back from a trail (a wavering line, not ruled along it).
        const fromTrail = trail[k] - TRAIL_CLEAR[0] + wob * 0.5 + (vnoise(x / 22, y / 22, seed + 2791) - 0.5) * 22;
        t.mesaD[k] = clamp(Math.min((P[k] - T) / Math.max(1e-4, Math.hypot(px, py)), fromTrail), 60);
        t.mesaH[k] = mesaH[k] * mask;
        // Here and there the rim breaks down into a slope you can climb.
        t.ramp[k] = smooth(0.68, 0.8, vnoise(x / 60, y / 60, seed + 2531));
      }
      // Gorges: along the line where G crosses a half, where a slow gate opens; s is metres across.
      if (gorgeD[k] > 0.5 && gorgeC[k] > 0.01) {
        const gate = smooth(0.62 - 0.4 * gorgeC[k], 0.72 - 0.4 * gorgeC[k], vnoise(x / 520, y / 520, seed + 2609));
        t.gorgeS[k] = clamp((G[k] - 0.5) / Math.max(1e-4, Math.hypot(gx, gy)), 60);
        t.gorgeD[k] = gorgeD[k] * gate * mask;
        t.gorgeW[k] = gw0[k] + (gw1[k] - gw0[k]) * vnoise(x / 140, y / 140, seed + 2683);
      }
    }
  }
  t.trestles = trestles(city, t);
  t.trestles.forEach((b, q) => {
    for (let j = Math.max(0, Math.floor(b.y0 / STEP)); j <= Math.min(n - 2, Math.floor(b.y1 / STEP)); j++) {
      for (let i = Math.max(0, Math.floor(b.x0 / STEP)); i <= Math.min(n - 2, Math.floor(b.x1 / STEP)); i++) t.deck[j * n + i] = q + 1;
    }
  });
  return t;
}

const clamp = (v: number, m: number) => (v < -m ? -m : v > m ? m : v);

/** Nothing stands on a cliff face, down a canyon wall or in a river: rock, fixtures and trees
 *  placed there before the land was shaped are taken away. */
export function clearLand(city: City, t: Terrain): void {
  const ok = (x: number, y: number, r: number): boolean => {
    const g = groundOf(t, x, y, true);
    if (g.water || g.cut > 0.6) return false;
    const z = g.z;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (Math.abs(groundOf(t, x + dx, y + dy, true).z - z) > 0.9 * r + 0.4) return false;
    return true;
  };
  city.rocks = city.rocks.filter((r) => ok(r.x, r.y, Math.max(1, r.r)));
  city.fixtures = city.fixtures.filter((f) => ok(f.x, f.y, 1.5));
  city.trees = city.trees.filter((tr) => ok(tr.x, tr.y, 1));
}

/** A field's slope (per metre) at a grid point, by central differences. */
function slope(a: Float32Array, n: number, i: number, j: number): [number, number] {
  const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
  return [(a[j * n + i1] - a[j * n + i0]) / ((i1 - i0) * STEP), (a[j1 * n + i] - a[j0 * n + i]) / ((j1 - j0) * STEP)];
}

/** Trestles: wherever a trail in open country runs over a gorge, a deck from rim to rim. */
function trestles(city: City, t: Terrain): Trestle[] {
  const out: Trestle[] = [];
  for (const s of city.segs) {
    if (!s.trail) continue;
    const h = s.axis === 'h';
    const a0 = h ? s.x0 : s.y0, a1 = h ? s.x1 : s.y1;
    const at = (a: number) => (h ? groundOf(t, a, s.y0, true) : groundOf(t, s.x0, a, true));
    let start = -1;
    for (let a = a0; a <= a1 + 1; a += 1) {
      const cut = a <= a1 && at(a).cut > 1.2;
      if (cut && start < 0) start = a;
      if (!cut && start >= 0) {
        const b0 = start - 2, b1 = a + 1, half = s.width / 2 + 0.6;
        // Each end at the highest ground across the trail there, so none shows through the deck.
        const across = (a: number) => Math.max(...[-half, 0, half].map((o) => (h ? groundOf(t, a, s.y0 + o, true).z : groundOf(t, s.x0 + o, a, true).z)));
        const z0 = across(b0), z1 = across(b1);
        out.push(h ? { x0: b0, x1: b1, y0: s.y0 - half, y1: s.y0 + half, axis: 'h', z0, z1 }
          : { x0: s.x0 - half, x1: s.x0 + half, y0: b0, y1: b1, axis: 'v', z0, z1 });
        start = -1;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ grid helpers

/** Box blur of radius r points, in place (rows then columns). */
function blur(a: Float32Array, n: number, r: number): void {
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let line = 0; line < n; line++) {
      const at = (s: number) => (pass ? s * n + line : line * n + s);
      let sum = 0, cnt = 0;
      for (let s = 0; s <= r && s < n; s++) { sum += a[at(s)]; cnt++; }
      for (let s = 0; s < n; s++) {
        tmp[s] = sum / cnt;
        const add = s + r + 1, drop = s - r;
        if (add < n) { sum += a[at(add)]; cnt++; }
        if (drop >= 0) { sum -= a[at(drop)]; cnt--; }
      }
      for (let s = 0; s < n; s++) a[at(s)] = tmp[s];
    }
  }
}

/** Metres from each set point to the nearest unset one (two-pass chamfer, 3-4 weights). */
function distance(open: Uint8Array, n: number): Float32Array {
  const BIG = 1e9, d = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) d[k] = open[k] ? BIG : 0;
  const A = STEP, D = STEP * 1.4;
  const relax = (k: number, o: number, w: number) => { if (d[o] + w < d[k]) d[k] = d[o] + w; };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!d[k]) continue;
      if (i > 0) relax(k, k - 1, A);
      if (j > 0) { relax(k, k - n, A); if (i > 0) relax(k, k - n - 1, D); if (i < n - 1) relax(k, k - n + 1, D); }
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      if (!d[k]) continue;
      if (i < n - 1) relax(k, k + 1, A);
      if (j < n - 1) { relax(k, k + n, A); if (i < n - 1) relax(k, k + n + 1, D); if (i > 0) relax(k, k + n - 1, D); }
    }
  }
  return d;
}
