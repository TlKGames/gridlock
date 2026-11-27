// Lifts (elevators) and stairwells between a tower's or apartment block's floors (world/levels.ts,
// world/floors.ts, world/stairs.ts). A player stands at the elevator and picks a floor, or walks the
// stairs a floor at a time; AI chasing someone on another floor of the same building walks to the
// lift (in an apartment block, the stairwell's landing) and comes up after them (`route`).
import { dist } from '../../../shared/math';
import { flies } from '../../../shared/sim/kinds';
import type { Interior } from '../../../shared/world/interiors';
import { floorOf, groundOf, isWayStrip } from '../../../shared/world/levels';
import { StairIndex, stairwellOn } from '../../../shared/world/stairs';
import { doorway } from '../ai/doors';
import type { Ped, Player, Vehicle } from '../entities';
import { seatPed, unseatPed } from '../factory';
import type { World } from '../world';

/** The lift spot of interior `i` on floor f (0 = the lobby). */
export const liftOn = (i: Interior, f: number): { x: number; y: number } | null =>
  f === 0 ? i.lift ?? null : i.floors[f - 1]?.lift ?? null;

const inRoom = (i: Interior, x: number, y: number, m = 0.4) => x > i.room.x0 - m && x < i.room.x1 + m && y > i.room.y0 - m && y < i.room.y1 + m;

/** The building with lifts a point (on any floor) is in. */
export function liftBuilding(w: World, x: number, y: number): Interior | undefined {
  const g = groundOf(x, y);
  return w.city.interiors.find((i) => i.lift && inRoom(i, g.x, g.y));
}

function moveTo(p: Ped, at: { x: number; y: number }): void {
  p.body.x = at.x; p.body.y = at.y; p.body.vx = 0; p.body.vy = 0;
}

/** A player at a lift rides it to floor `to` (interior index `k`). */
export function ride(w: World, pl: Player, k: number, to: number): string | null {
  const p = w.peds.get(pl.pid), i = w.city.interiors[k];
  if (!p || p.dead || p.vehicle || !i?.lift) return 'Not now.';
  const here = liftOn(i, floorOf(p.body.x)), there = liftOn(i, to);
  if (!here || !there) return 'No such floor.';
  if (dist(p.body.x, p.body.y, here.x, here.y) > 2.5) return 'Stand at the lift.';
  moveTo(p, there);
  return null;
}

/** The interior with floors whose building's roof is under a landed helicopter, if any. */
export function roofBuilding(w: World, v: Vehicle): Interior | undefined {
  const bi = w.statics.roofAt(v.body.x, v.body.y);
  return bi < 0 ? undefined : w.city.interiors.find((i) => i.building === bi && i.lift && i.floors.length);
}

/** Getting out of a helicopter set down on a roof: down the roof stairs to the top floor, where the
 *  building has floors. Returns an error when there's nowhere to go. */
export function leaveOnRoof(w: World, p: Ped, v: Vehicle): string | null {
  const i = roofBuilding(w, v);
  const top = i ? liftOn(i, i.floors.length) : null;
  if (!top) return 'Nowhere to get out up here.';
  unseatPed(w, p, true);
  moveTo(p, top);
  return null;
}

/** From the stairs or lift, up onto the roof: back into a helicopter waiting there. */
export function toRoof(w: World, pl: Player, k: number): string | null {
  const p = w.peds.get(pl.pid), i = w.city.interiors[k];
  if (!p || p.dead || p.vehicle || !i?.lift) return 'Not now.';
  const here = liftOn(i, floorOf(p.body.x));
  if (!here || dist(p.body.x, p.body.y, here.x, here.y) > 2.5) return 'Stand at the lift.';
  return boardRoofHeli(w, p, i);
}

/** Into the helicopter set down on interior i's roof, if there is one free. */
function boardRoofHeli(w: World, p: Ped, i: Interior): string | null {
  let heli: Vehicle | undefined;
  for (const v of w.vehicles.values()) {
    if (!flies(v.spec) || v.wrecked || v.burning >= 0 || w.statics.roofAt(v.body.x, v.body.y) !== i.building) continue;
    if (v.body.alt > w.statics.floorAt(v.body.x, v.body.y) + 1) continue; // still in the air
    heli = v;
    break;
  }
  if (!heli) return 'No helicopter on the roof.';
  const driver = heli.seats[0] ? w.peds.get(heli.seats[0]) : undefined;
  const seat = !driver ? 0 : heli.seats.findIndex((s, n) => n > 0 && !s);
  if (seat < 0 || (driver && !driver.player)) return 'Someone else has it.';
  seatPed(w, p, heli, seat);
  return null;
}

/** When a player last heard the roof door was shut (so walking into it doesn't spam them). */
const roofNag = new WeakMap<Player, number>();

/** A player on foot at the top of a flight goes up to the next floor's landing (or out onto the
 *  roof, into a helicopter waiting there); at the bottom, down to the floor below's (world/stairs.ts). */
export function climbStairs(w: World, pl: Player, p: Ped): void {
  if (p.dead || p.vehicle) return;
  const hit = w.stairs.at(p.body.x, p.body.y);
  if (!hit) return;
  const way = StairIndex.way(hit.s, p.body.x, p.body.y);
  if (!way) return;
  const i = w.city.interiors[hit.k];
  if (way > 0 && hit.s.roof) {
    const err = boardRoofHeli(w, p, i);
    if (err && w.time - (roofNag.get(pl) ?? -99) > 4) { roofNag.set(pl, w.time); w.notify('info', 'The roof door is locked.', pl); }
    return;
  }
  const there = stairwellOn(i, hit.s.f + way);
  if (there) moveTo(p, there.landing);
}

/** AI heading for a point: where to walk now when the way isn't straight. On the same floor, through
 *  a walk-in place's doorway (ai/doors.ts); on another floor, in through the door, to the lift, and
 *  arriving at the lift takes them up or down. Null when they can head straight there. */
export function route(w: World, p: Ped, tx: number, ty: number): { x: number; y: number } | null {
  const tf = floorOf(tx), mf = floorOf(p.body.x);
  if (tf === mf) return mf === 0 ? doorway(w, p, tx, ty) : null;
  // A railway's viaduct (or a train on it): no walking up to it.
  if (isWayStrip(tf) || isWayStrip(mf)) return null;
  const i = liftBuilding(w, tf > 0 ? tx : p.body.x, tf > 0 ? ty : p.body.y);
  if (!i) return null;
  const here = liftOn(i, mf), there = liftOn(i, tf);
  if (!here || !there) return null;
  // On the ground floor (in the street, or in another shop): through the doors to the lobby lift.
  if (mf === 0) { const via = doorway(w, p, here.x, here.y); if (via) return via; }
  if (dist(p.body.x, p.body.y, here.x, here.y) < 1.3) { moveTo(p, there); return there; }
  return here;
}
