// Dev only: moving a player somewhere directly.
import type { Player } from '../entities';
import type { World } from '../world';

/** Dev only: puts a player (and the vehicle they drive) at a point, standing still. */
export function devTeleport(w: World, pl: Player, x: number, y: number): void {
  const p = w.peds.get(pl.pid);
  if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const v = p.vehicle ? w.vehicles.get(p.vehicle) : undefined;
  const b = v && p.seat === 0 ? v.body : p.body;
  b.x = x; b.y = y; b.vx = 0; b.vy = 0;
  p.body.x = x; p.body.y = y;
}
