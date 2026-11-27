// Blocks -> lots -> buildings, trees, obstacles and parking spots.
import { insetRect, type Rect, rectH, rectW } from '../math';
import { ZONES, type ZoneSpec } from '../packs';
import type { Rng } from '../rng';
import { type Block, type Building, Dir, type Fixture, type Lot, type Obstacle, type ParkSpot, type Rock, SIDEWALK_W, type Tree } from './cityTypes';
import { wildFixtures } from './fixtures';
import { landforms } from './landforms';
import type { RoadLayout } from './roadgen';

export interface LotOutput {
  blocks: Block[];
  lots: Lot[];
  buildings: Building[];
  trees: Tree[];
  obstacles: Obstacle[];
  rocks: Rock[];
  fixtures: Fixture[];
  parking: ParkSpot[];
  ponds: Rect[];
}

const CONTAINER_COLORS = ['#a8432f', '#2f6a8a', '#8a7a2f', '#3f7a4a', '#7a3f6a', '#c06a2a', '#5a6a7a'];
const HALF_PI = Math.PI / 2;

function splitRect(r: Rect, min: number, max: number, rng: Rng, out: Rect[]): void {
  const w = rectW(r), h = rectH(r);
  if (w <= max && h <= max) { out.push(r); return; }
  const alongX = w >= h;
  const len = alongX ? w : h;
  if (len < min * 2) { out.push(r); return; }
  const t = Math.min(Math.max(rng.range(0.38, 0.62), min / len), 1 - min / len);
  if (alongX) {
    const c = r.x0 + w * t;
    splitRect({ ...r, x1: c }, min, max, rng, out);
    splitRect({ ...r, x0: c }, min, max, rng, out);
  } else {
    const c = r.y0 + h * t;
    splitRect({ ...r, y1: c }, min, max, rng, out);
    splitRect({ ...r, y0: c }, min, max, rng, out);
  }
}

function touchingSides(r: Rect, area: Rect): Dir[] {
  const e = 0.05, s: Dir[] = [];
  if (r.y0 - area.y0 < e) s.push(Dir.N);
  if (area.x1 - r.x1 < e) s.push(Dir.E);
  if (area.y1 - r.y1 < e) s.push(Dir.S);
  if (r.x0 - area.x0 < e) s.push(Dir.W);
  return s;
}

export class LotBuilder {
  readonly out: LotOutput = { blocks: [], lots: [], buildings: [], trees: [], obstacles: [], rocks: [], fixtures: [], parking: [], ponds: [] };

  /** A fixture's footprint on a lot (world/fixtures.ts): trees keep clear of it. */
  keepClear(lot: number, r: Rect): void {
    const c = this.wildClear.get(lot) ?? [];
    c.push(r);
    this.wildClear.set(lot, c);
  }

  /** `seed`: the world's, for the height map rock stands on (world/relief.ts). */
  constructor(private rng: Rng, private seed: number) {}

  build(L: RoadLayout): LotOutput {
    const { xs, ys, clusters } = L;
    const nx = xs.length - 1;
    const corridor = (l: { rail?: boolean }) => !!l.rail;
    clusters.forEach((c) => {
      const zi = L.cellZone[c.j0 * nx + c.i0];
      const rect: Rect = {
        x0: xs[c.i0].pos + xs[c.i0].width / 2, x1: xs[c.i1 + 1].pos - xs[c.i1 + 1].width / 2,
        y0: ys[c.j0].pos + ys[c.j0].width / 2, y1: ys[c.j1 + 1].pos - ys[c.j1 + 1].width / 2,
      };
      const block: Block = { id: this.out.blocks.length, rect, zone: zi, district: L.cellDistrict[c.j0 * nx + c.i0], lots: [] };
      // Sides backing onto a corridor (world/corridors.ts): no street there, so no sidewalk and no fronts.
      this.backs = new Set<Dir>([
        ...(corridor(ys[c.j0]) ? [Dir.N] : []), ...(corridor(xs[c.i1 + 1]) ? [Dir.E] : []),
        ...(corridor(ys[c.j1 + 1]) ? [Dir.S] : []), ...(corridor(xs[c.i0]) ? [Dir.W] : []),
      ] as Dir[]);
      this.out.blocks.push(block);
      this.fillBlock(block, ZONES[zi]);
    });
    this.backs = new Set();
    return this.out;
  }

