// City assembly plus spatial lookups used by physics, AI and rendering.
import type { Rect } from '../math';
import { Rng } from '../rng';
import { type Block, type City, LAND0, LAND1, MAP_SIZE, type ParkSpot, type RoadNode, type Segment } from './cityTypes';
import { WORLD } from './worldSpec';
import { LotBuilder } from './lotgen';
import { placeFixtures } from './fixtures';
import { interiorsOf } from './interiors';
import { floorOf, LEVEL_BAND } from './levels';
import { PlaceBuilder } from './placegen';
import { genGraph, genLayout } from './roadgen';
import { buildRailway } from './railgen';
import { placeTables } from './tables';
import { buildTerrain, clearLand } from './terrainGen';
import { groundOf } from './terrain';
import type { Way } from './wayTypes';

const HALF_PI = Math.PI / 2;

function curbSpots(segs: Segment[], nodes: RoadNode[]): ParkSpot[] {
  const out: ParkSpot[] = [];
  for (const s of segs) {
    if (!s.parking) continue;
    const a = nodes[s.a], b = nodes[s.b];
    const startPad = (s.axis === 'h' ? a.wv : a.wh) / 2 + 6;
    const endPad = (s.axis === 'h' ? b.wv : b.wh) / 2 + 6;
    const len = s.axis === 'h' ? s.x1 - s.x0 : s.y1 - s.y0;
    const off = s.width / 2 - 0.2 - 1.2;
    for (let p = startPad; p < len - endPad; p += 6.6) {
      if (s.axis === 'h') {
        out.push({ x: s.x0 + p, y: s.y0 + off, angle: 0, zone: -1 });
        out.push({ x: s.x0 + p, y: s.y0 - off, angle: Math.PI, zone: -1 });
      } else {
        out.push({ x: s.x0 - off, y: s.y0 + p, angle: HALF_PI, zone: -1 });
        out.push({ x: s.x0 + off, y: s.y0 + p, angle: -HALF_PI, zone: -1 });
      }
    }
  }
  return out;
}

export function generateCity(seed: number): City {
  const rng = new Rng(seed);
  const layout = genLayout(rng);
  const { nodes, segs, bridges } = genGraph(layout);
  // A railway (world/railgen.ts); an elevated one is a way.
  const ways: Way[] = [];
  const railway = buildRailway(layout, { nodes, segs }, ways);
  const lotBuilder = new LotBuilder(rng, seed);
  const lo = lotBuilder.build(layout);
  const nx = layout.xs.length - 1, ny = layout.ys.length - 1;
  const cellBlock = new Int32Array(nx * ny).fill(-1);
  layout.clusters.forEach((c, ci) => {
    for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) cellBlock[j * nx + i] = ci;
  });
  const places = new PlaceBuilder(rng, lo.lots, lo.blocks, lo.obstacles);
  places.build();
  // Churches, water towers, gallows, barns, corrals... (world/fixtures.ts) before the trees, so
  // trees keep clear of them; open country's came with its rock.
  placeFixtures(rng, lo.lots, lo.blocks, (lot, r) => lotBuilder.keepClear(lot, r), lo.fixtures,
    (railway?.stations ?? []).flatMap((s) => (s.exits[0] ? [s.exits[0]] : [])));
  lotBuilder.plantTrees();
  const buildings = lo.lots.filter((l) => l.building).map((l) => l.building!);
  const serviceLots = new Set(places.services.map((p) => p.lot));
  // Parking stalls on lots turned into services/pads are dropped.
  const parking = [...lo.parking.filter((p) => p.lot === undefined || !serviceLots.has(p.lot)), ...curbSpots(segs, nodes)];
  // A landlocked map ends in cliffs all round: solid rock over the margin.
  if (WORLD.edge === 'cliffs') {
    const M = MAP_SIZE, a = LAND0, b = LAND1, rock = '#8a6a4f', h = 26;
    for (const rect of [{ x0: 0, y0: 0, x1: M, y1: a }, { x0: 0, y0: b, x1: M, y1: M }, { x0: 0, y0: a, x1: a, y1: b }, { x0: b, y0: a, x1: M, y1: b }]) {
      lo.obstacles.push({ rect, h, color: rock, kind: 'rock' });
    }
  }
  const city: City = {
    seed, xs: layout.xs, ys: layout.ys, riverRow: layout.riverRow, ponds: lo.ponds, edge: WORLD.edge,
    cellZone: layout.cellZone, cellDistrict: layout.cellDistrict, cellBlock,
    nodes, segs, blocks: lo.blocks, lots: lo.lots, buildings, obstacles: lo.obstacles, rocks: lo.rocks, fixtures: lo.fixtures, trees: lo.trees,
    parking, services: places.services, properties: places.properties, bridges, interiors: [], ways, tables: [],
    ...(railway ? { railway } : {}),
  };
  // Walk-in ground floors; their places do business at the counter inside.
  city.interiors = interiorsOf(city);
  for (const i of city.interiors) i.place.counter = { x: i.counter.x, y: i.counter.y };
  const map = new CityMap(city);
  // The ground's height in open country (world/terrain.ts), when the universe has hills: nothing
  // left standing on a cliff face or in a river.
  const terrain = buildTerrain(city, map);
  if (terrain) { city.terrain = terrain; clearLand(city, terrain); }
  for (const p of city.parking) if (p.zone < 0) p.zone = map.zoneAt(p.x, p.y);
  // Card and casino tables (world/tables.ts): the floors laid out for them, gangs' back rooms, friends' yards.
  placeTables(city, (x, y) => map.districtAt(x, y));
  return city;
}

