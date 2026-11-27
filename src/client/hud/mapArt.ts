// The city map image shared by the radar and the big map: dark land, streets drawn as streets,
// blocks in muted zone colours, buildings, and gang turf hatched in the gang's colour.
import { FACTIONS, FIXTURES, ZONES } from '../../shared/packs';
import { fixtureRect } from '../../shared/world/fixtures';
import type { CityMap } from '../../shared/world/city';
import { LAND0, LAND1, MAP_SIZE } from '../../shared/world/cityTypes';
import { turfGang } from '../../shared/world/gangTurf';

export const MAP_COLORS = { water: '#0e2431', land: '#15181d', road: '#3a404a', arterial: '#4b525e', rock: '#3a2a22', rail: '#8f96a3', station: '#d8dde6' };

/** Blends a hex colour toward another (t = share of `b`). */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Diagonal stripes in a colour, for hatching turf. */
function hatch(ctx: CanvasRenderingContext2D, color: string, scale: number): CanvasPattern {
  const c = document.createElement('canvas');
  const n = Math.max(6, Math.round(14 * scale));
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, n * 0.18);
  g.beginPath(); g.moveTo(-1, n + 1); g.lineTo(n + 1, -1); g.stroke();
  return ctx.createPattern(c, 'repeat')!;
}

/** Bakes the map at `scale` pixels per metre. */
export function bakeCityMap(map: CityMap, scale: number): HTMLCanvasElement {
  const city = map.city;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(MAP_SIZE * scale);
  const ctx = c.getContext('2d')!;
  // Past the land: sea, or (a landlocked map) the cliffs, drawn like rock.
  ctx.fillStyle = city.edge === 'sea' ? MAP_COLORS.water : MAP_COLORS.rock;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = MAP_COLORS.land;
  ctx.fillRect(LAND0, LAND0, LAND1 - LAND0, LAND1 - LAND0);
  ctx.fillStyle = MAP_COLORS.water;
  if (map.river) ctx.fillRect(0, map.river.y0, MAP_SIZE, map.river.y1 - map.river.y0);
  for (const b of city.blocks) {
    ctx.fillStyle = mix(ZONES[b.zone].mapColor, MAP_COLORS.land, 0.4);
    ctx.fillRect(b.rect.x0, b.rect.y0, b.rect.x1 - b.rect.x0, b.rect.y1 - b.rect.y0);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  for (const bd of city.buildings) ctx.fillRect(bd.rect.x0, bd.rect.y0, bd.rect.x1 - bd.rect.x0, bd.rect.y1 - bd.rect.y0);
  // Solid fixtures (a church, a barn) show as buildings do.
  for (const f of city.fixtures) {
    if (FIXTURES[f.spec].solid !== 'box') continue;
    const r = fixtureRect(f);
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }
  // Open country: ponds and rock formations.
  ctx.fillStyle = MAP_COLORS.water;
  for (const p of city.ponds) ctx.fillRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
  ctx.fillStyle = MAP_COLORS.rock;
  for (const o of city.obstacles) if (o.kind === 'rock') ctx.fillRect(o.rect.x0, o.rect.y0, o.rect.x1 - o.rect.x0, o.rect.y1 - o.rect.y0);
  for (const r of city.rocks) {
    if (r.r < 2) continue; // boulders are too small to map
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.fill();
  }
  // Streets on top of the land between blocks, wider and brighter for arterials.
  for (const s of city.segs) {
    ctx.fillStyle = s.lanes > 1 ? MAP_COLORS.arterial : MAP_COLORS.road;
    const half = s.width / 2;
    const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1);
    if (s.axis === 'h') ctx.fillRect(x0, (y0 + y1) / 2 - half, x1 - x0, half * 2);
    else ctx.fillRect((x0 + x1) / 2 - half, y0, half * 2, y1 - y0);
  }
  // The railway: a dark line with cross ties, its stations as blocks.
  const rail = city.railway;
  if (rail) {
    const P = (a: number, l: number) => (rail.axis === 'h' ? [a, rail.pos + l] : [rail.pos + l, a]) as [number, number];
    const mid = (rail.tracks[0] + rail.tracks[rail.tracks.length - 1]) / 2;
    ctx.strokeStyle = MAP_COLORS.rail; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(...P(rail.a0 - 30, mid)); ctx.lineTo(...P(rail.a1 + 30, mid)); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.setLineDash([1.2, 5]);
    ctx.beginPath(); ctx.moveTo(...P(rail.a0 - 30, mid - 3)); ctx.lineTo(...P(rail.a1 + 30, mid - 3)); ctx.moveTo(...P(rail.a0 - 30, mid + 3)); ctx.lineTo(...P(rail.a1 + 30, mid + 3)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MAP_COLORS.station;
    for (const s of rail.stations) {
      const p = P(s.a - s.half, mid - 6), q = P(s.a + s.half, mid + 6);
      ctx.fillRect(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]));
    }
  }
  ctx.restore();
  // Gang turf: hatched in the gang's colour with a solid edge.
  const patterns = new Map(FACTIONS.filter((f) => f.gang).map((f) => [f.id, hatch(ctx, `${f.color}66`, scale)]));
  for (const b of city.blocks) {
    const gang = turfGang(b.district);
    if (!gang) continue;
    const r = { x: b.rect.x0 * scale, y: b.rect.y0 * scale, w: (b.rect.x1 - b.rect.x0) * scale, h: (b.rect.y1 - b.rect.y0) * scale };
    ctx.fillStyle = patterns.get(gang)!;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = `${FACTIONS.find((f) => f.id === gang)!.color}aa`;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }
  return c;
}
