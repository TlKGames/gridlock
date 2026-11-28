import { WORLD } from '../../../shared/world/worldSpec';
import type { Destination } from './commute';
import { parkingFits } from './parking';
import { lotLayout, BAY_DEPTH, BAY_WIDTH } from '../../../shared/world/parkingLayout';
// Find short forward/reverse manoeuvres into the adjacent travel lane using the
// same steering and acceleration as the live car. Departures and blocked-road recovery share this search.
import { angleDiff, clamp } from '../../../shared/math';
import { emptyControls, forwardSpeed, stepVehicle, type Body } from '../../../shared/sim/physics';
import { obbVsObb } from '../../../shared/sim/dynamic';
import { DIR_VEC, LANE_W } from '../../../shared/world/cityTypes';
import type { DriveState, Vehicle } from '../entities';
import type { World } from '../world';
import { laneOf } from './route';

interface Move { speed: number; steer: number }
interface LaneSection { x: number; y: number; hx: number; hy: number; length: number }
interface Maneuver extends LaneSection {
  bay?: number;
  road?: LaneSection & { width: number };
  move: Move;
  left: number;
  plan: Move[];
}
const exits = new WeakMap<Vehicle, Maneuver>();
// Stagger expensive searches when many shifts end on the same server tick.
const lastSearch = new WeakMap<World, number>();
const hold = { speed: 0, steer: 0 };

function exitFor(w: World, index: number): Maneuver {
  const bay = w.city.parking[index];
  let x = bay.x, y = bay.y;
  const lot = bay.lot === undefined ? undefined : w.city.lots[bay.lot];
  if (lot && lot.front !== -1) {
    const r = lot.rect, [dx, dy] = DIR_VEC[lot.front];
    x = (r.x0 + r.x1 + dx * (r.x1 - r.x0)) / 2;
    y = (r.y0 + r.y1 + dy * (r.y1 - r.y0)) / 2;
  }
  const { seg } = w.map.nearestSegment(x, y);
  const right = seg.axis === 'h' ? bay.y - seg.y0 : seg.x0 - bay.x;
  const lane = laneOf(w, seg, right >= 0 ? 1 : -1, seg.lanes - 1);
  return { bay: index, x: lane.sx, y: lane.sy, hx: lane.hx, hy: lane.hy,
    length: Math.hypot(lane.ex - lane.sx, lane.ey - lane.sy), move: hold, left: 0, plan: [] };
}

function distance(b: Body, e: Maneuver) {
  const x = b.x - e.x, y = b.y - e.y;
  const along = x * e.hx + y * e.hy;
  return Math.hypot(x * e.hy - y * e.hx, Math.max(0, 2 - along, along - e.length + 2));
}
function error(b: Body, e: Maneuver) {
  return distance(b, e) + 2.5 * Math.abs(angleDiff(b.angle, Math.atan2(e.hy, e.hx)));
}
function throttle(b: Body, speed: number) { return clamp((speed - forwardSpeed(b)) * 0.65, -1, 1); }

function surroundings(w: World, v: Vehicle) {
  const cars: Vehicle[] = [];
  w.vehiclesNear(v.body.x, v.body.y, 45, o => { if (o !== v && o.body.alt < 2) cars.push(o); });
  const people: Body[] = [];
  w.pedsNear(v.body.x, v.body.y, 35, p => { if (!p.vehicle && !p.dead) people.push(p.body); });
  return { cars, people };
}

function rollout(w: World, v: Vehicle, from: Body, move: Move, steps: number, e: Maneuver, nearby: ReturnType<typeof surroundings>) {
  const b = { ...from }, ctl = emptyControls();
  ctl.steer = move.steer;
  for (let i = 1; i <= steps; i++) {
    const previous = { x: b.x, y: b.y, angle: b.angle };
    ctl.throttle = throttle(b, move.speed);
    if (stepVehicle(b, v.spec, ctl, 0.1, w.statics, true) || w.map.isWater(b.x, b.y)) return;
    const ours = { x: b.x, y: b.y, angle: b.angle, hl: v.spec.length / 2 + 0.12, hw: v.spec.width / 2 + 0.08 };
    if (e.road) {
      const road = e.road, dx = b.x - road.x, dy = b.y - road.y;
      const across = Math.abs(dx * road.hy - dy * road.hx), along = dx * road.hx + dy * road.hy;
      const yaw = b.angle - Math.atan2(road.hy, road.hx);
      if (across + Math.abs(Math.sin(yaw)) * ours.hl + Math.abs(Math.cos(yaw)) * ours.hw > road.width / 2 ||
          along < ours.hl || along > road.length - ours.hl) return;
    }
    for (const car of nearby.cars) {
      const o = car.body;
      const obstacle = { x: o.x + o.vx * i * 0.1, y: o.y + o.vy * i * 0.1, angle: o.angle,
        hl: car.spec.length / 2 + Math.min(5, Math.hypot(o.vx, o.vy) * 0.45), hw: car.spec.width / 2 };
      const hit = obbVsObb(ours, obstacle);
      if (hit) {
        // If bumpers already touch, allow only movement that separates them.
        const before = obbVsObb({ ...ours, ...previous }, obstacle);
        if (!before || hit.depth >= before.depth) return;
      }
    }
    for (const p of nearby.people) {
      if (obbVsObb(ours, { x: p.x + p.vx * i * 0.1, y: p.y + p.vy * i * 0.1, angle: 0, hl: 0.45, hw: 0.45 })) return;
    }
  }
  return b;
}