  /** The block being filled: its sides that back onto a corridor. */
  private backs = new Set<Dir>();

  /** Trees go in last so they can avoid buildings and service pads. */
  plantTrees(): void {
    for (const lot of this.out.lots) {
      if (lot.use !== 'park' && lot.use !== 'plaza' && lot.use !== 'yard' && lot.use !== 'wild') continue;
      this.scatterTrees(lot, ZONES[lot.zone].trees * (lot.use === 'plaza' ? 0.5 : 1));
    }
  }

  /** Open country: one lot of ground with rock formations (solid, a few overlapping boxes: buttes
   *  and outcrops) and ponds, clear of the trails round it. */
  private wild(block: Block, z: ZoneSpec): void {
    const lot = this.addLot(block, block.rect, 'wild', -1);
    const spec = z.wild;
    if (!spec) return;
    const clear: Rect[] = [];
    this.wildClear.set(lot.id, clear);
    const area = insetRect(block.rect, 10);
    const w = rectW(area), h = rectH(area);
    if (w < 20 || h < 20) return;
    const per = (w * h) / 10_000;
    const fits = (r: Rect) => r.x0 >= area.x0 && r.x1 <= area.x1 && r.y0 >= area.y0 && r.y1 <= area.y1
      && !clear.some((c) => r.x0 < c.x1 + 6 && r.x1 > c.x0 - 6 && r.y0 < c.y1 + 6 && r.y1 > c.y0 - 6);
    const nPonds = Math.floor(per * spec.ponds + this.rng.next());
    for (let k = 0; k < nPonds; k++) {
      const pw = this.rng.range(spec.pondSize[0], spec.pondSize[1]), ph = this.rng.range(spec.pondSize[0], spec.pondSize[1]);
      const x = this.rng.range(area.x0, area.x1 - pw), y = this.rng.range(area.y0, area.y1 - ph);
      const r = { x0: x, y0: y, x1: x + pw, y1: y + ph };
      if (!fits(r)) continue;
      clear.push(r);
      this.out.ponds.push(r);
    }
    // Buttes, mesas, outcrops and boulders: round rock, on the high ground (world/landforms.ts).
    landforms(this.rng, this.seed, area, spec, fits, clear, this.out.rocks);
    // Cacti, skulls, lone windmills... (world/fixtures.ts).
    wildFixtures(this.rng, block.zone, area, fits, clear, this.out.fixtures);
  }

  /** Open-country features trees keep clear of, by lot. */
  private wildClear = new Map<number, Rect[]>();

  private fillBlock(block: Block, z: ZoneSpec): void {
    if (z.layout === 'wild') { this.wild(block, z); return; }
    // A sidewalk along the streets; none against a corridor's wall.
    const b = this.backs, r = block.rect, s = SIDEWALK_W;
    const area: Rect = { x0: r.x0 + (b.has(Dir.W) ? 0 : s), x1: r.x1 - (b.has(Dir.E) ? 0 : s), y0: r.y0 + (b.has(Dir.N) ? 0 : s), y1: r.y1 - (b.has(Dir.S) ? 0 : s) };
    if (rectW(area) < 8 || rectH(area) < 8) return;
    switch (z.layout) {
      case 'park': this.addLot(block, area, 'park', -1); break;
      case 'houses': this.houses(block, area, z); break;
      case 'compound': this.compound(block, area, z); break;
      default: {
        const rects: Rect[] = [];
        splitRect(area, z.lot.min, z.lot.max, this.rng, rects);
        for (const r of rects) this.genericLot(block, r, area, z);
      }
    }
  }

