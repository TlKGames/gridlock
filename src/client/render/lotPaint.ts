// Lots and blocks on the ground canvas (groundPaint.ts calls these): parks, yards, plazas, parking,
// pads and service aprons, a town's walks. A modern city (WORLD.modern) gets lawns, driveways,
// hedges, pools, paving; an older era gets packed earth, split-rail fences, garden
// plots, wagon ruts and plank boardwalks.
import { SERVICES } from '../../shared/packs';
import { Rng } from '../../shared/rng';
import { type Lot, SIDEWALK_W } from '../../shared/world/cityTypes';
import { WORLD } from '../../shared/world/worldSpec';

type R = { x0: number; y0: number; x1: number; y1: number };

function grass(ctx: CanvasRenderingContext2D, r: R, seed: number): void {
  const rng = new Rng(seed);
  const n = Math.min(900, Math.floor(((r.x1 - r.x0) * (r.y1 - r.y0)) / 3));
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(30,60,20,0.18)' : 'rgba(170,200,110,0.12)';
    const s = rng.range(0.3, 1.4);
    ctx.fillRect(rng.range(r.x0, r.x1), rng.range(r.y0, r.y1), s, s);
  }
}

export function paintLot(ctx: CanvasRenderingContext2D, lot: Lot, ground: string): void {
  const r = lot.rect, w = r.x1 - r.x0, h = r.y1 - r.y0;
  const fill = (c: string) => { ctx.fillStyle = c; ctx.fillRect(r.x0, r.y0, w, h); };
  if (lot.use === 'park' || (lot.use === 'yard' && WORLD.modern)) { fill(lot.use === 'park' ? '#5c8a43' : '#6a9150'); grass(ctx, r, lot.id * 31 + 7); }
  switch (lot.use) {
    case 'park': {
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      ctx.fillStyle = '#b9ad8f';
      ctx.fillRect(cx - 2, r.y0, 4, h);
      ctx.fillRect(r.x0, cy - 2, w, 4);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4c7f9a';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'yard': if (WORLD.modern) { paintDriveway(ctx, lot); backyard(ctx, lot); } else homestead(ctx, lot, ground); break;
    // An older era's yards and squares are packed earth, not paving.
    case 'plaza': if (WORLD.modern) { fill('#a29d92'); grid(ctx, r, 3, 'rgba(0,0,0,0.08)'); } else fill('#b09a72'); break;
    case 'parking': fill(WORLD.modern ? '#45484d' : '#a8906a'); break;
    case 'containers': fill('#6f6c66'); break;
    case 'pad': {
      // A concrete pad; before concrete, a packed-earth yard (a parade ground).
      fill(WORLD.modern ? '#5a5d55' : '#a08a62');
      if (lot.service !== undefined && SERVICES[lot.service].verb === 'helipad') helipad(ctx, r);
      break;
    }
    default: {
      fill(ground);
      if (lot.pad) {
        // Drive-in apron in front of service buildings (a dirt yard in an older era).
        ctx.fillStyle = WORLD.modern ? '#55585d' : '#9a7a52';
        const b = lot.building?.rect;
        if (b) ctx.fillRect(Math.min(r.x0, b.x0), Math.min(r.y0, b.y0), Math.max(r.x1, b.x1) - Math.min(r.x0, b.x0), Math.max(r.y1, b.y1) - Math.min(r.y0, b.y0));
      }
    }
  }
}

export function grid(ctx: CanvasRenderingContext2D, r: R, step: number, c: string): void {
  ctx.strokeStyle = c;
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  for (let x = r.x0; x <= r.x1; x += step) { ctx.moveTo(x, r.y0); ctx.lineTo(x, r.y1); }
  for (let y = r.y0; y <= r.y1; y += step) { ctx.moveTo(r.x0, y); ctx.lineTo(r.x1, y); }
  ctx.stroke();
}

function paintDriveway(ctx: CanvasRenderingContext2D, lot: Lot): void {
  const b = lot.building?.rect;
  if (!b) return;
  const r = lot.rect;
  ctx.fillStyle = '#8f8d86';
  switch (lot.front) {
    case 0: ctx.fillRect(b.x0 + 0.5, r.y0, 3.5, b.y0 - r.y0); break;
    case 2: ctx.fillRect(b.x0 + 0.5, b.y1, 3.5, r.y1 - b.y1); break;
    case 1: ctx.fillRect(b.x1, b.y0 + 0.5, r.x1 - b.x1, 3.5); break;
    case 3: ctx.fillRect(r.x0, b.y0 + 0.5, b.x0 - r.x0, 3.5); break;
  }
}

/** The strip behind a house (away from the street), inset by `m`. */
function behind(lot: Lot, b: R, m: number): R {
  const r = lot.rect;
  return lot.front === 0 ? { x0: r.x0 + m, x1: r.x1 - m, y0: b.y1 + m, y1: r.y1 - m }
    : lot.front === 2 ? { x0: r.x0 + m, x1: r.x1 - m, y0: r.y0 + m, y1: b.y0 - m }
    : lot.front === 3 ? { x0: b.x1 + m, x1: r.x1 - m, y0: r.y0 + m, y1: r.y1 - m }
    : { x0: r.x0 + m, x1: b.x0 - m, y0: r.y0 + m, y1: r.y1 - m };
}

/** Hedge outline and, sometimes, a pool or patio behind the house. */
function backyard(ctx: CanvasRenderingContext2D, lot: Lot): void {
  const r = lot.rect, b = lot.building?.rect;
  ctx.strokeStyle = 'rgba(40,70,30,0.8)';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(r.x0 + 0.3, r.y0 + 0.3, r.x1 - r.x0 - 0.6, r.y1 - r.y0 - 0.6);
  if (!b) return;
  const rng = new Rng(lot.id * 131 + 5);
  const back = behind(lot, b, 1);
  const w = back.x1 - back.x0, h = back.y1 - back.y0;
  if (w < 6 || h < 6) return;
  if (rng.chance(0.35)) {
    const pw = Math.min(w - 2, rng.range(5, 8)), ph = Math.min(h - 2, rng.range(3.5, 5));
    const x = back.x0 + (w - pw) / 2, y = back.y0 + (h - ph) / 2;
    ctx.fillStyle = '#d9d4c6'; ctx.fillRect(x - 0.8, y - 0.8, pw + 1.6, ph + 1.6);
    ctx.fillStyle = '#3fa7c9'; ctx.fillRect(x, y, pw, ph);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 0.4, y + 0.4, pw * 0.4, 0.3);
  } else if (rng.chance(0.5)) {
    ctx.fillStyle = '#a89c86';
    ctx.fillRect(back.x0, back.y0, Math.min(w, 5), Math.min(h, 4));
  }
}

