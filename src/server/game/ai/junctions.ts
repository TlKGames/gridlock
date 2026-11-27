// Junction right-of-way for AI traffic: don't enter a box that crossing traffic is using, yield to
// whoever reaches an unsignalled junction first, and don't enter unless there's room on the far side.
import { flies } from '../../../shared/sim/kinds';
import type { RoadNode } from '../../../shared/world/cityTypes';
import type { DriveState, Vehicle } from '../entities';
import type { World } from '../world';

const axisOf = (angle: number): 'h' | 'v' => (Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) ? 'h' : 'v');
const inBox = (n: RoadNode, x: number, y: number, pad = 0) => Math.abs(x - n.x) < n.wv / 2 + pad && Math.abs(y - n.y) < n.wh / 2 + pad;

/** Distance from a vehicle to the edge of the node's box along its heading (negative = inside). */
function toBox(v: Vehicle, n: RoadNode): number {
  const c = Math.cos(v.body.angle), s = Math.sin(v.body.angle);
  const along = (n.x - v.body.x) * c + (n.y - v.body.y) * s;
  const half = Math.abs(c) > Math.abs(s) ? n.wv / 2 : n.wh / 2;
  return along - half;
}

/**
 * May this car (approaching `node` on `axis`) enter the junction now? `exit` is the start of the
 * lane it will leave by.
 */
export function mayEnter(w: World, v: Vehicle, node: RoadNode, axis: 'h' | 'v', exit: { x: number; y: number } | null): boolean {
  if (inBox(node, v.body.x, v.body.y)) return true; // already committed: clear the box
  const mine = toBox(v, node);
  const r = Math.max(node.wv, node.wh) / 2 + 22;
  let ok = true;
  w.vehiclesNear(node.x, node.y, r, (o) => {
    if (!ok || o === v || o.wrecked || (flies(o.spec) && o.body.alt > 2)) return;
    const crossing = axisOf(o.body.angle) !== axis;
    const moving = Math.hypot(o.body.vx, o.body.vy) > 0.5;
    // Crossing traffic inside the box (moving or stuck there): wait for it to clear.
    if (crossing && inBox(node, o.body.x, o.body.y, 0.5)) { ok = false; return; }
    // Unsignalled junction: first to arrive goes; ties broken by id.
    if (!node.lights && crossing && moving && o.seats[0]) {
      const theirs = toBox(o, node);
      if (theirs > -0.5 && theirs < 9 && (theirs < mine - 0.5 || (Math.abs(theirs - mine) <= 0.5 && o.id < v.id))) ok = false;
    }
  });
  if (!ok || !exit) return ok;
  // Keep the box clear: only go if the lane we're heading into isn't backed up to the junction.
  w.vehiclesNear(exit.x, exit.y, 7, (o) => {
    if (o !== v && Math.hypot(o.body.vx, o.body.vy) < 1) ok = false;
  });
  return ok;
}

/** The next junction on the polyline: its node, approach axis, stop point index and exit point. */
export function nextJunction(w: World, d: DriveState): { node: RoadNode; axis: 'h' | 'v'; at: { x: number; y: number }; exit: { x: number; y: number } | null } | null {
  for (let i = 0; i < Math.min(d.pts.length, 4); i++) {
    const pt = d.pts[i];
    if (pt.stop === undefined) continue;
    // After the stop point come two turn samples, then the next lane's start.
    const exit = d.pts[i + 3] ?? null;
    return { node: w.city.nodes[pt.stop], axis: pt.axis!, at: pt, exit };
  }
  return null;
}