  private addLot(block: Block, rect: Rect, use: Lot['use'], front: Dir | -1): Lot {
    const lot: Lot = { id: this.out.lots.length, rect, block: block.id, zone: block.zone, use, front };
    this.out.lots.push(lot);
    block.lots.push(lot.id);
    if (use === 'parking') this.stalls(lot);
    return lot;
  }

  private genericLot(block: Block, r: Rect, area: Rect, z: ZoneSpec): void {
    const sides = touchingSides(r, area).filter((d) => !this.backs.has(d));
    const front: Dir | -1 = sides.length ? this.rng.pick(sides) : -1;
    if (z.layout === 'docks' && this.rng.chance(0.5)) {
      const lot = this.addLot(block, r, 'containers', front);
      this.containers(lot);
      return;
    }
    const roll = this.rng.next();
    if (roll < z.parkingChance) { this.addLot(block, r, 'parking', front); return; }
    if (roll < z.parkingChance + z.plazaChance) { this.addLot(block, r, 'plaza', front); return; }
    const s = this.rng.range(z.lot.setback[0], z.lot.setback[1]);
    const b = insetRect(r, Math.max(1, s));
    if (rectW(b) < 6 || rectH(b) < 6) { this.addLot(block, r, 'plaza', front); return; }
    const lot = this.addLot(block, r, 'building', front);
    const h = this.rng.range(z.lot.height[0], z.lot.height[1]);
    const kind: Building['kind'] = z.layout === 'docks' || z.warehouses ? 'warehouse' : h > 21 ? 'tower' : 'block';
    this.addBuilding(lot, b, h, z, kind);
  }

  addBuilding(lot: Lot, rect: Rect, h: number, z: ZoneSpec, kind: Building['kind']): Building {
    const b: Building = { rect, h, wall: this.rng.pick(z.wall), roof: this.rng.pick(z.roof), kind, windows: z.windows, lot: lot.id };
    lot.building = b;
    this.out.buildings.push(b);
    return b;
  }

  private houses(block: Block, area: Rect, z: ZoneSpec): void {
    const w = rectW(area), h = rectH(area);
    const alongX = w >= h;
    const depth = alongX ? h : w;
    const rows: { r: Rect; front: Dir }[] = [];
    // Against a corridor: one row, facing the street, its back yards to the wall.
    const [f0, f1] = alongX ? [Dir.N, Dir.S] : [Dir.W, Dir.E];
    if (this.backs.has(f0) || this.backs.has(f1)) {
      rows.push({ r: area, front: this.backs.has(f0) ? f1 : f0 });
    } else if (depth >= z.lot.min * 2) {
      const mid = alongX ? (area.y0 + area.y1) / 2 : (area.x0 + area.x1) / 2;
      if (alongX) rows.push({ r: { ...area, y1: mid }, front: Dir.N }, { r: { ...area, y0: mid }, front: Dir.S });
      else rows.push({ r: { ...area, x1: mid }, front: Dir.W }, { r: { ...area, x0: mid }, front: Dir.E });
    } else {
      rows.push({ r: area, front: alongX ? Dir.N : Dir.W });
    }
    for (const row of rows) {
      const len = alongX ? rectW(row.r) : rectH(row.r);
      let p = 0;
      while (len - p >= z.lot.min) {
        let size = this.rng.range(z.lot.min, z.lot.max);
        if (len - p - size < z.lot.min) size = len - p;
        const r: Rect = alongX
          ? { x0: row.r.x0 + p, x1: row.r.x0 + p + size, y0: row.r.y0, y1: row.r.y1 }
          : { x0: row.r.x0, x1: row.r.x1, y0: row.r.y0 + p, y1: row.r.y0 + p + size };
        p += size;
        this.house(block, r, row.front, z);
      }
    }
  }