/** Plank walks round a town block (its sidewalk ring): boards laid across the walk. */
export function boardwalk(ctx: CanvasRenderingContext2D, r: R): void {
  const W = SIDEWALK_W;
  ctx.fillStyle = '#7a5a3a';
  for (const s of [[r.x0, r.y0, r.x1, r.y0 + W], [r.x0, r.y1 - W, r.x1, r.y1], [r.x0, r.y0, r.x0 + W, r.y1], [r.x1 - W, r.y0, r.x1, r.y1]]) ctx.fillRect(s[0], s[1], s[2] - s[0], s[3] - s[1]);
  ctx.strokeStyle = 'rgba(40,25,12,0.45)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let x = r.x0; x <= r.x1; x += 0.3) { ctx.moveTo(x, r.y0); ctx.lineTo(x, r.y0 + W); ctx.moveTo(x, r.y1 - W); ctx.lineTo(x, r.y1); }
  for (let y = r.y0 + W; y <= r.y1 - W; y += 0.3) { ctx.moveTo(r.x0, y); ctx.lineTo(r.x0 + W, y); ctx.moveTo(r.x1 - W, y); ctx.lineTo(r.x1, y); }
  ctx.stroke();
  // The walk's edge: a darker sill board.
  ctx.strokeStyle = 'rgba(40,25,12,0.6)';
  ctx.lineWidth = 0.2;
  ctx.strokeRect(r.x0 + 0.1, r.y0 + 0.1, r.x1 - r.x0 - 0.2, r.y1 - r.y0 - 0.2);
}

/** A homestead's yard before lawns: packed dirt and dry grass, a split-rail fence round it, wagon
 *  ruts from the road to the door, and a garden plot in rows behind the house. */
