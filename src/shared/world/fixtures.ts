// Fixtures (Universe.fixtures, packs/types.ts FixtureSpec): built and growing things the world
// places at generation, shared by server and clients (Rng and arithmetic only), so they collide
// where they're drawn. A street lot's generated building gives way to a church or a water tower; a
// town square gets its gallows; homestead yards their barns, corrals, wells and windmills; open
// country its cacti and skulls (placed with the rock, world/landforms.ts).
import type { Rect } from '../math';
import { FIXTURES, ZONES } from '../packs';
import type { FixtureSpec } from '../packs/types';
import type { Rng } from '../rng';
import { type Block, Dir, type Fixture, type Lot } from './cityTypes';

/** The turn that faces a fixture's front toward a street side. */
const FACING: Record<Dir, Fixture['turn']> = { [Dir.E]: 0, [Dir.S]: 1, [Dir.W]: 2, [Dir.N]: 3 };

/** A fixture's footprint on the map (its size turned a quarter for odd turns). */
export function fixtureRect(f: Fixture): Rect {
  const [w, d] = FIXTURES[f.spec].size;
  const hx = (f.turn % 2 ? d : w) / 2, hy = (f.turn % 2 ? w : d) / 2;
  return { x0: f.x - hx, y0: f.y - hy, x1: f.x + hx, y1: f.y + hy };
}

/** Where a corral's rails stand: its sides as thin boxes, a gate gap in the front side. */
export function ringSides(f: Fixture, t = 0.25, gate = 3.2): Rect[] {
  const r = fixtureRect(f);
  const cx = f.x, cy = f.y;
  const sides: Rect[] = [];
  const side = (x0: number, y0: number, x1: number, y1: number, front: boolean, alongX: boolean) => {
    if (!front) { sides.push({ x0, y0, x1, y1 }); return; }
    if (alongX) { sides.push({ x0, y0, x1: cx - gate / 2, y1 }, { x0: cx + gate / 2, y0, x1, y1 }); } else { sides.push({ x0, y0, x1, y1: cy - gate / 2 }, { x0, y0: cy + gate / 2, x1, y1 }); }
  };
  side(r.x0, r.y0, r.x1, r.y0 + t, f.turn === 3, true);
  side(r.x0, r.y1 - t, r.x1, r.y1, f.turn === 1, true);
  side(r.x0, r.y0, r.x0 + t, r.y1, f.turn === 2, false);
  side(r.x1 - t, r.y0, r.x1, r.y1, f.turn === 0, false);
  return sides;
}

const zonesOf = (spec: FixtureSpec) => new Set(spec.zones.map((id) => ZONES.findIndex((z) => z.id === id)));
const overlaps = (a: Rect, b: Rect, m: number) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const inset = (r: Rect, m: number): Rect => ({ x0: r.x0 + m, y0: r.y0 + m, x1: r.x1 - m, y1: r.y1 - m });

/**
 * Fixtures on lots, squares and yards (open country's come with the rock). A lot fixture replaces
 * the lot's generated building. `keepClear` tells the lot builder where trees mustn't grow.
 */
export function placeFixtures(rng: Rng, lots: Lot[], blocks: Block[], keepClear: (lot: number, r: Rect) => void, out: Fixture[],
  stations: { x: number; y: number }[] = []): void {
  const taken = new Map<number, Rect[]>();
  FIXTURES.forEach((spec, si) => {
    if (spec.site === 'wild') return;
    if (spec.site === 'station') { atStations(spec, si, lots, stations, rng, taken, keepClear, out); return; }
    const zones = zonesOf(spec);
    const perTown = new Map<number, number>();
    for (const lot of lots) {
      if (!zones.has(lot.zone)) continue;
      const town = blocks[lot.block]?.district ?? -1;
      if (spec.most !== undefined && (perTown.get(town) ?? 0) >= spec.most) continue;
      const f = site(spec, si, lot, rng, taken.get(lot.id) ?? []);
      if (!f) continue;
      if (!rng.chance(spec.chance)) continue;
      if (spec.site === 'lot') delete lot.building; // it stands in place of the generated building
      out.push(f);
      const r = fixtureRect(f);
      (taken.get(lot.id) ?? taken.set(lot.id, []).get(lot.id)!).push(r);
      keepClear(lot.id, r);
      perTown.set(town, (perTown.get(town) ?? 0) + 1);
    }
  });
}