  private house(block: Block, r: Rect, front: Dir, z: ZoneSpec): void {
    const lot = this.addLot(block, r, 'yard', front);
    const fs = this.rng.range(z.lot.setback[0], z.lot.setback[1]) + 3;
    const side = 2.5, back = 3;
    const b = { ...r };
    b.x0 += front === Dir.W ? fs : front === Dir.E ? back : side;
    b.x1 -= front === Dir.E ? fs : front === Dir.W ? back : side;
    b.y0 += front === Dir.N ? fs : front === Dir.S ? back : side;
    b.y1 -= front === Dir.S ? fs : front === Dir.N ? back : side;
    // Houses are at most ~13 m deep; the rest of the lot is backyard.
    const maxDepth = this.rng.range(10, 13.5);
    if (front === Dir.N) b.y1 = Math.min(b.y1, b.y0 + maxDepth);
    if (front === Dir.S) b.y0 = Math.max(b.y0, b.y1 - maxDepth);
    if (front === Dir.W) b.x1 = Math.min(b.x1, b.x0 + maxDepth);
    if (front === Dir.E) b.x0 = Math.max(b.x0, b.x1 - maxDepth);
    // A house narrower than its plot sits somewhere along it, the rest open ground.
    if (z.lot.width) {
      const along = front === Dir.N || front === Dir.S;
      const span = along ? rectW(b) : rectH(b), want = this.rng.range(z.lot.width[0], z.lot.width[1]);
      if (span > want) {
        const off = this.rng.range(0, span - want);
        if (along) { b.x0 += off; b.x1 = b.x0 + want; } else { b.y0 += off; b.y1 = b.y0 + want; }
      }
    }
    if (rectW(b) < 6 || rectH(b) < 6) return;
    this.addBuilding(lot, b, this.rng.range(z.lot.height[0], z.lot.height[1]), z, 'house');
    if (this.rng.chance(0.6)) {
      // Driveway parking spot in the front yard, facing the house.
      const angle = [HALF_PI, Math.PI, -HALF_PI, 0][front];
      const cx = front === Dir.N || front === Dir.S ? b.x0 + 2 : front === Dir.E ? (b.x1 + r.x1) / 2 : (r.x0 + b.x0) / 2;
      const cy = front === Dir.E || front === Dir.W ? b.y0 + 2 : front === Dir.S ? (b.y1 + r.y1) / 2 : (r.y0 + b.y0) / 2;
      this.out.parking.push({ x: cx, y: cy, angle, zone: block.zone, lot: lot.id });
    }
  }

  private compound(block: Block, area: Rect, z: ZoneSpec): void {
    const gate = 12, t = 0.6, fh = z.perimeter?.h ?? 3, fc = z.perimeter?.color ?? '#8a8f80';
    const midX = (area.x0 + area.x1) / 2, midY = (area.y0 + area.y1) / 2;
    const fence = (rect: Rect) => this.out.obstacles.push({ rect, h: fh, color: fc, kind: 'fence' });
    fence({ x0: area.x0, x1: midX - gate / 2, y0: area.y0, y1: area.y0 + t });
    fence({ x0: midX + gate / 2, x1: area.x1, y0: area.y0, y1: area.y0 + t });
    fence({ x0: area.x0, x1: midX - gate / 2, y0: area.y1 - t, y1: area.y1 });
    fence({ x0: midX + gate / 2, x1: area.x1, y0: area.y1 - t, y1: area.y1 });
    fence({ x0: area.x0, x1: area.x0 + t, y0: area.y0, y1: midY - gate / 2 });
    fence({ x0: area.x0, x1: area.x0 + t, y0: midY + gate / 2, y1: area.y1 });
    fence({ x0: area.x1 - t, x1: area.x1, y0: area.y0, y1: midY - gate / 2 });
    fence({ x0: area.x1 - t, x1: area.x1, y0: midY + gate / 2, y1: area.y1 });
    const inner = insetRect(area, 6);
    const rects: Rect[] = [];
    splitRect(inner, z.lot.min, z.lot.max, this.rng, rects);
    rects.forEach((r, k) => {
      if (k % 3 === 1) { this.addLot(block, r, 'pad', -1); return; }
      if (k % 3 === 2) { this.addLot(block, r, 'parking', -1); return; }
      const lot = this.addLot(block, r, 'building', -1);
      const b = insetRect(r, this.rng.range(z.lot.setback[0], z.lot.setback[1]));
      if (rectW(b) > 8 && rectH(b) > 8) this.addBuilding(lot, b, this.rng.range(z.lot.height[0], z.lot.height[1]), z, z.compoundKind ?? 'hangar');
      else lot.use = 'pad';
    });
  }