function nextMove(w: World, v: Vehicle, e: Maneuver, nearby: ReturnType<typeof surroundings>): Move[] {
  const start = error(v.body, e);
  type Node = { b: Body; cost: number; rank: number; parent?: Node; move?: Move };
  const open: Node[] = [{ b: v.body, cost: 0, rank: start }];
  const seen = new Set<string>();
  let best = start, choice: Node | undefined;
  for (let n = 0; n < 90 && open.length && best > 0.9; n++) {
    open.sort((a, b) => b.rank - a.rank);
    const node = open.pop()!;
    for (const speed of [3, -2.5]) for (const steer of [0, -0.8, 0.8]) {
      const move = { speed, steer };
      const b = rollout(w, v, node.b, move, 8, e, nearby);
      if (!b) continue;
      const key = [Math.round(b.x), Math.round(b.y), Math.round(Math.atan2(Math.sin(b.angle), Math.cos(b.angle)) * 5), Math.sign(forwardSpeed(b))].join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const remaining = error(b, e);
      const cost = node.cost + (speed < 0 ? 1.2 : 1);
      const next = { b, parent: node, move, cost, rank: cost + 2 * remaining };
      if (remaining < best - 0.05) { best = remaining; choice = next; }
      open.push(next);
    }
  }
  const plan: Move[] = [];
  for (let node = choice; node?.move; node = node.parent) plan.push(node.move);
  return plan.reverse().slice(0, 3);
}

function waypoint(x: number, y: number, hx: number, hy: number): Maneuver {
  return { x: x - 2 * hx, y: y - 2 * hy, hx, hy, length: 4, move: hold, left: 0, plan: [] };
}
const arrivals = new WeakMap<Vehicle, { goal: Destination; steps: Maneuver[]; phaseTime: number }>();

const failures = new WeakMap<Vehicle, { goal: Destination; until: number; curb: Destination }>();
export function parkingGoal(w: World, v: Vehicle, goal?: Destination) {
  const failed = failures.get(v);
  return failed && failed.goal === goal && failed.until > w.time ? failed.curb : goal;
}

export function enterLot(w: World, v: Vehicle, goal: Destination, dt: number): boolean {
  const lot = goal.publicLot;
  if (!lot) return false;
  let arrival = arrivals.get(v);
  if (arrival?.goal !== goal || !v.parkingTarget) arrival = undefined;
  if (!arrival) {
    const dx = lot.x - v.body.x, dy = lot.y - v.body.y;
    const ahead = dx * Math.cos(v.body.angle) + dy * Math.sin(v.body.angle);
    if (dx * -Math.sin(v.body.angle) + dy * Math.cos(v.body.angle) < 0 || Math.hypot(dx, dy) > 17 || ahead < -1 || w.map.nearestSegment(v.body.x, v.body.y).seg !== lot.street) return false;
    const bay = lot.bays.find(({ spot, index }) => v.spec.length <= BAY_DEPTH && v.spec.width <= BAY_WIDTH &&
      !w.registry.atSlot('parking:' + index) && parkingFits(w, v.spec, spot, v));
    if (bay) {
      const { spot } = bay;
      v.parkingTarget = { ...spot, lot: goal.lot };
      const aisleX = lot.fx ? spot.x : lot.x, aisleY = lot.fy ? spot.y : lot.y;
      arrival = { goal, phaseTime: 0, steps: [
        waypoint(lot.x, lot.y, -lot.fx, -lot.fy),
        waypoint(aisleX, aisleY, -lot.fx, -lot.fy),
        waypoint(spot.x, spot.y, Math.cos(spot.angle), Math.sin(spot.angle))
      ] };
      arrivals.set(v, arrival);
    }
  }
  if (arrival && arrival.phaseTime < 45) {
    const step = arrival.steps[0];
    if (step && run(w, v, step, dt)) arrival.phaseTime += dt;
    else {
      arrival.steps.shift();
      arrival.phaseTime = 0;
      v.ctl.throttle = v.ctl.steer = 0;
      v.ctl.handbrake = true;
    }
    return true;
  }
  arrivals.delete(v);
  delete v.parkingTarget;
  failures.set(v, { goal, until: w.time + 180, curb: { ...goal, ...goal.fallback, publicLot: undefined } });
  return false;
}

