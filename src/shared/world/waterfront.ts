// The dry edge follows the outside of the waterfront road. The river remains open
// at both mouths. Positions here drive ground paint, swimming and hull clearance.
import { insetRect, type Rect } from '../math';
import { type City, SIDEWALK_W, LAND0, LAND1, MAP_SIZE } from './cityTypes';

export function waterfront(city: City) {
  const coast = city.edge === 'sea';
  const lo = coast ? LAND0 - SIDEWALK_W : LAND0, hi = coast ? LAND1 + SIDEWALK_W : LAND1;
  const r = city.riverRow;
  const river = r < 0 ? null : { x0: 0, x1: MAP_SIZE * 2,
    y0: city.ys[r].pos + city.ys[r].width / 2 + SIDEWALK_W,
    y1: city.ys[r + 1].pos - city.ys[r + 1].width / 2 - SIDEWALK_W };
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
