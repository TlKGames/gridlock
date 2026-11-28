// Before leaving the curb, check the signal and the short-term sweep of nearby vehicles.
import { rectContains } from '../../../shared/math';
import { rayAabb } from '../../../shared/world/shapes';
import { lightState } from '../../../shared/world/traffic';
import type { Ped } from '../entities';
import type { World } from '../world';
import { occupiesRoad } from './junctions';

export function safeToCross(w: World, p: Ped, tx: number, ty: number): boolean {
  const { x, y } = p.body;
  const mx = (x + tx) / 2, my = (y + ty) / 2;
  const node = w.map.nearestNode(mx, my);
  const axis = Math.abs(tx - x) > Math.abs(ty - y) ? 'h' : 'v';
  if (lightState(node, axis, w.time) !== 2) return false;

  let clear = true;
  w.vehiclesNear(mx, my, 100, (v) => {
    if (!clear || !occupiesRoad(v)) return;
    const b = v.body;
    // Expand the pedestrian path by the vehicle's projected half-size and walking clearance.
    function overlaps(ax: number, ay: number, dx: number, dy: number, heading: number): boolean {
      const c = Math.abs(Math.cos(heading)), s = Math.abs(Math.sin(heading));
      const px = (c * v.spec.length + s * v.spec.width) / 2 + 0.45;
      const py = (s * v.spec.length + c * v.spec.width) / 2 + 0.45;
      const box = { x0: Math.min(x, tx) - px, x1: Math.max(x, tx) + px,
        y0: Math.min(y, ty) - py, y1: Math.max(y, ty) + py, h: 0 };
      return rectContains(box, ax, ay) || !!rayAabb(ax, ay, dx, dy, box);
    }
    const horizon = 2.5;
    if (overlaps(b.x, b.y, b.vx * horizon, b.vy * horizon, b.angle)) { clear = false; return; }
    // Also look around a planned turn before a driver's current velocity points into the crossing.
    const drive = w.peds.get(v.seats[0])?.ai?.drive;
    if (!drive || drive.reverseT > 0) return;
    let remaining = Math.hypot(b.vx, b.vy) * horizon;
    let ax = b.x, ay = b.y;
    for (const pt of drive.pts) {
      if (remaining <= 0) break;
      const dx = pt.x - ax, dy = pt.y - ay, length = Math.hypot(dx, dy);
      if (!length) continue;
      const fraction = Math.min(1, remaining / length);
      if (overlaps(ax, ay, dx * fraction, dy * fraction, Math.atan2(dy, dx))) { clear = false; return; }
      remaining -= length;
      ax = pt.x; ay = pt.y;
    }
  });
  return clear;
}
