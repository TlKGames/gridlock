// A railway along one road line (WORLD.railway): its tracks, stations and where it crosses streets.
// An elevated one also becomes a way (world/wayTypes.ts) with its own strip and height; trains run
// on it (server systems/trains.ts). Deterministic.
import { DISTRICTS } from '../packs';
import type { RailSpec } from '../packs/types';
import { MAP_SIZE, type RoadNode, type Segment } from './cityTypes';
import type { RoadLayout } from './roadgen';
import { WAY0, type Way } from './wayTypes';
import { WORLD } from './worldSpec';

/** Track height on a viaduct, the gap between its two tracks, a car's length plus coupling. */
export const RAIL_H = 6.2;
export const TRACK_GAP = 4;
export const CAR_PITCH = 15.6;
/** Half the viaduct's width, and where its stations' platforms reach out to. */
export const VIADUCT_HALF = 4.4;
export const PLATFORM_HALF = 7.2;

export interface Station {
  /** Centre along the line, half the platform's length, and its name. */
  a: number;
  half: number;
  name: string;
  /** Where you stand to take a train (the foot of each stair tower, or beside the track). */
  exits: { x: number; y: number }[];
  /** Elevated: the stair towers on the sidewalks (solid). */
  towers: { x0: number; y0: number; x1: number; y1: number }[];
}

export interface Railway {
  spec: RailSpec;
  axis: 'h' | 'v';
  line: number;
  pos: number;
  /** The way's strip when elevated (0 at grade) and the track's height. */
  strip: number;
  z: number;
  /** Along-axis extent trains run, and each track's offset across from the line's centre. */
  a0: number;
  a1: number;
  tracks: number[];
  stations: Station[];
  /** At grade: along-axis positions of the streets it crosses. */
  crossings: number[];
  /** The road line's width (for columns at its kerbs). */
  width: number;
  /** On a corridor of its own through the blocks (world/corridors.ts), not over a street: its
   *  columns stand in that strip. */
  own?: boolean;
  /** Track height along the line: [along, z]. */
  profile: [number, number][];
}

/** The railway's track point at `a` along it, on track `t`, in ground coordinates. */
export function trackPoint(r: Railway, a: number, t: number): { x: number; y: number } {
  return r.axis === 'h' ? { x: a, y: r.pos + r.tracks[t] } : { x: r.pos + r.tracks[t], y: a };
}

