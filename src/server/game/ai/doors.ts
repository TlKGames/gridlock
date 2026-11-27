// Getting in and out of walk-in places on foot (shared/world/interiors.ts): someone inside a shop
// can only be reached through its door gap, so AI heading in or out goes to the doorway first,
// straight through it, then on. Drivers chasing someone indoors drive to the door and get out there.
import { DIR_VEC, Dir } from '../../../shared/world/cityTypes';
import type { Interior } from '../../../shared/world/interiors';
import { groundOf, isWayStrip, LEVEL_BAND } from '../../../shared/world/levels';
import type { Ped } from '../entities';
import type { World } from '../world';

interface Door { x: number; y: number; fx: number; fy: number }

const doors = new WeakMap<Interior, Door>();

/** The door gap's centre on the front wall, and the outward direction. */
export function doorOf(w: World, i: Interior): Door {
  let d = doors.get(i);
  if (!d) {
    const lot = w.city.lots[i.place.lot];
    const r = lot.building!.rect;
    const [fx, fy] = DIR_VEC[lot.front];
    const x = lot.front === Dir.W ? r.x0 : lot.front === Dir.E ? r.x1 : i.place.x;
    const y = lot.front === Dir.N ? r.y0 : lot.front === Dir.S ? r.y1 : i.place.y;
    d = { x, y, fx, fy };
    doors.set(i, d);
  }
  return d;
}

/** The walk-in room (ground floor) a point is in, if any. */
export function roomAt(w: World, x: number, y: number): Interior | undefined {
  if (x >= LEVEL_BAND) return undefined;
  return w.city.interiors.find((i) => x > i.room.x0 && x < i.room.x1 && y > i.room.y0 && y < i.room.y1);
}

/** The building someone is in on any floor (upper floors map back over their building). */
export function buildingAt(w: World, x: number, y: number): Interior | undefined {
  const g = groundOf(x, y);
  return roomAt(w, g.x, g.y);
}

const OUT = 1.6, IN = 2.2, LANE = 0.6;

/** Through a door: lined up in the gap, carry on through; otherwise go to the gap's mouth first. */
function through(w: World, i: Interior, p: Ped, leaving: boolean): { x: number; y: number } {
  const d = doorOf(w, i);
  const rx = p.body.x - d.x, ry = p.body.y - d.y;
  const depth = rx * d.fx + ry * d.fy;              // + outside, - inside
  const lat = -rx * d.fy + ry * d.fx;
  const outside = { x: d.x + d.fx * OUT, y: d.y + d.fy * OUT };
  const inside = { x: d.x - d.fx * IN, y: d.y - d.fy * IN };
  const inLane = Math.abs(lat) < LANE && depth > -IN - 0.4 && depth < OUT + 0.4;
  if (leaving) return inLane ? outside : inside;
  return inLane ? inside : outside;
}

/** Where to head next on the way to (tx, ty) on the same floor, when a doorway is in between: out of
 *  the room you're in, or into the target's. Null when there's no doorway to go through. */
export function doorway(w: World, p: Ped, tx: number, ty: number): { x: number; y: number } | null {
  const mine = roomAt(w, p.body.x, p.body.y);
  const theirs = roomAt(w, tx, ty);
  if (mine === theirs) return null;
  if (mine) return through(w, mine, p, true);
  return theirs ? through(w, theirs, p, false) : null;
}

/** How far apart two people really are: across floors (world/levels.ts) it's measured over the
 *  building, plus the climb, not across the off-map strips the upper floors live on. */
export function reachDist(ax: number, ay: number, bx: number, by: number): { d: number; sameFloor: boolean } {
  const a = groundOf(ax, ay), b = groundOf(bx, by);
  // A railway's viaduct (world/ways.ts) is about two floors up.
  const lvl = (f: number) => (isWayStrip(f) ? 2 : f);
  return { d: Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(lvl(a.f) - lvl(b.f)) * 6, sameFloor: a.f === b.f };
}

/** Where a driver should go to reach someone at (x, y): the street outside the door if they're
 *  indoors (on any floor), else the point itself. */
export function streetGoal(w: World, x: number, y: number): { x: number; y: number; indoors: boolean } {
  const i = buildingAt(w, x, y);
  if (!i) return { x, y, indoors: false };
  const d = doorOf(w, i);
  return { x: d.x + d.fx * 4, y: d.y + d.fy * 4, indoors: true };
}
