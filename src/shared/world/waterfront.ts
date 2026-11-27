// The dry edge follows the outside of the waterfront road. The river remains open
// at both mouths. Positions here drive ground paint, swimming and hull clearance.
import { insetRect, type Rect } from '../math';
import { type City, type RoadLine, SIDEWALK_W, LAND0, LAND1, MAP_SIZE } from './cityTypes';

export function riverChannel(ys: RoadLine[], row: number): Rect | null {
  if (row < 0) return null;
  return { x0: 0, x1: MAP_SIZE * 2,
    y0: ys[row].pos + ys[row].width / 2 + SIDEWALK_W,
    y1: ys[row + 1].pos - ys[row + 1].width / 2 - SIDEWALK_W };
}

export function waterfront(city: City) {
  const coast = city.edge === 'sea';
  const lo = coast ? LAND0 - SIDEWALK_W : LAND0, hi = coast ? LAND1 + SIDEWALK_W : LAND1;
  const river = riverChannel(city.ys, city.riverRow);
  const walks: Rect[] = [];
  const strip = (x0: number, y0: number, x1: number, y1: number) => walks.push({ x0, y0, x1, y1 });
  if (river) {
    strip(lo, river.y0 - SIDEWALK_W, hi, river.y0);
    strip(lo, river.y1, hi, river.y1 + SIDEWALK_W);
  }
  if (coast) {
    const west = city.xs[0], east = city.xs[city.xs.length - 1];
    const north = city.ys[0], south = city.ys[city.ys.length - 1];
    strip(lo, lo, hi, north.pos - north.width / 2);
    strip(lo, south.pos + south.width / 2, hi, hi);
    const ends = river ? [[LAND0, river.y0], [river.y1, LAND1]] : [[LAND0, LAND1]];
    for (const [a, b] of ends) {
      strip(lo, a, west.pos - west.width / 2, b);
      strip(east.pos + east.width / 2, a, hi, b);
    }
  }
  for (const p of city.ponds) {
    const o = insetRect(p, -SIDEWALK_W);
    strip(o.x0, o.y0, o.x1, p.y0);
    strip(o.x0, p.y1, o.x1, o.y1);
    strip(o.x0, p.y0, p.x0, p.y1);
    strip(p.x1, p.y0, o.x1, p.y1);
  }
  return { lo, hi, river, walks };
}

// Along the seafront and its river quays. Cut each run at the actual dock face or
// bridge carriageway so its visible end is also the end of the collision wall.
export const RAIL_HEIGHT = 1.05;
export function waterfrontRails(city: City, shore: ReturnType<typeof waterfront>, docks: Rect[]): Rect[] {
  if (city.edge !== 'sea') return [];
  const { lo, hi, river } = shore;
  const runs: Rect[] = [], width = 0.28;
  function edge(horizontal: boolean, line: number, inward: number, start: number, end: number, gaps: Rect[]) {
    const inner = line + inward * width, low = Math.min(line, inner), high = Math.max(line, inner);
    function rail(a: number, b: number) {
      if (b <= a) return;
      runs.push(horizontal ? { x0: a, x1: b, y0: low, y1: high } : { x0: low, x1: high, y0: a, y1: b });
    }
    const cuts = gaps.filter(g => horizontal ? g.y0 <= line && line <= g.y1 : g.x0 <= line && line <= g.x1)
      .map(g => horizontal ? [g.x0, g.x1] : [g.y0, g.y1]).sort((a, b) => a[0] - b[0]);
    let cursor = start;
    for (const [a, b] of cuts) {
      rail(cursor, Math.min(a, end));
      cursor = Math.max(cursor, b);
    }
    rail(cursor, end);
  }
  const banks = river ? [[lo, river.y0], [river.y1, hi]] : [[lo, hi]];
  for (const [north, south] of banks) {
    edge(true, north, 1, lo, hi, north === lo ? docks : [...docks, ...city.bridges]);
    edge(true, south, -1, lo, hi, south === hi ? docks : [...docks, ...city.bridges]);
    edge(false, lo, 1, north + width, south - width, docks);
    edge(false, hi, -1, north + width, south - width, docks);
  }
  return runs;
}
