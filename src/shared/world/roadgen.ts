// Road network generation: road lines, districts per cell, merged blocks, river and bridges. The
// map's shape comes from the installed universe (worldSpec.ts). Open country (zones with layout
// 'wild') merges into big blocks between arterial lines, which run through it as trails.
import { clamp, type Rect } from '../math';
import { DISTRICTS, ZONES, zoneIndex } from '../packs';
import type { Rng } from '../rng';
import { LAND0, LAND1, LANE_W, MAP_SIZE, PARK_W, type RoadLine, type RoadNode, type Segment } from './cityTypes';
import { WORLD } from './worldSpec';
import { insertCorridors } from './corridors';

const MIN_GAP = 46;
/** A trail: one lane each way of packed dirt. */
const TRAIL_W = 2 * LANE_W + 1.2;

function makeLine(pos: number, arterial: boolean): RoadLine {
  return arterial
    ? { pos, arterial, lanes: 2, parking: false, width: 4 * LANE_W + 1.2 }
    : { pos, arterial, lanes: 1, parking: true, width: 2 * LANE_W + 2 * PARK_W + 0.4 };
}

function spacingAt(pos: number, rng: Rng): number {
  const t = clamp(Math.abs(pos - MAP_SIZE / 2) / (MAP_SIZE * 0.42), 0, 1);
  const { near, far } = WORLD.spacing;
  return (near + (far - near) * t) * rng.range(0.85, 1.18);
}

const isWild = (z: number) => z >= 0 && ZONES[z].layout === 'wild';

/** Generates road line positions along one axis; optionally inserts a river row. */
export function genLines(rng: Rng, riverAt: number | null): { lines: RoadLine[]; riverRow: number } {
  const pos: number[] = [LAND0 + 8];
  let riverRow = -1;
  for (;;) {
    const last = pos[pos.length - 1];
    let next = last + spacingAt(last, rng);
    if (riverAt !== null && riverRow < 0 && next >= riverAt - 40) {
      const start = Math.max(riverAt, last + MIN_GAP);
      riverRow = pos.length;
      pos.push(start, start + WORLD.river!.width);
      continue;
    }
    if (next > LAND1 - 8 - MIN_GAP) break;
    pos.push(next);
  }
  pos.push(LAND1 - 8);
  const n = pos.length;
  const lines = pos.map((p, i) => makeLine(p, i === 0 || i === n - 1 || i % WORLD.arterialEvery === 0));
  return { lines, riverRow };
}

export interface Cluster { i0: number; j0: number; i1: number; j1: number }

export interface RoadLayout {
  xs: RoadLine[];
  ys: RoadLine[];
  riverRow: number;
  cellZone: Int16Array;
  cellDistrict: Int16Array;
  clusters: Cluster[];
  cellCluster: Int32Array;
  bridgeLines: Set<number>;
}

export function genLayout(rng: Rng): RoadLayout {
  const { lines: xs } = genLines(rng, null);
  const g = genLines(rng, WORLD.river ? MAP_SIZE * WORLD.river.at : null);
  const ys = g.lines;
  // An elevated railway's corridor through the blocks (world/corridors.ts).
  const riverRow = insertCorridors(xs, ys, g.riverRow);
  const nx = xs.length - 1, ny = ys.length - 1;
  const cellZone = new Int16Array(nx * ny);
  const cellDistrict = new Int16Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (j === riverRow) { cellZone[k] = -1; cellDistrict[k] = -1; continue; }
      const u = (xs[i].pos + xs[i + 1].pos) / 2 / MAP_SIZE + (rng.next() - 0.5) * 0.045;
      const v = (ys[j].pos + ys[j + 1].pos) / 2 / MAP_SIZE + (rng.next() - 0.5) * 0.045;
      let best = 0, bestD = Infinity;
      DISTRICTS.forEach((d, di) => {
        const dx = u - d.x, dy = v - d.y;
        const dd = (dx * dx + dy * dy) / ((d.weight ?? 1) * (d.weight ?? 1));
        if (dd < bestD) { bestD = dd; best = di; }
      });
      cellDistrict[k] = best;
      cellZone[k] = zoneIndex(DISTRICTS[best].zone);
    }
  }

  const cellCluster = new Int32Array(nx * ny).fill(-1);
  const clusters: Cluster[] = [];
  const free = (i: number, j: number, z: number) =>
    i < nx && j < ny && j !== riverRow && cellCluster[j * nx + i] < 0 && cellZone[j * nx + i] === z;
  const claim = (c: Cluster) => {
    const id = clusters.push(c) - 1;
    for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) cellCluster[j * nx + i] = id;
  };
  // Merging may not cut an arterial or the river banks.
  const canCutV = (i: number) => !xs[i].arterial;
  const canCutH = (j: number) => !ys[j].arterial && j !== riverRow && j !== riverRow + 1;

  // Open country: as big a rectangle of one wild zone as fits between arterials (trails).
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const z = cellZone[j * nx + i];
      if (!isWild(z) || !free(i, j, z)) continue;
      let i1 = i;
      while (free(i1 + 1, j, z) && canCutV(i1 + 1)) i1++;
      let j1 = j;
      const rowFree = (jj: number) => { for (let ii = i; ii <= i1; ii++) if (!free(ii, jj, z)) return false; return true; };
      while (canCutH(j1 + 1) && rowFree(j1 + 1)) j1++;
      claim({ i0: i, j0: j, i1, j1 });
    }
  }
  const bigLayouts = new Set(['park', 'compound']);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const z = cellZone[j * nx + i];
      if (z < 0 || !free(i, j, z) || !bigLayouts.has(ZONES[z].layout)) continue;
      if (free(i + 1, j, z) && free(i, j + 1, z) && free(i + 1, j + 1, z) && canCutV(i + 1) && canCutH(j + 1)) {
        claim({ i0: i, j0: j, i1: i + 1, j1: j + 1 });
      }
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const z = cellZone[j * nx + i];
      if (z < 0 || !free(i, j, z)) continue;
      const drop = ZONES[z].roadDrop * (bigLayouts.has(ZONES[z].layout) ? 2 : 1);
      if (rng.chance(drop)) {
        const horiz = rng.chance(0.5);
        if (horiz && free(i + 1, j, z) && canCutV(i + 1)) { claim({ i0: i, j0: j, i1: i + 1, j1: j }); continue; }
        if (free(i, j + 1, z) && canCutH(j + 1)) { claim({ i0: i, j0: j, i1: i, j1: j + 1 }); continue; }
      }
      claim({ i0: i, j0: j, i1: i, j1: j });
    }
  }

  const bridgeLines = new Set<number>();
  xs.forEach((l, i) => { if (l.arterial) bridgeLines.add(i); });
  for (const i of [...bridgeLines]) {
    if (i !== 0 && i !== xs.length - 1 && bridgeLines.size > 4 && rng.chance(0.3)) bridgeLines.delete(i);
  }
  return { xs, ys, riverRow, cellZone, cellDistrict, clusters, cellCluster, bridgeLines };
}