function homestead(ctx: CanvasRenderingContext2D, lot: Lot, ground: string): void {
  const r = lot.rect, b = lot.building?.rect;
  const rng = new Rng(lot.id * 131 + 5);
  ctx.fillStyle = ground;
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  for (let k = 0; k < Math.min(700, ((r.x1 - r.x0) * (r.y1 - r.y0)) / 4); k++) {
    ctx.fillStyle = rng.chance(0.6) ? 'rgba(120,110,60,0.25)' : 'rgba(70,55,35,0.18)';
    ctx.beginPath(); ctx.arc(rng.range(r.x0, r.x1), rng.range(r.y0, r.y1), rng.range(0.1, 0.5), 0, Math.PI * 2); ctx.fill();
  }
  // Split-rail fence: two rails and the posts.
  ctx.strokeStyle = '#5a4026';
  ctx.lineWidth = 0.12;
  ctx.strokeRect(r.x0 + 0.4, r.y0 + 0.4, r.x1 - r.x0 - 0.8, r.y1 - r.y0 - 0.8);
  ctx.strokeRect(r.x0 + 0.6, r.y0 + 0.6, r.x1 - r.x0 - 1.2, r.y1 - r.y0 - 1.2);
  ctx.fillStyle = '#3e2c1a';
  for (let x = r.x0 + 0.5; x < r.x1; x += 2.6) { ctx.fillRect(x - 0.12, r.y0 + 0.38, 0.24, 0.24); ctx.fillRect(x - 0.12, r.y1 - 0.62, 0.24, 0.24); }
  for (let y = r.y0 + 0.5; y < r.y1; y += 2.6) { ctx.fillRect(r.x0 + 0.38, y - 0.12, 0.24, 0.24); ctx.fillRect(r.x1 - 0.62, y - 0.12, 0.24, 0.24); }
  if (!b) return;
  // Wagon ruts, road to door.
  ctx.fillStyle = 'rgba(90,65,40,0.45)';
  const rut = (x0: number, y0: number, x1: number, y1: number) => ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  switch (lot.front) {
    case 0: rut(b.x0 + 1, r.y0, b.x0 + 1.5, b.y0); rut(b.x0 + 2.8, r.y0, b.x0 + 3.3, b.y0); break;
    case 2: rut(b.x0 + 1, b.y1, b.x0 + 1.5, r.y1); rut(b.x0 + 2.8, b.y1, b.x0 + 3.3, r.y1); break;
    case 1: rut(b.x1, b.y0 + 1, r.x1, b.y0 + 1.5); rut(b.x1, b.y0 + 2.8, r.x1, b.y0 + 3.3); break;
    case 3: rut(r.x0, b.y0 + 1, b.x0, b.y0 + 1.5); rut(r.x0, b.y0 + 2.8, b.x0, b.y0 + 3.3); break;
  }
  // A garden plot in furrows behind the house, most homesteads.
  const back = behind(lot, b, 2);
  const w = Math.min(back.x1 - back.x0, 12), h = Math.min(back.y1 - back.y0, 8);
  if (w < 4 || h < 3 || !rng.chance(0.7)) return;
  ctx.fillStyle = '#6a4e30';
  ctx.fillRect(back.x0, back.y0, w, h);
  for (let y = back.y0 + 0.4; y < back.y0 + h; y += 0.9) {
    ctx.fillStyle = 'rgba(40,28,16,0.5)'; ctx.fillRect(back.x0, y, w, 0.25);
    ctx.fillStyle = 'rgba(80,120,50,0.8)';
    for (let x = back.x0 + 0.3; x < back.x0 + w; x += 0.6) { ctx.beginPath(); ctx.arc(x, y + 0.45, 0.16, 0, Math.PI * 2); ctx.fill(); }
  }
}

function helipad(ctx: CanvasRenderingContext2D, r: R): void {
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  ctx.fillStyle = '#3d4046';
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e2b93b'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f2f0ea';
  ctx.fillRect(cx - 3, cy - 4, 1.2, 8); ctx.fillRect(cx + 1.8, cy - 4, 1.2, 8); ctx.fillRect(cx - 3, cy - 0.6, 6, 1.2);
}
