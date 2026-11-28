// Scheduled civilians use the same street graph as traffic. Foot waypoints follow the edges
// of each street and cross one arm of a junction at a time.
import { Rng } from '../../../shared/rng';
import { RULES } from '../../../shared/packs';
import { DIR_VEC, Dir, type Segment } from '../../../shared/world/cityTypes';
import type { Resident } from '../census';
import type { Ped } from '../entities';
import type { World } from '../world';
import { doorOf, roomAt } from './doors';
import { findRoute, segBetween } from './route';
import { safeToCross } from './pedCrossings';
import { openFootWaypoint } from './footNavigation';
import { moveToward } from './tasks';

type Point = { x: number; y: number };
type Waypoint = Point & { cross?: boolean };
export interface Destination { lot: number; entrance: Point; curb: Point; pullOver: Point; parkingStreet?: Segment; street: Segment; indoors: boolean }
const routes = new WeakMap<Ped, { goal: Destination; steps: Waypoint[]; crossing: boolean }>();
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function buildingAccess(w: World, lotId: number) {
  const lot = w.city.lots[lotId], rect = lot.building!.rect;
  const interior = w.city.interiors.find(i => i.place.lot === lotId);
  let entrance: Point;
  let approach: Point;
  if (interior) {
    const d = doorOf(w, interior);
    entrance = { x: d.x - d.fx * 2.5, y: d.y - d.fy * 2.5 };
    approach = { x: d.x + d.fx * 2, y: d.y + d.fy * 2 };
  } else {
    const center = { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
    const nearest = w.map.nearestSegment(center.x, center.y).seg;
    const front = lot.front >= 0 ? lot.front : nearest.axis === 'h'
      ? (center.y > nearest.y0 ? Dir.N : Dir.S) : (center.x > nearest.x0 ? Dir.W : Dir.E);
    const [fx, fy] = DIR_VEC[front];
    entrance = { x: center.x + fx * ((rect.x1 - rect.x0) / 2 + 1),
      y: center.y + fy * ((rect.y1 - rect.y0) / 2 + 1) };
    approach = entrance;
  }
  return { entrance, approach, indoors: !!interior };
}

export function destination(w: World, lotId: number): Destination {
  const { entrance, approach, indoors } = buildingAccess(w, lotId);
  const { seg, t } = w.map.nearestSegment(approach.x, approach.y);
  const curb = sidewalk(seg, t, approach);
  let closest = Infinity, pullOver = curb;
  for (const spot of w.city.parking) {
    if (spot.lot !== undefined) continue;
    const d = distance(spot, curb);
    if (d < closest) { closest = d; pullOver = spot; }
  }
  const parkingStreet = closest < Infinity ? w.map.nearestSegment(pullOver.x, pullOver.y).seg : undefined;
  return { lot: lotId, entrance, curb, pullOver, parkingStreet, street: seg, indoors };
}

export function pickupDestination(w: World, lot: number, parked: Point): Destination {
  const { seg, t } = w.map.nearestSegment(parked.x, parked.y);
  return { lot, entrance: parked, curb: sidewalk(seg, t, parked), street: seg, pullOver: parked, indoors: false };
}

/** Pick a repeatable standing place away from the doorway, staff and shop furniture. */
export function indoorSpot(w: World, goal: Destination, id: number): Point {
  const interior = roomAt(w, goal.entrance.x, goal.entrance.y);
  if (!interior) return goal.entrance;
  const rng = new Rng(w.seed ^ Math.imul(id, 2654435761) ^ goal.lot);
  const { room } = interior;
  for (let n = 0; n < 20; n++) {
    const point = { x: rng.range(room.x0 + 1, room.x1 - 1), y: rng.range(room.y0 + 1, room.y1 - 1) };
    if (distance(point, interior.counter) < 1.5 || distance(point, interior.clerk) < 1.5 ||
        distance(point, goal.entrance) < 1.5 || w.statics.resolveCircle(point, 0.65)) continue;
    if (!w.statics.raycast(goal.entrance.x, goal.entrance.y, point.x, point.y, 0.5)) return point;
  }
  return goal.entrance;
}

function sidewalk(s: Segment, t: number, side: Point): Point {
  const off = s.width / 2 + (s.bridge ? -1.2 : 1.4);
  if (s.axis === 'h') return { x: s.x0 + t, y: s.y0 + (side.y >= s.y0 ? off : -off) };
  return { x: s.x0 + (side.x >= s.x0 ? off : -off), y: s.y0 + t };
}

function itinerary(w: World, start: Point, goal: Destination): Waypoint[] {
  const { seg: first, t } = w.map.nearestSegment(start.x, start.y);
  if (goal.indoors && roomAt(w, start.x, start.y)?.place.lot === goal.lot) return [goal.entrance];
  const initial = sidewalk(first, t, start);
  const steps: Waypoint[] = [initial];
  let last = initial;
  const append = (point: Point, cross = false) => {
    if (distance(last, point) > 0.2) steps.push({ ...point, cross });
    last = point;
  };
  if (first.id !== goal.street.id || (first.axis === 'h' ? initial.y !== goal.curb.y : initial.x !== goal.curb.x)) {
    const nearEnd = (s: Segment, p: Point) => distance(w.city.nodes[s.a], p) < distance(w.city.nodes[s.b], p) ? s.a : s.b;
    const path = findRoute(w, nearEnd(first, start), nearEnd(goal.street, goal.curb));
    if (!path.length) return [];
    for (let i = 0; i < path.length; i++) {
      const n = w.city.nodes[path[i]];
      const next = i + 1 < path.length ? w.city.nodes[path[i + 1]] : goal.curb;
      const street = i + 1 < path.length ? segBetween(w, n.id, path[i + 1])! : goal.street;
      // Approach the nearest corner. Cross at that corner only if the outgoing sidewalk requires it.
      const ox = n.wv / 2 + 1.4, oy = n.wh / 2 + 1.4;
      const corner = { x: n.x + (last.x >= n.x ? ox : -ox), y: n.y + (last.y >= n.y ? oy : -oy) };
      append(corner);
      const end = { ...corner };
      if (street.axis === 'h') end.x = n.x + (next.x >= n.x ? ox : -ox);
      else end.y = n.y + (next.y >= n.y ? oy : -oy);
      append(end, true);
      if (i + 1 === path.length) {
        append(street.axis === 'h' ? { x: end.x, y: goal.curb.y } : { x: goal.curb.x, y: end.y }, true);
      } else if (street.bridge) {
        const edge = sidewalk(street, street.axis === 'h' ? end.x - street.x0 : end.y - street.y0, end);
        append(edge);
        append(street.axis === 'h' ? { x: next.x - Math.sign(next.x - n.x) * ox, y: edge.y }
          : { x: edge.x, y: next.y - Math.sign(next.y - n.y) * oy });
      }
    }
  }
  append(goal.curb);
  append(goal.entrance);
  return steps;
}

export function walkCommute(w: World, p: Ped, goal: Destination, dt: number): void {
  if (p.arrivedAt === goal.lot) { p.ctl.mx = p.ctl.my = 0; return; }
  let route = routes.get(p);
  if (!route || route.goal !== goal) {
    route = { goal, steps: itinerary(w, p.body, goal), crossing: false };
    routes.set(p, route);
  }
  const next = route.steps[0];
  if (!next) { p.ctl.mx = p.ctl.my = 0; return; }
  if (next.cross && !route.crossing) {
    if (!safeToCross(w, p, next.x, next.y)) { p.ctl.mx = p.ctl.my = 0; return; }
    route.crossing = true;
  }
  p.ai!.crossing = route.crossing || w.map.onRoad(next.x, next.y) ? 'walking' : 'none';
  const target = distance(p.body, next) < 12 && (route.steps.length > 1 || !goal.indoors)
    ? openFootWaypoint(w, next, p.body) : next;
  moveToward(w, p, target.x, target.y, p.spec.walkSpeed, dt);
  if (distance(p.body, target) < 0.9) {
    route.steps.shift();
    route.crossing = false;
    if (!route.steps.length) {
      p.arrivedAt = goal.lot;
      if (p.resident && !p.collectingVin) p.resident.occupiedLot = goal.lot;
    }
  }
}

// A saved walk is advanced along its remaining pavement segments only when the room clock runs.
export function checkpointWalk(w: World, p: Ped): void {
  const route = routes.get(p);
  if (!p.resident || p.vehicle || p.dead || !route?.steps.length || route.goal !== p.commute || p.ai?.task !== 'wander') return;
  p.resident.walk = { lot: route.goal.lot, minute: w.gameDay * 1440 + w.gameMinutes,
    speed: p.spec.walkSpeed / RULES.gameMinutesPerSecond, points: [{ x: p.body.x, y: p.body.y }, ...route.steps] };
}

export function walkPosition(w: World, walk: NonNullable<Resident['walk']>): (Point & { index: number }) | null {
  let remaining = Math.max(0, w.gameDay * 1440 + w.gameMinutes - walk.minute) * walk.speed;
  for (let i = 1; i < walk.points.length; i++) {
    const a = walk.points[i - 1], b = walk.points[i], length = distance(a, b);
    if (remaining < length) return { index: i, x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    remaining -= length;
  }
  return null;
}

export function resumeRoute(p: Ped, steps: Waypoint[], crossing: boolean): void {
  if (p.commute) routes.set(p, { goal: p.commute, steps, crossing });
}

export function interruptCommute(p: Ped): void {
  routes.delete(p);
  p.arrivedAt = undefined;
  if (p.resident) delete p.resident.occupiedLot;
}
