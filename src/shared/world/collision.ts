// Static collision world: axis-aligned boxes (buildings, containers, fences) and tree trunks,
// bucketed in a uniform grid. Used by server physics and client-side prediction alike.
import type { City } from './cityTypes';
import { LAND0, LAND1, MAP_SIZE } from './cityTypes';
import { FIXTURES } from '../packs';
import { fixtureRect, ringSides } from './fixtures';
import { FLAT_PROPS } from './interiors';
import { gangSpots } from './gangSpots';
import { WORLD_X } from './levels';
import { KIND, massesFor } from './massing';
import { wayCollision } from './ways';
import { type Box2, type Hit, type RayHit, obbVsAabb, obbVsCircle, rayAabb, rayCircle } from './shapes';
import { cliff, grade, groundZ, type Terrain, terrainHit } from './terrain';

/** `gate` on a Box2: a box that can open (a vault door: its interior's index); open gates are passed through. */
export { type Box2, type Hit, type RayHit, obbVsAabb, obbVsCircle, rayAabb, rayCircle } from './shapes';
export interface Circle2 { x: number; y: number; r: number; h: number }

const CELL = 24;
// The grid covers the map and, east of it, the strips upper floors live in (world/levels.ts).
const NX = Math.ceil(WORLD_X / CELL);
const N = Math.ceil(MAP_SIZE / CELL);
const TRUNK_R = 0.45;
/** How far past the map's edge a boat can go out to sea (the map has ~80 m of sea all round). */
const SEA_MARGIN = 0;

export class StaticWorld {
  readonly boxes: Box2[] = [];
  readonly circles: Circle2[] = [];
  /** Gates standing open right now (interior indexes): the server sets them, clients mirror it. */
  readonly openGates = new Set<number>();
  private boxCells: number[][] = Array.from({ length: NX * N }, () => []);
  private circleCells: number[][] = Array.from({ length: NX * N }, () => []);
  private stamp: Uint32Array;
  private stampC: Uint32Array;
  private q = 1;
  /** The ground's height (world/terrain.ts); absent in a flat world. */
  readonly terrain: Terrain | undefined;

