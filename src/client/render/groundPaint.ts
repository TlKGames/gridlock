// Paints a square chunk of the city ground (roads, markings, sidewalks, lots, water) to a canvas.
import { Rng } from '../../shared/rng';
import { ZONES } from '../../shared/packs';
import type { CityMap } from '../../shared/world/city';
import { LAND0, LAND1, LANE_W, MAP_SIZE, type Segment } from '../../shared/world/cityTypes';
import { WORLD } from '../../shared/world/worldSpec';
import { hasWild, paintRelief } from './groundRelief';
import { boardwalk, grid, paintLot } from './lotPaint';

// Keep full-detail texture uploads at 512 × 512 as the camera crosses the city.
export const CHUNK = 64;
export const GROUND_PX = 8; // full-detail pixels per metre
export const PREVIEW_PX = 4;
const ASPHALT = '#3b3e43';
const ASPHALT_ART = '#36393e';
const WATER = '#1f4250';

let noise: HTMLCanvasElement | null = null;
function noisePattern(): HTMLCanvasElement {
  if (noise) return noise;
  noise = document.createElement('canvas');
  noise.width = noise.height = 256;
  const ctx = noise.getContext('2d')!;
  const img = ctx.createImageData(256, 256);
  const rng = new Rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + rng.next() * 50;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return noise;
}

/** Paints one chunk's ground. A generator: it pauses now and then (render/ground.ts spreads a
 *  chunk's painting over frames). */
export function* paintChunk(map: CityMap, cx: number, cy: number, canvas: HTMLCanvasElement, px = GROUND_PX): Generator<void> {
  const city = map.city;
  const size = CHUNK * px;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const X0 = cx * CHUNK, Y0 = cy * CHUNK, X1 = X0 + CHUNK, Y1 = Y0 + CHUNK;
  ctx.setTransform(px, 0, 0, px, -X0 * px, -Y0 * px);
  const inView = (x0: number, y0: number, x1: number, y1: number) => x1 >= X0 && x0 <= X1 && y1 >= Y0 && y0 <= Y1;
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); };

  if (city.edge === 'sea') {
    rect(X0, Y0, X1, Y1, WATER);
    // Shoreline: a lighter shallow band, then land.
    rect(LAND0 - 3, LAND0 - 3, LAND1 + 3, LAND1 + 3, '#2c5866');
  }
  rect(LAND0, LAND0, LAND1, LAND1, WORLD.ground);
  // Open country's ground from the lie of the land (groundRelief.ts); towns and roads go over it.
  if (hasWild()) { yield* paintRelief(ctx, map, X0, Y0, CHUNK); grain(ctx, map, cx, cy); yield; }
  const r = map.river;
  if (r && inView(0, r.y0, MAP_SIZE, r.y1)) {
    // Embankment: concrete in a modern city, a muddy bank before.
    rect(X0, r.y0 - 1.5, X1, r.y1 + 1.5, WORLD.modern ? '#8c8a82' : '#6e5a40');
    rect(X0, r.y0, X1, r.y1, WATER);
  }

  // A railway's own corridor (world/corridors.ts): a paved alley under the viaduct.
  for (const [lines, v] of [[city.xs, true], [city.ys, false]] as const) {
    for (const l of lines) {
      if (!l.rail) continue;
      const r = v ? { x0: l.pos - l.width / 2, x1: l.pos + l.width / 2, y0: LAND0, y1: LAND1 } : { x0: LAND0, x1: LAND1, y0: l.pos - l.width / 2, y1: l.pos + l.width / 2 };
      if (!inView(r.x0, r.y0, r.x1, r.y1)) continue;
      rect(r.x0, r.y0, r.x1, r.y1, WORLD.modern ? '#6f6c66' : '#6e5a40');
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      for (let a = Math.floor((v ? Math.max(r.y0, Y0) : Math.max(r.x0, X0)) / 2.4) * 2.4; a < (v ? Math.min(r.y1, Y1) : Math.min(r.x1, X1)); a += 2.4) {
        if (v) ctx.fillRect(r.x0, a, r.x1 - r.x0, 0.12); else ctx.fillRect(a, r.y0, 0.12, r.y1 - r.y0);
      }
    }
  }
  yield;
  // Roads (trails: packed dirt).
  for (const s of city.segs) {
    const hw = s.width / 2;
    const x0 = Math.min(s.x0, s.x1) - (s.axis === 'v' ? hw : 0), x1 = Math.max(s.x0, s.x1) + (s.axis === 'v' ? hw : 0);
    const y0 = Math.min(s.y0, s.y1) - (s.axis === 'h' ? hw : 0), y1 = Math.max(s.y0, s.y1) + (s.axis === 'h' ? hw : 0);
    if (!inView(x0, y0, x1, y1)) continue;
    rect(x0, y0, x1, y1, s.trail || !WORLD.modern ? TRAIL() : s.lanes > 1 ? ASPHALT_ART : ASPHALT);
    if (s.bridge) {
      const kerb = WORLD.modern ? '#9a978e' : '#6a4e34';
      rect(x0 - 1.2, y0, x0, y1, kerb);
      rect(x1, y0, x1 + 1.2, y1, kerb);
    }
  }
  for (const n of city.nodes) {
    if (!inView(n.x - n.wv, n.y - n.wh, n.x + n.wv, n.y + n.wh)) continue;
    rect(n.x - n.wv / 2, n.y - n.wh / 2, n.x + n.wv / 2, n.y + n.wh / 2, !WORLD.modern || n.segs.every((si) => city.segs[si].trail) ? TRAIL() : ASPHALT);
  }
  if (WORLD.modern) for (const s of city.segs) if (!s.trail) roadWear(ctx, s, inView);

  yield;
  // Blocks and lots.
  for (const b of city.blocks) {
    const br = b.rect;
    if (!inView(br.x0, br.y0, br.x1, br.y1)) continue;
    const z = ZONES[b.zone];
    if (z.layout === 'wild') continue; // painted by the lie of the land, above
    rect(br.x0, br.y0, br.x1, br.y1, z.sidewalk);
    if (WORLD.modern) {
      grid(ctx, { x0: br.x0 + 0.4, y0: br.y0 + 0.4, x1: br.x1 - 0.4, y1: br.y1 - 0.4 }, 1.5, 'rgba(0,0,0,0.08)');
      // Curb edge.
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.25;
      ctx.strokeRect(br.x0 + 0.12, br.y0 + 0.12, br.x1 - br.x0 - 0.24, br.y1 - br.y0 - 0.24);
    } else if (z.busy) boardwalk(ctx, br); // a town's plank walks; elsewhere bare ground

    for (const li of b.lots) paintLot(ctx, city.lots[li], z.ground);
  }
  // Ponds, with a muddy shore.
  for (const p of city.ponds) {
    if (!inView(p.x0 - 2, p.y0 - 2, p.x1 + 2, p.y1 + 2)) continue;
    rect(p.x0 - 1.4, p.y0 - 1.4, p.x1 + 1.4, p.y1 + 1.4, '#6a5a44');
    rect(p.x0, p.y0, p.x1, p.y1, WATER);
  }

  yield;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.12;
  ctx.globalCompositeOperation = 'overlay';
  const pattern = ctx.createPattern(noisePattern(), 'repeat')!;
  // The grain tile covers 64 world metres at either resolution.
  pattern.setTransform(new DOMMatrix().scale(px / 4));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Deterministic per-segment asphalt wear: patches, oil drips down the lanes, manholes. */
