// Finding spawn spots: sidewalks for peds, lanes for traffic, roads for responders.
import { LANE_W, type Block } from '../../../shared/world/cityTypes';
import type { World } from '../world';

export interface Spot { x: number; y: number; angle: number }

function farFromPlayers(w: World, x: number, y: number, min: number): boolean {
  return w.nearestPlayerDist2(x, y) >= min * min;
}

/** A point on the sidewalk ring of a block, plus the outward-facing angle at that point. */
export function sidewalkPoint(w: World, b: Block): Spot {
  const r = b.rect, i = 1.5;
  const side = Math.floor(w.rng.next() * 4);
  const t = w.rng.next();
  switch (side) {
    case 0: return { x: r.x0 + i + (r.x1 - r.x0 - 2 * i) * t, y: r.y0 + i, angle: -Math.PI / 2 };
    case 1: return { x: r.x1 - i, y: r.y0 + i + (r.y1 - r.y0 - 2 * i) * t, angle: 0 };
    case 2: return { x: r.x0 + i + (r.x1 - r.x0 - 2 * i) * t, y: r.y1 - i, angle: Math.PI / 2 };
    default: return { x: r.x0 + i, y: r.y0 + i + (r.y1 - r.y0 - 2 * i) * t, angle: Math.PI };
  }
}

export function pedSpawn(w: World, cx: number, cy: number, minD: number, maxD: number): { spot: Spot; block: Block } | null {
  for (let k = 0; k < 8; k++) {
    const a = w.rng.next() * Math.PI * 2, d = w.rng.range(minD, maxD);
    const b = w.map.blockAt(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    if (!b) continue;
    const spot = sidewalkPoint(w, b);
    if (!farFromPlayers(w, spot.x, spot.y, minD * 0.85) || w.map.isWater(spot.x, spot.y)) continue;
    return { spot, block: b };
  }
  return null;
}

/** A lane position on a road segment, heading toward (towardX, towardY) when given. */
export function laneSpawn(w: World, cx: number, cy: number, minD: number, maxD: number, toward?: { x: number; y: number }): Spot | null {
  for (let k = 0; k < 10; k++) {
    const a = w.rng.next() * Math.PI * 2, d = w.rng.range(minD, maxD);
    const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
    const { seg, t, d: off } = w.map.nearestSegment(px, py);
    if (off > 60) continue;
    const len = seg.axis === 'h' ? seg.x1 - seg.x0 : seg.y1 - seg.y0;
    const tt = Math.max(14, Math.min(len - 14, t));
    let dir: 1 | -1 = w.rng.chance(0.5) ? 1 : -1;
    const bx = seg.axis === 'h' ? seg.x0 + tt : seg.x0, by = seg.axis === 'h' ? seg.y0 : seg.y0 + tt;
    if (toward) dir = (seg.axis === 'h' ? toward.x - bx : toward.y - by) >= 0 ? 1 : -1;
    const lane = seg.lanes > 1 && w.rng.chance(0.5) ? 1 : 0;
    const hx = seg.axis === 'h' ? dir : 0, hy = seg.axis === 'v' ? dir : 0;
    const x = bx - hy * (lane + 0.5) * LANE_W, y = by + hx * (lane + 0.5) * LANE_W;
    if (!farFromPlayers(w, x, y, minD * 0.85) || w.map.isWater(x, y)) continue;
    let blocked = false;
    w.vehiclesNear(x, y, 11, () => { blocked = true; });
    if (blocked) continue;
    return { x, y, angle: Math.atan2(hy, hx) };
  }
  return null;
}