/** Builds the segment/node graph from a layout. */
export function genGraph(L: RoadLayout): { nodes: RoadNode[]; segs: Segment[]; bridges: Rect[] } {
  const { xs, ys, riverRow, cellCluster } = L;
  const nx = xs.length - 1, ny = ys.length - 1;
  const clusterAt = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? -2 - i - j * 1000 : cellCluster[j * nx + i]);
  const nodeId = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const nodes: RoadNode[] = [];
  const segs: Segment[] = [];
  const bridges: Rect[] = [];

  const node = (i: number, j: number): RoadNode => {
    const k = j * (nx + 1) + i;
    if (nodeId[k] < 0) {
      nodeId[k] = nodes.length;
      nodes.push({ id: nodes.length, i, j, x: xs[i].pos, y: ys[j].pos, segs: [], lights: false, wv: xs[i].width, wh: ys[j].width });
    }
    return nodes[nodeId[k]];
  };
  const add = (axis: 'h' | 'v', a: RoadNode, b: RoadNode, line: RoadLine, bridge: boolean, trail = false) => {
    const s: Segment = { id: segs.length, axis, a: a.id, b: b.id, x0: a.x, y0: a.y, x1: b.x, y1: b.y,
      width: trail ? TRAIL_W : line.width, lanes: trail ? 1 : line.lanes, parking: line.parking && !bridge && !trail, bridge,
      ...(trail ? { trail } : {}) };
    segs.push(s);
    a.segs.push(s.id);
    b.segs.push(s.id);
  };
  // Open country: between two wild cells (or wild and the river or the map's edge) there's only a
  // road along an arterial line, and it's a trail.
  const zoneAt = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? -2 : L.cellZone[j * nx + i]);
  const open = (z: number) => z < 0 || isWild(z);
  const wildPair = (za: number, zb: number) => (isWild(za) || isWild(zb)) && open(za) && open(zb);

  // A railway's corridor (world/corridors.ts) has no street along it; the streets crossing it pass
  // under its viaduct.
  for (let j = 0; j <= ny; j++) {
    if (ys[j].rail) continue;
    for (let i = 0; i < nx; i++) {
      const above = clusterAt(i, j - 1), below = clusterAt(i, j);
      if (above === below && above >= 0) continue;
      const trail = wildPair(zoneAt(i, j - 1), zoneAt(i, j));
      if (trail && !ys[j].arterial) continue;
      add('h', node(i, j), node(i + 1, j), ys[j], false, trail);
    }
  }
  for (let i = 0; i <= nx; i++) {
    if (xs[i].rail) continue;
    for (let j = 0; j < ny; j++) {
      if (j === riverRow) {
        if (!L.bridgeLines.has(i)) continue;
        add('v', node(i, j), node(i, j + 1), xs[i], true, wildPair(zoneAt(i - 1, j - 1), zoneAt(i, j - 1)));
        bridges.push({ x0: xs[i].pos - xs[i].width / 2, x1: xs[i].pos + xs[i].width / 2,
          y0: ys[j].pos + ys[j].width / 2, y1: ys[j + 1].pos - ys[j + 1].width / 2 });
        continue;
      }
      const left = clusterAt(i - 1, j), right = clusterAt(i, j);
      if (left === right && left >= 0) continue;
      const trail = wildPair(zoneAt(i - 1, j), zoneAt(i, j));
      if (trail && !xs[i].arterial) continue;
      add('v', node(i, j), node(i, j + 1), xs[i], false, trail);
    }
  }
  for (const n of nodes) {
    n.lights = WORLD.modern && n.segs.length >= 3 && (xs[n.i].arterial || ys[n.j].arterial);
    // Where only trails meet, the crossing is trail-sized and has no lights.
    if (n.segs.every((s) => segs[s].trail)) { n.wv = Math.min(n.wv, TRAIL_W); n.wh = Math.min(n.wh, TRAIL_W); n.lights = false; }
  }
  return { nodes, segs, bridges };
}