function roadWear(ctx: CanvasRenderingContext2D, s: Segment, inView: (a: number, b: number, c: number, d: number) => boolean): void {
  const hw = s.width / 2;
  if (!inView(Math.min(s.x0, s.x1) - hw, Math.min(s.y0, s.y1) - hw, Math.max(s.x0, s.x1) + hw, Math.max(s.y0, s.y1) + hw)) return;
  const rng = new Rng(s.id * 7919 + 13);
  const len = s.axis === 'h' ? s.x1 - s.x0 : s.y1 - s.y0;
  const at = (along: number, across: number): [number, number] => (s.axis === 'h' ? [s.x0 + along, s.y0 + across] : [s.x0 + across, s.y0 + along]);
  for (let k = 0; k < Math.floor(len / 30); k++) {
    const [x, y] = at(rng.range(8, len - 8), rng.range(-hw + 1, hw - 1));
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(20,20,22,0.25)' : 'rgba(120,120,118,0.12)';
    const a = rng.range(2, 6), b = rng.range(1.5, 3.5);
    ctx.fillRect(x - a / 2, y - b / 2, s.axis === 'h' ? a : b, s.axis === 'h' ? b : a);
  }
  // Faint oil drip line down the middle of each lane.
  ctx.fillStyle = 'rgba(10,10,10,0.07)';
  for (let lane = -s.lanes; lane < s.lanes; lane++) {
    const across = (lane + 0.5) * LANE_W;
    for (let p = 6; p < len - 6; p += rng.range(6, 16)) {
      const [x, y] = at(p, across + rng.range(-0.3, 0.3));
      const l = rng.range(1, 3);
      ctx.beginPath();
      ctx.ellipse(x, y, s.axis === 'h' ? l : 0.35, s.axis === 'h' ? 0.35 : l, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let k = 0; k < Math.max(1, Math.floor(len / 70)); k++) {
    const [x, y] = at(rng.range(10, len - 10), rng.range(-LANE_W, LANE_W));
    ctx.fillStyle = '#2a2b2e';
    ctx.beginPath(); ctx.arc(x, y, 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(160,160,160,0.35)'; ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.arc(x, y, 0.32, 0, Math.PI * 2); ctx.stroke();
  }
}

/** Trails' dirt colour: the open country's (the first wild zone's), else a plain dirt brown. */
let trailColor: string | null = null;
const TRAIL = (): string => (trailColor ??= ZONES.find((z) => z.wild)?.wild?.trail ?? '#8a7356');

/** Open country's fine grain over its ground (groundRelief.ts paints the ground itself): pebbles,
 *  dry tufts and scuffed dirt, small and round, wherever the country is open (trails go over it).
 *  Per chunk from its own seed. The brush is 3D (brush.ts). */
function grain(ctx: CanvasRenderingContext2D, map: CityMap, cx: number, cy: number): void {
  const rng = new Rng((cy * 4099 + cx) * 7907 + 3);
  const X0 = cx * CHUNK, Y0 = cy * CHUNK;
  for (let k = 0; k < (CHUNK * CHUNK) / 10; k++) {
    const x = X0 + rng.next() * CHUNK, y = Y0 + rng.next() * CHUNK, t = rng.next(), r = rng.range(0.06, 0.22);
    const z = map.zoneAt(x, y);
    if (z < 0 || ZONES[z].layout !== 'wild') continue;
    ctx.fillStyle = t < 0.45 ? 'rgba(60,45,30,0.22)' : t < 0.8 ? 'rgba(255,240,210,0.16)' : 'rgba(80,90,50,0.25)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
