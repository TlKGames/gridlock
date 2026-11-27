// Picking up where you left off: a character's last spot and vehicle are saved with them, and on
// joining any room (every room is the same city) they're put back there, in that vehicle.
import { type CharacterLast, PALETTE, VEHICLES } from '../shared/packs';
import { Mode } from '../shared/protocol';
import { groundOf } from '../shared/world/levels';
import type { Ped, Player } from './game/entities';
import { seatPed, spawnVehicle } from './game/factory';
import type { World } from './game/world';

/** The saved spot if it's still somewhere you can stand: on land, not inside a building. */
export function resumeSpot(w: World, last: CharacterLast | undefined): CharacterLast | null {
  if (!last) return null;
  const { x, y } = last;
  const { lo, hi } = w.map.shore;
  if ((!(x >= lo && x <= hi && y >= lo && y <= hi) && !w.map.onDock(x, y)) || w.map.isWater(x, y)) return null;
  let inside = false;
  w.statics.near(x - 0.5, y - 0.5, x + 0.5, y + 0.5, (b) => { if (b.h > 0.5 && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) inside = true; });
  return inside ? null : last;
}

/** Puts a resumed character back in the vehicle they were driving (theirs until they leave). */
export function resumeVehicle(w: World, pl: Player, ped: Ped, spot: CharacterLast): void {
  const veh = spot.vehicle;
  if (!veh || !VEHICLES[veh.type]) return;
  const spec = VEHICLES[veh.type];
  const v = spawnVehicle(w, veh.type, spot.x, spot.y, spot.angle, veh.color >= 0 && veh.color < PALETTE.length ? veh.color : -1);
  v.body.alt = 0; // helicopters come back on the ground
  w.statics.resolveObb(v.body, spec.length / 2, spec.width / 2);
  if (spec.trailer) v.trailer = spot.angle;
  v.persistent = true;
  pl.garageCar = v.id; // removed when the player leaves with nobody in it
  seatPed(w, ped, v, 0);
}

/** Where the player is now, to save; undefined while dead or in custody (keep the last good one). */
export function lastOf(w: World, pl: Player, room: string): CharacterLast | undefined {
  const p = w.peds.get(pl.pid);
  if (!p || p.dead || pl.mode === Mode.Dead || pl.mode === Mode.Busted) return undefined;
  const v = p.vehicle ? w.vehicles.get(p.vehicle) : undefined;
  // Upstairs (world/levels.ts): pick up again in the lobby below.
  const up = groundOf(w.pedPos(p).x, w.pedPos(p).y);
  const lobby = up.f > 0 ? w.city.interiors.find((i) => i.lift && up.x > i.room.x0 && up.x < i.room.x1 && up.y > i.room.y0 && up.y < i.room.y1)?.lift : undefined;
  const pos = lobby ?? up;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    room, x: r(pos.x), y: r(pos.y), angle: Math.round((v ? v.body.angle : p.body.angle) * 100) / 100,
    ...(v && p.seat === 0 && !v.wrecked ? { vehicle: { type: v.type, color: v.color } } : {}),
  };
}
