// Waypoint routing: A* over the city's road graph. You join the network at the nearest point on
// a road and leave it at the road nearest the waypoint, so the line follows streets end to end.
import type { City, Segment } from '../../shared/world/cityTypes';

export interface Pt { x: number; y: number }

export class Router {
  private adj: { to: number; cost: number; seg: number }[][];

  constructor(private city: City) {
    this.adj = city.nodes.map(() => []);
    for (const s of city.segs) {
      const a = city.nodes[s.a], b = city.nodes[s.b];
      const cost = Math.hypot(a.x - b.x, a.y - b.y);
      this.adj[s.a].push({ to: s.b, cost, seg: s.id });
      this.adj[s.b].push({ to: s.a, cost, seg: s.id });
    }
  }

  /** Nearest point on any street's centre line (you join and leave the route on the street). */
  private snap(x: number, y: number): { seg: Segment; p: Pt } {
    let best = this.city.segs[0], bp: Pt = { x, y }, bd = Infinity;
    for (const s of this.city.segs) {
      const px = Math.max(Math.min(s.x0, s.x1), Math.min(Math.max(s.x0, s.x1), x));
      const py = Math.max(Math.min(s.y0, s.y1), Math.min(Math.max(s.y0, s.y1), y));
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = s; bp = { x: px, y: py }; }
    }
    return { seg: best, p: bp };
  }

  /** Road route from → to as a polyline (empty if no route). */
  route(from: Pt, to: Pt): Pt[] {
    const nodes = this.city.nodes;
    const s = this.snap(from.x, from.y), e = this.snap(to.x, to.y);
    if (s.seg.id === e.seg.id) return [from, s.p, e.p, to];
    const goal = new Map<number, number>([[e.seg.a, dist(nodes[e.seg.a], e.p)], [e.seg.b, dist(nodes[e.seg.b], e.p)]]);
    const g = new Map<number, number>();
    const prev = new Map<number, number>();
    const open = new Heap();
    for (const n of [s.seg.a, s.seg.b]) {
      const c = dist(nodes[n], s.p);
      g.set(n, c);
      prev.set(n, -1);
      open.push(n, c + dist(nodes[n], e.p));
    }
    let end = -1, endCost = Infinity;
    while (open.size) {
      const [n, f] = open.pop();
      if (f >= endCost) break;
      const gn = g.get(n)!;
      const tail = goal.get(n);
      if (tail !== undefined && gn + tail < endCost) { endCost = gn + tail; end = n; }
      for (const { to: m, cost } of this.adj[n]) {
        const c = gn + cost;
        if (c >= (g.get(m) ?? Infinity)) continue;
        g.set(m, c);
        prev.set(m, n);
        open.push(m, c + dist(nodes[m], e.p));
      }
    }
    if (end < 0) return [];
    const path: Pt[] = [];
    for (let n = end; n >= 0; n = prev.get(n)!) path.push({ x: nodes[n].x, y: nodes[n].y });
    return [from, s.p, ...path.reverse(), e.p, to];
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Minimal binary heap of (id, priority). */
class Heap {
  private ids: number[] = [];
  private ps: number[] = [];
  get size(): number { return this.ids.length; }

  push(id: number, p: number): void {
    const { ids, ps } = this;
    ids.push(id); ps.push(p);
    for (let i = ids.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (ps[up] <= ps[i]) break;
      [ids[up], ids[i]] = [ids[i], ids[up]]; [ps[up], ps[i]] = [ps[i], ps[up]];
      i = up;
    }
  }

  pop(): [number, number] {
    const { ids, ps } = this;
    const top: [number, number] = [ids[0], ps[0]];
    const li = ids.pop()!, lp = ps.pop()!;
    if (ids.length) {
      ids[0] = li; ps[0] = lp;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < ids.length && ps[l] < ps[m]) m = l;
        if (r < ids.length && ps[r] < ps[m]) m = r;
        if (m === i) break;
        [ids[m], ids[i]] = [ids[i], ids[m]]; [ps[m], ps[i]] = [ps[i], ps[m]];
        i = m;
      }
    }
    return top;
  }
}