  constructor(city: City) {
    this.terrain = city.terrain;
    const r = city.riverRow;
    if (r >= 0) {
      this.riverY0 = city.ys[r].pos + city.ys[r].width / 2;
      this.riverY1 = city.ys[r + 1].pos - city.ys[r + 1].width / 2;
    }
    this.sea = city.edge === 'sea';
    this.ponds = city.ponds;
    // Walk-in buildings: their room's walls (with the door gap), furniture and the solid rest,
    // instead of one solid box.
    const open = new Set(city.interiors.map((i) => i.building));
    city.buildings.forEach((b, bi) => { if (!open.has(bi)) this.addBox({ ...b.rect, h: b.h }); });
    city.interiors.forEach((i, k) => {
      for (const w of [...i.walls, ...i.rest]) this.addBox({ ...w.rect, h: w.h });
      for (const p of i.props) if (!FLAT_PROPS.has(p.kind)) this.addBox({ ...p.rect, h: p.h });
      if (i.vault) this.addBox({ ...i.vault.door, h: 3.2, gate: k });
      // Upper floors, out in their strips east of the map (world/levels.ts).
      for (const fl of i.floors) {
        for (const w of fl.walls) this.addBox({ ...w.rect, h: w.h });
        for (const p of fl.props) if (!FLAT_PROPS.has(p.kind)) this.addBox({ ...p.rect, h: p.h });
      }
    });
    for (const o of city.obstacles) this.addBox({ ...o.rect, h: o.h });
    // A friend's card table out in the yard (world/tables.ts; tables indoors are their room's props).
    for (const t of city.tables) if (t.yard) this.addBox({ ...t.rect, h: 0.8 });
    // Payphone booths are solid (they don't get knocked over): the booth's body, square to the kerb,
    // from its back panel to just in front of the phone (render/booths.ts draws it).
    for (const b of gangSpots(city).booths) {
      const c = Math.round(Math.cos(b.angle)), s = Math.round(Math.sin(b.angle));
      const cx = b.x + c * 0.125, cy = b.y + s * 0.125, hx = c ? 0.28 : 0.47, hy = c ? 0.47 : 0.28;
      this.addBox({ x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, h: 2.5 });
    }
    for (const t of city.trees) this.addCircle({ x: t.x, y: t.y, r: TRUNK_R, h: 7 });
    // Open country's rock: round columns, boulders (world/landforms.ts).
    for (const r of city.rocks) this.addCircle({ x: r.x, y: r.y, r: r.r, h: r.h });
    // Fixtures (world/fixtures.ts): a footprint, a trunk, or a corral's rails with its gate open.
    for (const f of city.fixtures) {
      const spec = FIXTURES[f.spec], h = spec.height;
      if (spec.solid === 'box') this.addBox({ ...fixtureRect(f), h });
      else if (spec.solid === 'ring') for (const s of ringSides(f)) this.addBox({ ...s, h: Math.min(h, 1.6) });
      else if (typeof spec.solid === 'number') this.addCircle({ x: f.x, y: f.y, r: spec.solid, h });
    }
    // An elevated railway (world/ways.ts): its columns and stair towers on the street.
    const ways = wayCollision(city, (x, y) => this.boatWater(x, y));
    for (const b of ways.boxes) this.addBox(b);
    for (const c of ways.circles) this.addCircle(c);
    this.stamp = new Uint32Array(this.boxes.length);
    this.stampC = new Uint32Array(this.circles.length);
    // Roofs, by the blocks each building is drawn as (world/massing.ts: a tower's podium and shaft
    // are separate roofs). Walk-in buildings are walls round an open room, so their collision boxes
    // have no roof of their own. What a helicopter can set down on.
    city.buildings.forEach((b, bi) => {
      for (const m of massesFor(b, city.seed, bi)) {
        // A house's pitched roof: it sits on the ridge, half a metre or so above the eaves.
        const id = this.roofs.push({ ...m.r, h: m.h + (m.kind === KIND.house ? 0.8 : 0), bi }) - 1;
        const [i0, j0, i1, j1] = StaticWorld.cellRange(m.r.x0, m.r.y0, m.r.x1, m.r.y1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.roofCells[j * N + i].push(id);
      }
    });
  }

  /** The river's banks (y; none: 0, 0), whether sea lies round the land, the ponds: set in the
   *  constructor. */
  private riverY0 = 0;
  private riverY1 = 0;
  private sea = true;
  private ponds: { x0: number; y0: number; x1: number; y1: number }[] = [];

  /** Water a boat can be on: the sea round the island, the whole river, under the bridges too (a
   *  boat goes under the deck: from above, the bridge hides it), and ponds. Upper-floor strips are dry. */
  boatWater(x: number, y: number): boolean {
    if (x >= MAP_SIZE || y >= MAP_SIZE || x < -SEA_MARGIN || y < -SEA_MARGIN) return false; // the edge of the world
    if (x < LAND0 || x > LAND1 || y < LAND0 || y > LAND1) return this.sea;
    if (y > this.riverY0 && y < this.riverY1) return true;
    return this.ponds.some((p) => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1);
  }

  /** The ground's height at a point, and its rise per metre heading along (dx, dy). */
  groundAt(x: number, y: number): number { return groundZ(this.terrain, x, y); }
  gradeAt(x: number, y: number, dx: number, dy: number): number { return grade(this.terrain, x, y, dx, dy); }
  /** Holds a body that moved from (px, py) back from a cliff (world/terrain.ts); the push-back normal. */
  cliff(b: { x: number; y: number }, px: number, py: number): { nx: number; ny: number } | null { return cliff(this.terrain, b, px, py); }

  private roofs: (Box2 & { bi: number })[] = [];
  private roofCells: number[][] = Array.from({ length: N * N }, () => []);

  /** Height of what's under a point on the street map: the highest roof whose footprint holds it at
   *  least `inset` metres in from the edge, else 0 (the street). Upper-floor strips have no roofs. */
  floorAt(x: number, y: number, inset = 0): number {
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return 0;
    let top = 0;
    for (const id of this.roofCells[Math.floor(y / CELL) * N + Math.floor(x / CELL)]) {
      const r = this.roofs[id];
      if (r.h > top && x >= r.x0 + inset && x <= r.x1 - inset && y >= r.y0 + inset && y <= r.y1 - inset) top = r.h;
    }
    return top;
  }

  /** The building (index) whose roof is under a point, if any (as floorAt). */
  roofAt(x: number, y: number, inset = 0): number {
    if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return -1;
    let best = -1, top = 0;
    for (const id of this.roofCells[Math.floor(y / CELL) * N + Math.floor(x / CELL)]) {
      const r = this.roofs[id];
      if (r.h > top && x >= r.x0 + inset && x <= r.x1 - inset && y >= r.y0 + inset && y <= r.y1 - inset) { top = r.h; best = r.bi; }
    }
    return best;
  }

  private static cellRange(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    const cx = (v: number) => Math.max(0, Math.min(NX - 1, Math.floor(v / CELL)));
    const cy = (v: number) => Math.max(0, Math.min(N - 1, Math.floor(v / CELL)));
    return [cx(x0), cy(y0), cx(x1), cy(y1)];
  }

  private addBox(b: Box2): void {
    const id = this.boxes.push(b) - 1;
    const [i0, j0, i1, j1] = StaticWorld.cellRange(b.x0, b.y0, b.x1, b.y1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.boxCells[j * NX + i].push(id);
  }

  private addCircle(c: Circle2): void {
    const id = this.circles.push(c) - 1;
    const [i0, j0, i1, j1] = StaticWorld.cellRange(c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.circleCells[j * NX + i].push(id);
  }

  /** Calls fn for each box/circle overlapping the query rect (each once). */
  near(x0: number, y0: number, x1: number, y1: number, box: (b: Box2) => void, circle?: (c: Circle2) => void): void {
    const q = ++this.q;
    const [i0, j0, i1, j1] = StaticWorld.cellRange(x0, y0, x1, y1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const id of this.boxCells[j * NX + i]) {
          if (this.stamp[id] === q) continue;
          this.stamp[id] = q;
          const b = this.boxes[id];
          if (b.gate !== undefined && this.openGates.has(b.gate)) continue; // an open vault door
          box(b);
        }
        if (!circle) continue;
        for (const id of this.circleCells[j * NX + i]) {
          if (this.stampC[id] === q) continue;
          this.stampC[id] = q;
          circle(this.circles[id]);
        }
      }
    }
  }

  /** Pushes a circle out of static geometry taller than z. Mutates p; returns the last hit or null. */
  resolveCircle(p: { x: number; y: number }, r: number, z = 0): Hit | null {
    let hit: Hit | null = null;
    this.near(p.x - r, p.y - r, p.x + r, p.y + r, (b) => {
      if (b.h <= z) return;
      const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cy = Math.max(b.y0, Math.min(p.y, b.y1));
      let dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        p.x += dx * (r - d); p.y += dy * (r - d);
        hit = { nx: dx, ny: dy, depth: r - d };
      } else {
        // Centre inside the box: exit through the nearest face.
        const l = p.x - b.x0, rr = b.x1 - p.x, t = p.y - b.y0, bt = b.y1 - p.y;
        const m = Math.min(l, rr, t, bt);
        if (m === l) { p.x = b.x0 - r; hit = { nx: -1, ny: 0, depth: m + r }; }
        else if (m === rr) { p.x = b.x1 + r; hit = { nx: 1, ny: 0, depth: m + r }; }
        else if (m === t) { p.y = b.y0 - r; hit = { nx: 0, ny: -1, depth: m + r }; }
        else { p.y = b.y1 + r; hit = { nx: 0, ny: 1, depth: m + r }; }
      }
    }, (c) => {
      if (c.h <= z) return;
      const dx = p.x - c.x, dy = p.y - c.y, rr = r + c.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 1e-9) return;
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (rr - d); p.y += (dy / d) * (rr - d);
      hit = { nx: dx / d, ny: dy / d, depth: rr - d };
    });
    return hit;
  }

  /**
   * Separates an oriented box (centre, angle, half extents) from static geometry.
   * Mutates o; returns the deepest contact normal (pointing away from the obstacle).
   */
  resolveObb(o: { x: number; y: number; angle: number }, hl: number, hw: number, z = 0): Hit | null {
    let worst: Hit | null = null;
    const c = Math.cos(o.angle), s = Math.sin(o.angle);
    const ex = Math.abs(c) * hl + Math.abs(s) * hw, ey = Math.abs(s) * hl + Math.abs(c) * hw;
    for (let pass = 0; pass < 2; pass++) {
      this.near(o.x - ex - 1, o.y - ey - 1, o.x + ex + 1, o.y + ey + 1, (b) => {
        if (b.h <= z) return;
        const h = obbVsAabb(o.x, o.y, c, s, hl, hw, b);
        if (!h) return;
        o.x += h.nx * h.depth; o.y += h.ny * h.depth;
        if (!worst || h.depth > worst.depth) worst = h;
      }, (ci) => {
        if (ci.h <= z) return;
        const h = obbVsCircle(o.x, o.y, c, s, hl, hw, ci);
        if (!h) return;
        o.x += h.nx * h.depth; o.y += h.ny * h.depth;
        if (!worst || h.depth > worst.depth) worst = h;
      });
    }
    return worst;
  }

  /** First static hit along a segment at height z above the ground at each end (t: the fraction
   *  along it): a box or circle taller than z, or a rise of ground between the ends. */
  raycast(x0: number, y0: number, x1: number, y1: number, z = 1.2): RayHit | null {
    const hit = this.raycastFlat(x0, y0, x1, y1, z);
    const g = terrainHit(this.terrain, x0, y0, x1, y1, z, hit ? hit.t : 1);
    if (g === null) return hit;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    return { t: g, nx: -(x1 - x0) / len, ny: -(y1 - y0) / len };
  }

  private raycastFlat(x0: number, y0: number, x1: number, y1: number, z: number): RayHit | null {
    const dx = x1 - x0, dy = y1 - y0;
    const out: { best: RayHit | null } = { best: null };
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / CELL));
    for (let k = 0; k < steps; k++) {
      const ta = k / steps, tb = (k + 1) / steps;
      if (out.best && out.best.t < ta) break;
      const ax = x0 + dx * ta, ay = y0 + dy * ta, bx = x0 + dx * tb, by = y0 + dy * tb;
      this.near(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), (b) => {
        if (b.h <= z) return;
        const h = rayAabb(x0, y0, dx, dy, b);
        if (h && (!out.best || h.t < out.best.t)) out.best = h;
      }, (c) => {
        if (c.h <= z) return;
        const h = rayCircle(x0, y0, dx, dy, c.x, c.y, c.r);
        if (h && (!out.best || h.t < out.best.t)) out.best = h;
      });
    }
    return out.best;
  }
}