export function buildRailway(L: RoadLayout, g: { nodes: RoadNode[]; segs: Segment[] }, ways: Way[]): Railway | undefined {
  const spec = WORLD.railway;
  if (!spec) return undefined;
  const lines = spec.axis === 'h' ? L.ys : L.xs;
  const n = lines.length - 1, rr = L.riverRow;
  // An elevated railway has its own corridor through the blocks; one at grade runs along a street.
  let line = lines.findIndex((l) => l.rail), bd = Infinity;
  if (line < 0) lines.forEach((l, i) => {
    if (l.rail || i < 2 || i > n - 2 || (spec.axis === 'h' && rr >= 0 && (i === rr || i === rr + 1))) return;
    const d = Math.abs(l.pos / MAP_SIZE - spec.at) - (l.arterial ? 0.02 : 0);
    if (d < bd) { bd = d; line = i; }
  });
  const own = !!lines[line]?.rail;
  if (line < 0) return undefined;
  const pos = lines[line].pos;
  const along = (q: RoadNode) => (spec.axis === 'h' ? q.x : q.y);
  const hw = (q: RoadNode) => (spec.axis === 'h' ? q.wv : q.wh) / 2;
  const ln = g.nodes.filter((q) => (spec.axis === 'h' ? q.j === line : q.i === line)).sort((p, q) => along(p) - along(q));
  if (ln.length < 5) return undefined;
  const elevated = spec.style === 'elevated';
  const strip = elevated ? WAY0 + ways.length : 0;
  const off = spec.offset ?? 0;
  const tracks = spec.trains > 1 ? [off - TRACK_GAP / 2, off + TRACK_GAP / 2] : [off];
  const width = lines[line].width;
  const r: Railway = { spec, axis: spec.axis, line, pos, strip, z: elevated ? RAIL_H : 0, a0: along(ln[1]), a1: along(ln[ln.length - 2]), tracks, stations: [], crossings: [], width, profile: [[0, elevated ? RAIL_H : 0], [MAP_SIZE, elevated ? RAIL_H : 0]], ...(own ? { own } : {}) };
  // Stations mid-block, every few blocks and in the end blocks, where the platform fits.
  const need = (spec.cars * CAR_PITCH) / 2 + 3;
  const ks: number[] = [];
  for (let k = 1; k < ln.length - 2; k += Math.max(1, spec.stationEvery)) ks.push(k);
  if (ks[ks.length - 1] !== ln.length - 3) ks.push(ln.length - 3);
  const pt = (a: number, l: number) => (spec.axis === 'h' ? { x: a, y: pos + l } : { x: pos + l, y: a });
  for (const k of ks) {
    const p = ln[k], q = ln[k + 1];
    const room = (along(q) - hw(q) - along(p) - hw(p)) / 2 - 2;
    if (room < need) continue;
    const a = (along(p) + hw(p) + along(q) - hw(q)) / 2;
    const name = `${districtName(L, pt(a, 0))} ${spec.stationName}`;
    const st: Station = { a, half: need, name, exits: [], towers: [] };
    if (elevated) {
      // A stair tower each side at the platform's middle (on the sidewalks over a street; in the alley
      // under the viaduct on its own corridor); you wait at its door.
      for (const sd of [1, -1]) {
        const l = sd * (own ? PLATFORM_HALF + 0.9 : width / 2 + 1.4);
        const c0 = pt(a - 2.2, l - 1.1), c1 = pt(a + 2.2, l + 1.1);
        st.towers.push({ x0: Math.min(c0.x, c1.x), y0: Math.min(c0.y, c1.y), x1: Math.max(c0.x, c1.x), y1: Math.max(c0.y, c1.y) });
        st.exits.push(pt(a + 3.4, l));
      }
    } else {
      for (const t of tracks) st.exits.push(pt(a, t + Math.sign(t - off || 1) * 3.4));
    }
    r.stations.push(st);
  }
  if (r.stations.length < 2) return undefined;
  // Two stations in one district: told apart by which end of it they're at.
  const words = spec.axis === 'v' ? ['North', 'Central', 'South'] : ['West', 'Central', 'East'];
  const byName = new Map<string, Station[]>();
  for (const s of r.stations) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const base = name.slice(0, -spec.stationName.length - 1);
    list.forEach((s, i) => { s.name = `${base} ${list.length === 2 ? words[i * 2] : words[Math.min(i, 2)]} ${spec.stationName}`; });
  }
  // Trains run between the end stations.
  r.a0 = r.stations[0].a;
  r.a1 = r.stations[r.stations.length - 1].a;
  r.crossings = ln.filter((q) => along(q) > r.a0 - 30 && along(q) < r.a1 + 30).map(along);
  if (elevated) {
    ways.push({ kind: 'rail', axis: spec.axis, line, pos, strip, a0: r.a0 - need - 8, a1: r.a1 + need + 8, profile: r.profile });
  }
  return r;
}

function districtName(L: RoadLayout, p: { x: number; y: number }): string {
  const lower = (lines: { pos: number }[], v: number) => { let i = 0; while (i < lines.length - 2 && lines[i + 1].pos <= v) i++; return i; };
  const i = lower(L.xs, p.x), j = lower(L.ys, p.y);
  const d = L.cellDistrict[j * (L.xs.length - 1) + i];
  return DISTRICTS[d]?.name ?? 'Central';
}

/** Where along the viaduct columns stand (at the kerbs): clear of crossings and the river. */
export function railColumns(r: Railway, nodes: RoadNode[], isWater: (x: number, y: number) => boolean): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cross = nodes.filter((q) => (r.axis === 'h' ? q.j === r.line : q.i === r.line))
    .map((q) => { const a = r.axis === 'h' ? q.x : q.y, h = (r.axis === 'h' ? q.wv : q.wh) / 2 + 1.5; return [a - h, a + h] as [number, number]; });
  // On its own corridor, under the viaduct's edges; over a street, on the sidewalk just behind the
  // kerb, clear of the traffic lanes.
  const half = r.own ? VIADUCT_HALF - 0.6 : r.width / 2 + 0.45;
  for (let a = r.a0 - 40; a <= r.a1 + 40; a += 18) {
    let at = a;
    for (let k = 0; k < 5 && cross.some(([c0, c1]) => at > c0 && at < c1); k++) at += 4;
    if (cross.some(([c0, c1]) => at > c0 && at < c1)) continue;
    for (const sd of [1, -1]) {
      const p = r.axis === 'h' ? { x: at, y: r.pos + sd * half } : { x: r.pos + sd * half, y: at };
      if (!isWater(p.x, p.y)) out.push(p);
    }
  }
  return out;
}