  private containers(lot: Lot): void {
    const r = insetRect(lot.rect, 3);
    const alongX = rectW(r) >= rectH(r);
    const cl = 6.1, cw = 2.5, gapRow = 4;
    const rowsN = Math.floor(((alongX ? rectH(r) : rectW(r)) + gapRow) / (cw * 2 + gapRow));
    const perRow = Math.floor((alongX ? rectW(r) : rectH(r)) / (cl + 0.4));
    for (let row = 0; row < rowsN; row++) {
      for (let k = 0; k < perRow; k++) {
        if (this.rng.chance(0.18)) continue;
        for (let side = 0; side < 2; side++) {
          const a = k * (cl + 0.4);
          const b2 = row * (cw * 2 + gapRow) + side * cw;
          const rect: Rect = alongX
            ? { x0: r.x0 + a, x1: r.x0 + a + cl, y0: r.y0 + b2, y1: r.y0 + b2 + cw }
            : { x0: r.x0 + b2, x1: r.x0 + b2 + cw, y0: r.y0 + a, y1: r.y0 + a + cl };
          const stack = this.rng.chance(0.4) ? 2 : 1;
          this.out.obstacles.push({ rect, h: 2.6 * stack, color: this.rng.pick(CONTAINER_COLORS), kind: 'container' });
        }
      }
    }
  }

  private stalls(lot: Lot): void {
    const r = insetRect(lot.rect, 1.5);
    const alongX = rectW(r) >= rectH(r);
    const depth = 5.4, pitch = 2.9;
    const len = alongX ? rectW(r) : rectH(r);
    const across = alongX ? rectH(r) : rectW(r);
    if (across < depth * 2 + 5) return;
    const n = Math.floor(len / pitch);
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) * pitch;
      for (let side = 0; side < 2; side++) {
        const off = side === 0 ? depth / 2 : across - depth / 2;
        const x = alongX ? r.x0 + a : r.x0 + off;
        const y = alongX ? r.y0 + off : r.y0 + a;
        const angle = alongX ? (side === 0 ? -HALF_PI : HALF_PI) : side === 0 ? Math.PI : 0;
        this.out.parking.push({ x, y, angle, zone: lot.zone, lot: lot.id });
      }
    }
  }

  private scatterTrees(lot: Lot, perThousand: number): void {
    const r = insetRect(lot.rect, 1.5);
    const area = Math.max(0, rectW(r) * rectH(r));
    const count = Math.floor((area / 1000) * perThousand + this.rng.next());
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    for (let k = 0; k < count; k++) {
      const x = this.rng.range(r.x0, r.x1), y = this.rng.range(r.y0, r.y1);
      // Keep the park's cross paths and the lot middle clear.
      if (lot.use === 'park' && (Math.abs(x - cx) < 4 || Math.abs(y - cy) < 4)) continue;
      if (this.wildClear.get(lot.id)?.some((c) => x > c.x0 - 2 && x < c.x1 + 2 && y > c.y0 - 2 && y < c.y1 + 2)) continue;
      const b = lot.building?.rect;
      if (b && x > b.x0 - 2.5 && x < b.x1 + 2.5 && y > b.y0 - 2.5 && y < b.y1 + 2.5) continue;
      if (lot.pad && Math.abs(x - lot.pad.x) < 6 && Math.abs(y - lot.pad.y) < 6) continue;
      this.out.trees.push({ x, y, r: this.rng.range(1.6, 3.2) });
    }
  }
}