/** Where on this lot the fixture would go, or null if the lot won't take it. */
function site(spec: FixtureSpec, si: number, lot: Lot, rng: Rng, taken: Rect[]): Fixture | null {
  const color = spec.colors?.length ? spec.colors[Math.floor(rng.next() * spec.colors.length)] : '#888888';
  const cx = (lot.rect.x0 + lot.rect.x1) / 2, cy = (lot.rect.y0 + lot.rect.y1) / 2;
  const fits = (f: Fixture, within: Rect) => inside(fixtureRect(f), within) && !taken.some((t) => overlaps(fixtureRect(f), t, 1.5));
  switch (spec.site) {
    case 'lot': {
      if (lot.use !== 'building' || !lot.building || lot.service !== undefined || lot.property !== undefined || lot.front < 0) return null;
      const f: Fixture = { spec: si, x: cx, y: cy, turn: FACING[lot.front as Dir], color };
      return fits(f, inset(lot.rect, 1)) ? f : null;
    }
    case 'square': {
      if (lot.use !== 'plaza') return null;
      const f: Fixture = { spec: si, x: cx, y: cy, turn: rng.int(0, 3) as Fixture['turn'], color };
      return fits(f, inset(lot.rect, 1.5)) ? f : null;
    }
    case 'yard': {
      if (lot.use !== 'yard' || !lot.building) return null;
      const b = lot.building.rect, area = inset(lot.rect, 2.5);
      for (let k = 0; k < 8; k++) {
        const f: Fixture = { spec: si, x: rng.range(area.x0, area.x1), y: rng.range(area.y0, area.y1), turn: rng.int(0, 3) as Fixture['turn'], color };
        if (fits(f, area) && !overlaps(fixtureRect(f), b, 3)) return f;
      }
      return null;
    }
    default: return null;
  }
}

/** A depot beside each station: the plain street lot nearest the platform, its front to the track. */
function atStations(spec: FixtureSpec, si: number, lots: Lot[], stations: { x: number; y: number }[], rng: Rng,
  taken: Map<number, Rect[]>, keepClear: (lot: number, r: Rect) => void, out: Fixture[]): void {
  const zones = zonesOf(spec);
  for (const s of stations) {
    if (!rng.chance(spec.chance)) continue;
    // The free building lots within a short walk of the platform, nearest first: the first it fits
    // on, fronting the platform if it can, else turned along it.
    const near = lots.filter((lot) => zones.has(lot.zone) && lot.use === 'building' && !!lot.building && lot.service === undefined
      && lot.property === undefined && !taken.has(lot.id) && dist(lot, s) < 75).sort((a, b) => dist(a, s) - dist(b, s));
    const color = spec.colors?.length ? spec.colors[Math.floor(rng.next() * spec.colors.length)] : '#888888';
    let placed: { lot: Lot; f: Fixture } | null = null;
    for (const lot of near) {
      const cx = (lot.rect.x0 + lot.rect.x1) / 2, cy = (lot.rect.y0 + lot.rect.y1) / 2;
      // Front toward the platform: the axis it lies furthest along.
      const dx = s.x - cx, dy = s.y - cy;
      const front: Fixture['turn'] = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      for (const turn of [front, ((front + 1) % 4) as Fixture['turn'], ((front + 3) % 4) as Fixture['turn']]) {
        const f: Fixture = { spec: si, x: cx, y: cy, turn, color };
        if (inside(fixtureRect(f), inset(lot.rect, 0.5))) { placed = { lot, f }; break; }
      }
      if (placed) break;
    }
    if (!placed) continue;
    delete placed.lot.building;
    out.push(placed.f);
    taken.set(placed.lot.id, [fixtureRect(placed.f)]);
    keepClear(placed.lot.id, fixtureRect(placed.f));
  }
}

const dist = (lot: Lot, p: { x: number; y: number }) => Math.hypot((lot.rect.x0 + lot.rect.x1) / 2 - p.x, (lot.rect.y0 + lot.rect.y1) / 2 - p.y);

/** Open country's fixtures in one area, placed with the rock: `fits`/`clear` as landforms.ts. */
export function wildFixtures(rng: Rng, zone: number, area: Rect, fits: (r: Rect) => boolean, clear: Rect[], out: Fixture[]): void {
  const per = ((area.x1 - area.x0) * (area.y1 - area.y0)) / 10_000;
  FIXTURES.forEach((spec, si) => {
    if (spec.site !== 'wild' || !zonesOf(spec).has(zone)) return;
    const n = Math.floor(per * spec.chance + rng.next());
    for (let k = 0; k < n; k++) {
      const color = spec.colors?.length ? spec.colors[Math.floor(rng.next() * spec.colors.length)] : '#888888';
      const f: Fixture = { spec: si, x: rng.range(area.x0, area.x1), y: rng.range(area.y0, area.y1), turn: rng.int(0, 3) as Fixture['turn'], color };
      const r = fixtureRect(f);
      if (!fits(r)) continue;
      clear.push(r);
      out.push(f);
    }
  });
}
