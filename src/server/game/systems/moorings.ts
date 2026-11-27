// Boats moored along the river and the coast (world/moorings.ts), where a pedestrian on the bank can
// step down into them: the pack's 'moored' boats, taking turns. Population keeps them like the
// helipads' helicopters (respawned when gone, cleared away with nobody near).
import { VEHICLES } from '../../../shared/packs';
import { afloat } from '../../../shared/sim/boat';
import { DOCK_DEPTH, moorings } from '../../../shared/world/moorings';
import type { World } from '../world';

export function mooredBoats(w: World): { x: number; y: number; angle: number; type: number }[] {
  const boats = VEHICLES.flatMap((v, i) => (v.roles.includes('moored') ? [i] : []));
  const out: { x: number; y: number; angle: number; type: number }[] = [];
  if (!boats.length) return out;
  for (const m of moorings(w.city)) {
    // Firm ground to step down from, just back from the edge.
    const lx = m.x - m.nx, ly = m.y - m.ny;
    if (w.map.isWater(lx, ly) || w.statics.resolveCircle({ x: lx, y: ly }, 0.35)) continue;
    const type = boats[out.length % boats.length], spec = VEHICLES[type];
    const off = DOCK_DEPTH + spec.width / 2 + 0.5;
    const body = { x: m.x + m.nx * off, y: m.y + m.ny * off, angle: m.angle, vx: 0, vy: 0, av: 0, alt: 0 };
    if (afloat(body, spec, w.statics)) out.push({ x: body.x, y: body.y, angle: m.angle, type });
  }
  return out;
}