const departures = new WeakMap<Vehicle, { bay: number; steps: Maneuver[] }>();
export function leaveParking(w: World, v: Vehicle, dt: number): boolean {
  const index = v.departureBay!;
  let path = departures.get(v);
  if (path?.bay !== index) {
    const spot = w.city.parking[index];
    const a = !WORLD.modern || spot.lot === undefined ? undefined : lotLayout(w.city.lots[spot.lot]);
    const steps = a ? [
      waypoint(a.fx ? spot.x : a.x, a.fy ? spot.y : a.y, a.fx, a.fy),
      waypoint(a.x, a.y, a.fx, a.fy)
    ] : [];
    path = { bay: index, steps };
    departures.set(v, path);
  }
  if (path.steps.length) {
    if (run(w, v, path.steps[0], dt)) return true;
    path.steps.shift();
    return true;
  }
  let e = exits.get(v);
  if (!e || e.bay !== v.departureBay) { e = exitFor(w, v.departureBay!); exits.set(v, e); }
  if (run(w, v, e, dt)) return true;
  departures.delete(v); exits.delete(v); delete v.departureBay;
  return false;
}

const recoveries = new WeakMap<DriveState, Maneuver>();

export function startDetour(w: World, v: Vehicle, d: DriveState, blocker: Vehicle): void {
  const { seg } = w.map.nearestSegment(v.body.x, v.body.y);
  const h = seg.axis === 'h';
  const dir = (h ? Math.cos(v.body.angle) : Math.sin(v.body.angle)) >= 0 ? 1 : -1;
  const right = dir * (h ? v.body.y - seg.y0 : seg.x0 - v.body.x);
  const lane = laneOf(w, seg, dir, clamp(Math.floor(right / LANE_W), 0, seg.lanes - 1));
  const ahead = (blocker.body.x - lane.sx) * lane.hx + (blocker.body.y - lane.sy) * lane.hy;
  const finish = ahead + (blocker.spec.length + v.spec.length) / 2 + 3;
  const length = Math.hypot(lane.ex - lane.sx, lane.ey - lane.sy);
  if (finish >= length - v.spec.length || finish <= 2) return;
  const offset = (lane.sx - seg.x0) * -lane.hy + (lane.sy - seg.y0) * lane.hx;
  recoveries.set(d, { x: lane.sx + lane.hx * (finish - 2), y: lane.sy + lane.hy * (finish - 2),
    hx: lane.hx, hy: lane.hy, length: 4, move: hold, left: 0, plan: [],
    road: { x: lane.sx + lane.hy * offset, y: lane.sy - lane.hx * offset,
      hx: lane.hx, hy: lane.hy, width: seg.width, length } });
}

export function recovering(w: World, v: Vehicle, d: DriveState, dt: number): boolean {
  const plan = recoveries.get(d);
  if (!plan) return false;
  if (run(w, v, plan, dt)) return true;
  recoveries.delete(d);
  return false;
}

function run(w: World, v: Vehicle, e: Maneuver, dt: number): boolean {
  if (distance(v.body, e) < LANE_W * 0.28 && Math.abs(angleDiff(v.body.angle, Math.atan2(e.hy, e.hx))) < 0.32) {
    return false;
  }
  const nearby = surroundings(w, v);
  if (e.left <= 0) {
    if (!e.plan.length && lastSearch.get(w) === w.time) {
      v.ctl.throttle = v.ctl.steer = 0;
      v.ctl.handbrake = true;
      return true;
    }
    if (!e.plan.length) {
      lastSearch.set(w, w.time);
      e.plan = nextMove(w, v, e, nearby);
    }
    e.move = e.plan.shift() ?? hold;
    e.left = e.move === hold ? 0.9 : 0.8;
  }
  e.left -= dt;
  if (e.move !== hold && !rollout(w, v, v.body, e.move, 4, e, nearby)) { e.move = hold; e.plan = []; e.left = 0.35; }
  v.ctl.handbrake = e.move === hold;
  v.ctl.throttle = e.move === hold ? 0 : throttle(v.body, e.move.speed);
  v.ctl.steer = e.move.steer;
  return true;
}