function lowerIndex(lines: { pos: number }[], v: number): number {
  let lo = 0, hi = lines.length - 1;
  if (v < lines[0].pos || v >= lines[hi].pos) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].pos <= v) lo = mid; else hi = mid;
  }
  return lo;
}

/** Read-only spatial queries over a generated city. */
export class CityMap {
  readonly nx: number;
  readonly ny: number;
  /** The river between its banks (null: no river). */
  readonly river: Rect | null;

  constructor(readonly city: City) {
    this.nx = city.xs.length - 1;
    this.ny = city.ys.length - 1;
    const r = city.riverRow;
    this.river = r < 0 ? null : { x0: 0, x1: MAP_SIZE * 2, y0: city.ys[r].pos + city.ys[r].width / 2, y1: city.ys[r + 1].pos - city.ys[r + 1].width / 2 };
  }

  cellAt(x: number, y: number): number {
    if (x >= LEVEL_BAND) return -1; // an upper floor (world/levels.ts): indoors, no street cell
    const i = lowerIndex(this.city.xs, x), j = lowerIndex(this.city.ys, y);
    return i < 0 || j < 0 ? -1 : j * this.nx + i;
  }

  zoneAt(x: number, y: number): number {
    const c = this.cellAt(x, y);
    if (c < 0) return -1;
    const z = this.city.cellZone[c];
    if (z >= 0) return z;
    // River cells: borrow the zone of the cell above.
    return c - this.nx >= 0 ? this.city.cellZone[c - this.nx] : -1;
  }

  districtAt(x: number, y: number): number {
    const c = this.cellAt(x, y);
    return c < 0 ? -1 : this.city.cellDistrict[c];
  }

  blockAt(x: number, y: number): Block | null {
    const c = this.cellAt(x, y);
    if (c < 0) return null;
    const bi = this.city.cellBlock[c];
    if (bi < 0) return null;
    const b = this.city.blocks[bi];
    const r = b.rect;
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 ? b : null;
  }

  isWater(x: number, y: number): boolean {
    if (x >= LEVEL_BAND) return false; // an upper floor: dry
    if (x < LAND0 || x > LAND1 || y < LAND0 || y > LAND1) return this.city.edge === 'sea';
    const r = this.river;
    if (r && y > r.y0 && y < r.y1) {
      for (const b of this.city.bridges) if (x >= b.x0 && x <= b.x1) return false;
      return true;
    }
    for (const p of this.city.ponds) if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1) return true;
    // A river down a gorge's floor (world/terrain.ts).
    return !!this.city.terrain && groundOf(this.city.terrain, x, y).water;
  }

  /** True when (x,y) lies on a road surface (not sidewalk/lot). */
  onRoad(x: number, y: number): boolean {
    if (this.isWater(x, y)) return false;
    const c = this.cellAt(x, y);
    if (c < 0) return true;
    return this.blockAt(x, y) === null;
  }

  /** Nearest street junction to a point (on a way's strip or an upper floor, to the point over the
   *  map: world/levels.ts). */
  nearestNode(x: number, y: number): RoadNode {
    x -= floorOf(x) * LEVEL_BAND;
    let best = this.city.nodes[0], bd = Infinity;
    const i = Math.max(0, lowerIndex(this.city.xs, x)), j = Math.max(0, lowerIndex(this.city.ys, y));
    for (const n of this.city.nodes) {
      if (Math.abs(n.i - i) > 3 || Math.abs(n.j - j) > 3) continue;
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    if (bd === Infinity) {
      for (const n of this.city.nodes) {
        const d = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** Nearest road segment and the distance along it, for snapping vehicles onto the network. */
  nearestSegment(x: number, y: number): { seg: Segment; t: number; d: number } {
    let best = this.city.segs[0], bt = 0, bd = Infinity;
    x -= floorOf(x) * LEVEL_BAND;
    const near = new Set<number>();
    const n = this.nearestNode(x, y);
    for (const s of n.segs) {
      near.add(s);
      const s2 = this.city.segs[s];
      for (const o of this.city.nodes[s2.a === n.id ? s2.b : s2.a].segs) near.add(o);
    }
    for (const si of near) {
      const s = this.city.segs[si];
      const len = s.axis === 'h' ? s.x1 - s.x0 : s.y1 - s.y0;
      const along = s.axis === 'h' ? x - s.x0 : y - s.y0;
      const t = Math.max(0, Math.min(len, along));
      const px = s.axis === 'h' ? s.x0 + t : s.x0, py = s.axis === 'h' ? s.y0 : s.y0 + t;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = s; bt = t; }
    }
    return { seg: best, t: bt, d: Math.sqrt(bd) };
  }
}
