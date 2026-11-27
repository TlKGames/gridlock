// A* over the road node graph, plus lane geometry helpers.
import { LANE_W, type RoadNode, type Segment } from '../../../shared/world/cityTypes';
import type { World } from '../world';

export interface LanePoints {
  sx: number; sy: number;   // lane start (just past the intersection we leave)
  ex: number; ey: number;   // lane end (just before the intersection we enter)
  hx: number; hy: number;   // heading
  to: RoadNode;
}

export function laneOf(w: World, seg: Segment, dir: 1 | -1, lane: number): LanePoints {
  const A = w.city.nodes[seg.a], B = w.city.nodes[seg.b];
  const from = dir === 1 ? A : B, to = dir === 1 ? B : A;
  const hx = seg.axis === 'h' ? dir : 0, hy = seg.axis === 'v' ? dir : 0;
  const rx = -hy, ry = hx;
  const off = (Math.min(lane, seg.lanes - 1) + 0.5) * LANE_W;
  const halfFrom = (seg.axis === 'h' ? from.wv : from.wh) / 2 + 1;
  const halfTo = (seg.axis === 'h' ? to.wv : to.wh) / 2 + (to.lights ? 3.6 : 1.5);
  return {
    sx: from.x + hx * halfFrom + rx * off, sy: from.y + hy * halfFrom + ry * off,
    ex: to.x - hx * halfTo + rx * off, ey: to.y - hy * halfTo + ry * off,
    hx, hy, to,
  };
}

/** Segment joining adjacent nodes a and b. */
export function segBetween(w: World, a: number, b: number): Segment | null {
  for (const s of w.city.nodes[a].segs) {
    const seg = w.city.segs[s];
    if ((seg.a === a && seg.b === b) || (seg.a === b && seg.b === a)) return seg;
  }
  return null;
}

export function findRoute(w: World, from: number, to: number): number[] {
  if (from === to) return [to];
  const nodes = w.city.nodes;
  const n = nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: number[] = [from];
  const goal = nodes[to];
  const h = (i: number) => Math.abs(nodes[i].x - goal.x) + Math.abs(nodes[i].y - goal.y);
  const f = new Float64Array(n).fill(Infinity);
  g[from] = 0;
  f[from] = h(from);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === to) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    for (const si of nodes[cur].segs) {
      const s = w.city.segs[si];
      const nb = s.a === cur ? s.b : s.a;
      if (closed[nb]) continue;
      const cost = g[cur] + Math.abs(s.x1 - s.x0) + Math.abs(s.y1 - s.y0);
      if (cost < g[nb]) {
        g[nb] = cost;
        f[nb] = cost + h(nb);
        prev[nb] = cur;
        open.push(nb);
      }
    }
  }
  if (prev[to] < 0) return [];
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}

export { isGreen } from '../../../shared/world/traffic';
