// NPC driving: lane-following traffic with lights, and routed/direct pursuit driving.
import { leaveParking, recovering, startDetour } from './manoeuvres';
import { chooseCurb } from './parking';
import type { Destination } from './commute';
import { angleDiff, clamp } from '../../../shared/math';
import { obbVsObb } from '../../../shared/sim/dynamic';
import { flies } from '../../../shared/sim/kinds';
import { forwardSpeed } from '../../../shared/sim/physics';
import { LANE_W, type RoadNode, type Segment } from '../../../shared/world/cityTypes';
import { groundOf } from '../../../shared/world/levels';
import { rayAabb } from '../../../shared/world/shapes';
import { lightState } from '../../../shared/world/traffic';
import type { DriveState, Ped, Vehicle } from '../entities';
import type { World } from '../world';
import { commitJunction, exitClear, mayEnter, nextJunction, occupiesRoad } from './junctions';
import { findRoute, laneOf, segBetween } from './route';

export function newDrive(w: World, v: Vehicle): DriveState {
  const { seg } = w.map.nearestSegment(v.body.x, v.body.y);
  const c = Math.cos(v.body.angle), s = Math.sin(v.body.angle);
  const dir: 1 | -1 = (seg.axis === 'h' ? c : s) >= 0 ? 1 : -1;
  const P = groundOf(v.body.x, v.body.y);
  const offset = dir * (seg.axis === 'h' ? P.y - seg.y0 : seg.x0 - P.x);
  const lane = clamp(Math.floor(offset / LANE_W), 0, seg.lanes - 1);
  const L = laneOf(w, seg, dir, lane);
  return { merging: seg.parking && offset > seg.lanes * LANE_W, pts: [{ x: L.ex, y: L.ey, stop: L.to.id, lanes: seg.lanes, axis: seg.axis }], seg: seg.id, dir, lane, route: [], routeT: 0, stuckT: 0, reverseT: 0, honkT: 0, blockT: 0, passing: 0, bypassT: 0, yieldT: 0, pullT: 0, why: '' };
}

/** Pulling over for a siren: how far right of the lane line to aim (m), and how long to crawl
 *  across (s) before stopping. */
const PULL_OVER = 2.4;
const PULL_TIME = 3.0;

/** Vehicles with their siren on this tick (worked out once per tick per world). */
const sirenCache = new WeakMap<World, { t: number; list: Vehicle[] }>();
function sirens(w: World): Vehicle[] {
  let c = sirenCache.get(w);
  if (!c || c.t !== w.time) {
    c = { t: w.time, list: [] };
    for (const o of w.vehicles.values()) if (o.siren && !o.wrecked && occupiesRoad(o)) c.list.push(o);
    sirenCache.set(w, c);
  }
  return c.list;
}

/** Is an emergency vehicle with its siren on coming our way: up behind us, or toward us in our road
 *  (whoever drives it, player or not)? One right beside us counts too. Cross streets don't. */
export function sirenApproaching(w: World, v: Vehicle): boolean {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  for (const o of sirens(w)) {
    if (o === v) continue;
    const rx = o.body.x - b.x, ry = o.body.y - b.y;
    const d = Math.hypot(rx, ry);
    if (d > 45) continue;
    if (d < 10) return true;
    const f = rx * c + ry * s, l = -rx * s + ry * c;
    if (Math.abs(l) > 9) continue; // on another street
    const same = Math.cos(o.body.angle) * c + Math.sin(o.body.angle) * s;
    if (f < 0 && same > 0.5) return true; // coming up behind
    if (f > 0 && same < -0.5 && forwardSpeed(o.body) > 1) return true; // oncoming
  }
  return false;
}

/** Appends the next lane (and the turn into it) to the traffic polyline. */
function extend(w: World, d: DriveState, goal?: Destination, avoidExit?: number): void {
  const seg = w.city.segs[d.seg];
  const cur = laneOf(w, seg, d.dir, d.lane);
  const node = cur.to;
  // Not back the way we came (unless it's a dead end).
  let options = node.segs.filter((s) => s !== seg.id);
  if (!options.length) options = [seg.id];
  // Straight on is likeliest.
  // Choose a turn that can be made from this lane. If the road ends, use
  // the available exit instead of inventing a turn across a through lane.
  if (seg.lanes > 1) {
    const legal = options.filter(id => {
      const next = w.city.segs[id];
      if (next.axis === seg.axis) return true;
      const outgoing = laneOf(w, next, next.a === node.id ? 1 : -1, 0);
      const right = cur.hx * outgoing.hy - cur.hy * outgoing.hx > 0;
      return right ? d.lane === seg.lanes - 1 : d.lane === 0;
    });
    if (legal.length) options = legal;
  }
  if (options.length > 1 && avoidExit !== undefined) options = options.filter(id => id !== avoidExit);
  const weights = options.map((s) => (w.city.segs[s].axis === seg.axis ? 2.2 : 1));
  let r = w.rng.next() * weights.reduce((a, b) => a + b, 0);
  let pick = options[0];
  for (let k = 0; k < options.length; k++) { r -= weights[k]; if (r <= 0) { pick = options[k]; break; } }
  if (goal) {
    // Prefer a legal exit leading toward the destination. Only plan when extending the lane path.
    const frontage = goal.parkingStreet ?? goal.street;
    const positive = frontage.axis === 'h' ? goal.pullOver.y > frontage.y0 : goal.pullOver.x < frontage.x0;
    const target = w.city.nodes[positive ? frontage.a : frontage.b];
    const route = findRoute(w, node.id, target.id);
    const desired = route.length > 1 ? segBetween(w, node.id, route[1])?.id : goal.street.id;
    if (desired !== undefined && options.includes(desired)) pick = desired;
    else {
      let best = Infinity;
      for (const id of options) {
        const s = w.city.segs[id];
        const end = w.city.nodes[s.a === node.id ? s.b : s.a];
        const score = Math.abs(end.x - target.x) + Math.abs(end.y - target.y);
        if (score < best) { best = score; pick = id; }
      }
    }
  }
  const next = w.city.segs[pick];
  const ndir: 1 | -1 = next.a === node.id ? 1 : -1;
  const probe = laneOf(w, next, ndir, 0);
  const cross = cur.hx * probe.hy - cur.hy * probe.hx;
  const nlane = cross > 0.5 ? next.lanes - 1 : cross < -0.5 ? 0 : Math.min(d.lane, next.lanes - 1);
  const L = laneOf(w, next, ndir, nlane);
  // Corner control point: where the two lane lines meet.
  let cx: number, cy: number;
  if (next.id === seg.id) { cx = node.x + cur.hx * 4; cy = node.y + cur.hy * 4; }
  else if (seg.axis === next.axis) { cx = (cur.ex + L.sx) / 2; cy = (cur.ey + L.sy) / 2; }
  else if (seg.axis === 'h') { cx = L.sx; cy = cur.ey; }
  else { cx = cur.ex; cy = L.sy; }
  const turn = seg.axis !== next.axis || next.id === seg.id;
  for (const t of [0.35, 0.7]) {
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    d.pts.push({ x: a * cur.ex + b * cx + c * L.sx, y: a * cur.ey + b * cy + c * L.sy, axis: turn ? undefined : seg.axis });
  }
  d.pts.push({ x: L.sx, y: L.sy, axis: turn ? undefined : seg.axis });
  d.pts.push({ x: L.ex, y: L.ey, stop: L.to.id, lanes: next.lanes, axis: next.axis });
  d.seg = next.id; d.dir = ndir; d.lane = nlane;
}

function laneAim(P: { x: number; y: number }, d: DriveState, look: number) {
  const pt = d.pts[0];
  let tx = pt.x, ty = pt.y;
  const d0 = Math.hypot(pt.x - P.x, pt.y - P.y);
  if (pt.stop !== undefined && d0 > look) {
    // Track the lane centre a few metres ahead, even when the stop line is a block away.
    if (pt.axis === 'h') tx = P.x + Math.sign(pt.x - P.x) * look;
    else ty = P.y + Math.sign(pt.y - P.y) * look;
  } else if (d0 < look && d.pts[1]) {
    const n = d.pts[1];
    const segLen = Math.hypot(n.x - pt.x, n.y - pt.y) || 1;
    const t = Math.min(1, (look - d0) / segLen);
    tx = pt.x + (n.x - pt.x) * t; ty = pt.y + (n.y - pt.y) * t;
  }
  return { x: tx, y: ty };
}

/** Follow the upcoming bend when looking for traffic. Projecting a straight line
 * from the bonnet mid-turn can mistake a parked car on the far curb for a queue. */
function laneGap(v: Vehicle, o: Vehicle, points: readonly { x: number; y: number }[], look: number): number {
  const c = Math.cos(o.body.angle), s = Math.sin(o.body.angle);
  const margin = v.spec.width / 2 + 0.12;
  const hl = o.spec.length / 2 + 0.12, hw = o.spec.width / 2 + margin;
  const box = { x0: -hl, x1: hl, y0: -hw, y1: hw, h: 0 };
  let { x, y } = groundOf(v.body.x, v.body.y);
  const obstacle = groundOf(o.body.x, o.body.y);
  let walked = 0;
  for (const pt of points) {
    const dx = pt.x - x, dy = pt.y - y, len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const rx = x - obstacle.x, ry = y - obstacle.y;
    const ax = rx * c + ry * s, ay = -rx * s + ry * c;
    if (Math.abs(ax) <= hl && Math.abs(ay) <= hw && rx * dx + ry * dy < 0) return walked - v.spec.length / 2;
    const hit = rayAabb(ax, ay, dx * c + dy * s, -dx * s + dy * c, box);
    if (hit) return walked + len * hit.t - v.spec.length / 2;
    walked += len;
    if (walked > look) break;
    x = pt.x; y = pt.y;
  }
  return Infinity;
}

/**
 * Speed cap from whatever is in front of the vehicle. `still` = the nearest blocker is a parked,
 * empty or wrecked car (worth driving around); `ped` = someone standing in the road.
 */
function clearance(w: World, v: Vehicle, aggressive: boolean, keepGap = false, points?: readonly { x: number; y: number }[], ignore = 0): { blocker: number; cap: number; ped: boolean; still: boolean; stalled: boolean } {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  const hl = v.spec.length / 2, hw = v.spec.width / 2;
  let blocker = 0, cap = Infinity, ped = false, still = false, stalled = false;
  const look = 14 + Math.abs(forwardSpeed(b)) * 1.1;
  w.vehiclesNear(b.x + c * look / 2, b.y + s * look / 2, look / 2 + 10, (o) => {
    if (o === v || !occupiesRoad(o)) return;
    if (o.id === ignore && Math.hypot(o.body.vx, o.body.vy) < 0.5) return;
    const rx = o.body.x - b.x, ry = o.body.y - b.y;
    const f = rx * c + ry * s, l = -rx * s + ry * c;
    const heading = o.body.angle - b.angle;
    const cos = Math.abs(Math.cos(heading)), sin = Math.abs(Math.sin(heading));
    const halfLength = (o.spec.length * cos + o.spec.width * sin) / 2;
    const halfWidth = (o.spec.width * cos + o.spec.length * sin) / 2;
    if (!points && (f <= 0 || f > look + halfLength || Math.abs(l) > hw + halfWidth + 0.12)) return;
    const gap = points ? laneGap(v, o, points, look) : f - hl - halfLength;
    if (gap > look) return;
    const parallel = Math.cos(heading) > 0.7;
    const standstillGap = parallel && (!aggressive || keepGap) ? 2 : 0.45;
    const leadSpeed = Math.max(0, o.body.vx * c + o.body.vy * s);
    // Follow the leader at a time gap and brake early when closing on a queue.
    const space = Math.max(0, gap - standstillGap);
    const cc = Math.min(space / 1.15, Math.sqrt(leadSpeed * leadSpeed + 8 * space));
    if (cc < cap) {
      blocker = o.id; cap = cc;
      // Worth going around: parked/empty/wrecked cars, or a driven car stalled for no reason
      // (not one patiently queuing at a light or junction).
      still = Math.hypot(o.body.vx, o.body.vy) < 0.5 && (o.wrecked || o.burning >= 0 || !o.seats[0] || o.idleT > 8);
      // Someone sitting at the wheel in the road for no reason: the one car worth honking at.
      stalled = still && !!o.seats[0] && !o.wrecked && o.burning < 0;
    }
  });
  if (!aggressive) {
    w.pedsNear(b.x + c * 7, b.y + s * 7, 9, (o) => {
      // Only people actually in the road count; corner sidewalks don't stop traffic.
      if (o.vehicle || o.dead || !w.map.onRoad(o.body.x, o.body.y)) return;
      const rx = o.body.x - b.x, ry = o.body.y - b.y;
      const f = rx * c + ry * s, l = -rx * s + ry * c;
      if (f <= 0 || f > hl + 9 || Math.abs(l) > hw + 1) return;
      const pc = Math.max(0, (f - hl - 2.5) * 0.8);
      if (pc < cap) { cap = pc; ped = true; still = false; stalled = false; }
    });
  }
  return { blocker, cap, ped, still, stalled };
}

/** When turning past a stopped vehicle, the padded following corridor can overlap
 * its corner even though there is room for our wheels to straighten out. Check
 * the actual footprints a metre ahead before allowing a walking-speed creep. */
function canCreep(w: World, v: Vehicle, blocker: Vehicle): boolean {
  const b = v.body, dx = blocker.body.x - b.x, dy = blocker.body.y - b.y;
  const across = Math.abs(dy * Math.cos(b.angle) - dx * Math.sin(b.angle));
  if (across < (v.spec.width + blocker.spec.width) / 2 - 0.2) return false;

  let clear = true;
  w.vehiclesNear(b.x, b.y, v.spec.length / 2 + 12, o => {
    if (!clear || o === v || !occupiesRoad(o)) return;
    const other = { x: o.body.x, y: o.body.y, angle: o.body.angle, hl: o.spec.length / 2, hw: o.spec.width / 2 };
    for (const distance of [0, 0.6, 1.2]) {
      const heading = b.angle;
      const probe = { x: b.x + distance * Math.cos(heading), y: b.y + distance * Math.sin(heading),
        angle: heading, hl: v.spec.length / 2 + 0.12, hw: v.spec.width / 2 + 0.12 };
      if (obbVsObb(probe, other)) { clear = false; break; }
    }
  });
  return clear;
}

/** Is the lane to the left (oncoming side) free of traffic for an overtake? */
function laneClear(w: World, v: Vehicle): boolean {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  // Centre of the left lane, a bit ahead of us.
  const lx = b.x + s * 3.8 + c * 10, ly = b.y - c * 3.8 + s * 10;
  let ok = true;
  w.vehiclesNear(lx, ly, 26, (o) => {
    if (!ok || o === v || !occupiesRoad(o)) return;
    const rx = o.body.x - b.x, ry = o.body.y - b.y;
    const f = rx * c + ry * s, l = -rx * s + ry * c;
    if (l < -6 || l > -1.5 || f < -6 || f > 32) return; // only the left lane, beside and ahead
    ok = false;
  });
  return ok && !w.statics.raycast(b.x, b.y, lx, ly, 1);
}

/** Is there a gap long enough to borrow the opposing lane and merge back in?
 * Work in road coordinates: a truck can be angled across the line during the pass. */
function opposingLaneClear(w: World, v: Vehicle, obstacle: Vehicle, ax: number, ay: number,
  lane: { x: number; y: number }, ahead: number, reach: number): boolean {
  const end = Math.max(0, ahead + reach) + v.spec.length + 3;
  const seconds = 2 + end / 3;
  for (const other of w.vehicles.values()) {
    if (other === v || other === obstacle || !occupiesRoad(other)) continue;
    const { x, y, angle, vx, vy } = other.body;
    const along = (x - v.body.x) * ax + (y - v.body.y) * ay;
    const across = (x - lane.x) * ay - (y - lane.y) * ax;
    const c = Math.cos(angle) * ax + Math.sin(angle) * ay;
    const s = Math.sin(angle) * ax - Math.cos(angle) * ay;
    const hl = (Math.abs(c) * other.spec.length + Math.abs(s) * other.spec.width) / 2;
    const hw = (Math.abs(s) * other.spec.length + Math.abs(c) * other.spec.width) / 2;
    if (across + hw < LANE_W / 2 || across - hw > 1.5 * LANE_W) continue;
    const future = along + (vx * ax + vy * ay) * seconds;
    if (Math.max(along, future) + hl > -v.spec.length / 2 - 1 && Math.min(along, future) - hl < end) {
      return false;
    }
  }
  return true;
}

/** Steers toward a ground point (world/levels.ts: measured over the map). */
function steerTo(v: Vehicle, tx: number, ty: number, speed: number): void {
  const b = v.body;
  const P = groundOf(b.x, b.y);
  const want = Math.atan2(ty - P.y, tx - P.x);
  let diff = angleDiff(b.angle, want);
  const vf = forwardSpeed(b);
  const backing = speed < 0;
  if (backing) diff = angleDiff(b.angle + Math.PI, want);
  v.ctl.steer = clamp(diff * 2.4, -1, 1) * (backing ? -1 : 1);
  if (speed >= 0 && speed < 0.25) speed = 0;
  const dv = speed - vf;
  if (speed === 0 && Math.abs(vf) < 0.6) { v.ctl.throttle = 0; v.ctl.handbrake = true; return; }
  v.ctl.handbrake = false;
  // Coast through small speed overshoots. Real stops still brake down to a hold.
  if (speed > 0 && dv <= 0 && dv > -0.9) v.ctl.throttle = 0;
  else v.ctl.throttle = clamp(dv * (dv > 0 ? 0.45 : 0.5), -1, 1);
}

/** Handles being wedged: back up with opposite lock for a moment. */
function unstick(w: World, v: Vehicle, d: DriveState, wanted: number, dt: number): boolean {
  if (d.reverseT > 0) {
    d.reverseT -= dt;
    const c = Math.cos(v.body.angle), s = Math.sin(v.body.angle);
    const rear = v.spec.length / 2 + 2;
    let clear = true;
    w.vehiclesNear(v.body.x - rear * c, v.body.y - rear * s, rear + 7, o => {
      if (o === v || !occupiesRoad(o)) return;
      const dx = o.body.x - v.body.x, dy = o.body.y - v.body.y;
      const along = -(dx * c + dy * s), across = Math.abs(-dx * s + dy * c);
      if (along > 0 && along < rear + o.spec.length / 2 && across < (v.spec.width + o.spec.width) / 2 + 0.6) clear = false;
    });
    w.pedsNear(v.body.x - rear * c, v.body.y - rear * s, rear + 2, p => {
      const dx = p.body.x - v.body.x, dy = p.body.y - v.body.y;
      if (!p.vehicle && !p.dead && dx * c + dy * s < 0 && Math.abs(dx * s - dy * c) < v.spec.width / 2 + 0.7) clear = false;
    });
    if (!clear) { v.ctl.throttle = 0; v.ctl.handbrake = true; return true; }
    v.ctl.throttle = -0.8;
    // Hold the chosen lock through recovery; flipping it every tick cancels the turn.
    if (d.reverseT + dt >= 1.3) v.ctl.steer = -v.ctl.steer || 0.6;
    v.ctl.handbrake = false;
    return true;
  }
  if (wanted > 2 && Math.abs(forwardSpeed(v.body)) < 0.6) d.stuckT += dt; else d.stuckT = 0;
  if (d.stuckT > 2.5) { d.stuckT = 0; d.reverseT = 1.3; }
  return false;
}

/** Red: stop. Amber: stop if you comfortably can (≤ 4 m/s² to the line), otherwise go on through.
 *  Green (or an unsignalled junction): go. */
function mustStop(node: RoadNode, axis: 'h' | 'v', t: number, dist: number, vf: number): boolean {
  const st = lightState(node, axis, t);
  if (st === 2) return false;
  if (st === 0) return true;
  return dist - 1 > (vf * vf) / (2 * 4);
}

/** Ordinary traffic: follow lanes, obey lights, keep distance. */
export function cruise(w: World, v: Vehicle, p: Ped, dt: number, panic = false, goal?: Destination): void {
  const ai = p.ai!;
  if (v.departureBay !== undefined) {
    if (leaveParking(w, v, dt)) return;
    ai.drive = null;
  }
  if (!ai.drive) ai.drive = newDrive(w, v);
  const d = ai.drive;
  if (recovering(w, v, d, dt)) return;
  const b = v.body;
  // The lane points are ground coordinates.
  const P = groundOf(b.x, b.y);
  while (d.pts.length < 5) extend(w, d, goal);
  const vf = forwardSpeed(b);
  const junction = nextJunction(w, d);
  const blockedEntry = junction && Math.hypot(junction.at.x - P.x, junction.at.y - P.y) < 22
    && !mayEnter(w, v, junction.node, junction.axis, junction.exit, panic);
  if (blockedEntry && junction?.at === d.pts[0] && Math.abs(vf) < 0.6) {
    d.junctionWait = (d.junctionWait ?? 0) + dt;
    if (d.junctionWait >= 10 && junction.exit && !exitClear(w, v, junction.node, junction.exit)) {
      d.junctionWait = 0;
      const approach = newDrive(w, v);
      if (approach.pts[0].stop === junction.node.id) {
        const blockedSeg = w.map.nearestSegment(junction.exit.x, junction.exit.y).seg.id;
        extend(w, approach, goal, blockedSeg);
        const alternate = nextJunction(w, approach);
        if (alternate?.exit && exitClear(w, v, junction.node, alternate.exit)) {
          ai.drive = approach;
          // Recheck the new turn's right of way on the next tick.
          v.ctl.throttle = 0; v.ctl.handbrake = true;
          return;
        }
      }
    }
  } else d.junctionWait = 0;
  // Drop points we've reached or passed, except a stop line whose light still says stop: a car
  // waiting a few metres short of it must not lose it and roll through the red.
  for (let k = 0; k < 3 && d.pts.length; k++) {
    const pt = d.pts[0];
    const dx = pt.x - P.x, dy = pt.y - P.y;
    const dd = Math.hypot(dx, dy);
    const ahead = dx * Math.cos(b.angle) + dy * Math.sin(b.angle);
    // A stop line only counts as passed once you're clearly into the junction: a car stopped
    // at the line in a neighbouring lane has the point beside it, not behind it.
    const passed = pt.stop !== undefined ? ahead < -2 && dd < 10 : ahead < 0 && dd < 10;
    if (pt === junction?.at && blockedEntry) break;
    if (!passed && pt.stop !== undefined && !panic && mustStop(w.city.nodes[pt.stop], pt.axis!, w.time, Math.max(0, ahead), vf)) break;
    if (dd >= 2 + Math.abs(vf) * 0.12 && !passed) break;
    if (pt.stop !== undefined) commitJunction(w, v, w.city.nodes[pt.stop]);
    d.pts.shift();
  }
  if (d.pts.length < 5) extend(w, d, goal);
  const laneCount = d.pts.find(pt => pt.stop !== undefined)?.lanes ?? 1;
  let target = panic ? 18 : laneCount > 1 ? 16 : 11.5;
  target = Math.min(target, v.spec.maxSpeed * 0.8);
  // Slow for turns ahead.
  let pathDistance = 0, lastX = P.x, lastY = P.y;
  for (const pt of d.pts) {
    pathDistance += Math.hypot(pt.x - lastX, pt.y - lastY);
    if (pathDistance > 45) break;
    if (!pt.axis) {
      const bendSpeed = panic ? 9 : v.spec.minTurnRadius ? 4 : 6;
      target = Math.min(target, Math.sqrt(bendSpeed ** 2 + 6 * Math.max(0, pathDistance - 6)));
      break;
    }
    lastX = pt.x; lastY = pt.y;
  }
  // Lights.
  let red = false;
  if (!panic) {
    let dist = 0, x = P.x, y = P.y;
    for (const pt of d.pts.slice(0, 4)) {
      dist += Math.hypot(pt.x - x, pt.y - y);
      x = pt.x; y = pt.y;
      if (pt.stop === undefined) continue;
      const node = w.city.nodes[pt.stop];
      // Measure around the turn: a red signal on the next block is still far away.
      if (mustStop(node, pt.axis!, w.time, dist, vf)) {
        // Brake to stop on the line (5 m/s² comfortable), then hold.
        target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, dist - Math.max(1, v.spec.length / 2))));
        red = target < 2;
      }
      break;
    }
  }
  // Junction right-of-way (lights already handled): wait at the line if the box isn't ours.
  let yielding = false;
  if (junction && blockedEntry) {
    const distance = Math.hypot(junction.at.x - P.x, junction.at.y - P.y);
    target = Math.min(target, Math.sqrt(8 * Math.max(0, distance - Math.max(2, v.spec.length / 2 + 0.5))));
    yielding = true;
  }
  // Spooked drivers ignore people in the road but still keep a gap to the car ahead.
  const pt = d.pts[0];
  const look = pt.axis ? 4.5 + Math.abs(vf) * 0.35 : 2.8 + Math.abs(vf) * 0.15;
  const aim = laneAim(P, d, look);
  const path = pt.stop !== undefined && Math.hypot(pt.x - P.x, pt.y - P.y) > look ? [aim, ...d.pts] : d.pts;
  let clear = clearance(w, v, panic, true, d.bypassT > 0 ? undefined : path, d.bypassT > 0 ? d.passing : 0);
  // Prefer a small within-lane adjustment. On a two-way street, a wider vehicle
  // can borrow the opposing lane if it can clear the obstruction and merge before the junction.
  const curbPass = w.vehicles.get(d.curbBlocker ?? clear.blocker);
  if (curbPass && pt.stop !== undefined && !v.parkingTarget &&
      Math.hypot(curbPass.body.vx, curbPass.body.vy) < 0.5) {
    const horizontal = pt.axis === 'h';
    const dir = Math.sign(horizontal ? Math.cos(b.angle) : Math.sin(b.angle));
    const right = dir * (horizontal ? curbPass.body.y - pt.y : pt.x - curbPass.body.x);
    const ahead = dir * (horizontal ? curbPass.body.x - P.x : curbPass.body.y - P.y);
    const reach = (curbPass.spec.length + v.spec.length) / 2 + 1;
    const ax = horizontal ? dir : 0, ay = horizontal ? 0 : dir;
    const angle = curbPass.body.angle - Math.atan2(ay, ax);
    const width = Math.abs(Math.sin(angle)) * curbPass.spec.length + Math.abs(Math.cos(angle)) * curbPass.spec.width;
    const ownLane = (LANE_W - v.spec.width) / 2 - 0.12;
    const needed = (v.spec.width + width) / 2 + 0.65 - right;
    const borrowing = needed > ownLane && pt.lanes === 1;
    const offset = borrowing ? Math.min(LANE_W, Math.max(LANE_W * 0.65, needed)) : ownLane;
    const curbObstruction = !curbPass.seats[0] || (right > LANE_W * 0.35 && Math.abs(Math.sin(angle)) > 0.15);
    const room = Math.hypot(pt.x - P.x, pt.y - P.y) - ahead - reach;
    const gap = !borrowing || opposingLaneClear(w, v, curbPass, ax, ay, pt, ahead, reach);
    if (curbObstruction && right >= 0 && needed < LANE_W && offset > 0 && ahead > -reach && ahead < 18 &&
        room > (borrowing ? v.spec.length / 2 + 2 : 0) && (gap || d.curbBlocker === curbPass.id)) {
      const shifted = { x: aim.x + ay * offset, y: aim.y - ax * offset };
      const beyond = { x: shifted.x + ax * (look + reach), y: shifted.y + ay * (look + reach) };
      const alternate = clearance(w, v, panic, true, [shifted, beyond]);
      if (alternate.cap > clear.cap || (d.curbBlocker === curbPass.id && alternate.cap > 0.3)) {
        d.curbBlocker = curbPass.id;
        if (borrowing) d.borrowedLane = true;
        aim.x = shifted.x; aim.y = shifted.y;
        clear = alternate;
        target = Math.min(target, gap ? 4 : 0);
      } else delete d.curbBlocker;
    } else delete d.curbBlocker;
  } else delete d.curbBlocker;
  // Finish the merge at passing speed, even if the next waypoint starts a turn.
  if (d.borrowedLane && !d.curbBlocker) {
    if (pt.stop === undefined) delete d.borrowedLane;
    else {
      const horizontal = pt.axis === 'h';
      const across = horizontal ? pt.y - P.y : pt.x - P.x;
      if (Math.abs(across) < 0.25) delete d.borrowedLane;
      else {
        const dir = Math.sign(horizontal ? Math.cos(b.angle) : Math.sin(b.angle));
        aim.x = horizontal ? P.x + dir * 4 : pt.x;
        aim.y = horizontal ? pt.y : P.y + dir * 4;
        clear = clearance(w, v, panic, true, [aim, ...d.pts]);
        target = Math.min(target, 4);
      }
    }
  }
  // A siren coming: ease over to the kerb at a crawl, stop there, and stay put until it's been gone
  // a few seconds. Fleeing drivers and other emergency vehicles don't.
  if (!panic && !v.spec.siren && sirenApproaching(w, v)) d.yieldT = 3;
  else d.yieldT = Math.max(0, d.yieldT - dt);
  const pulling = d.yieldT > 0;
  if (pulling) { d.pullT += dt; d.bypassT = 0; } else d.pullT = 0;
  const held = red || yielding || pulling;
  const blocker = w.vehicles.get(clear.blocker);
  const creeping = !held && !clear.ped && clear.cap < 1 && vf < 1.5 && blocker && canCreep(w, v, blocker);
  if (creeping) clear.cap = 1.2;
  // Overtakes crawl past (bumps under ~4 m/s do no damage).
  const roadSpeed = target;
  if (d.bypassT > 0) { d.bypassT -= dt; target = Math.min(target, 4, clear.cap); }
  else target = Math.min(target, clear.cap);
  if (pulling) target = Math.min(target, d.pullT < PULL_TIME ? 4 : 0);
  // Horn only when it's called for: a person standing in the road, or a driver stopped in it for
  // no reason, after a moment's wait; then a long pause before the next. Never at a queue, a light
  // or an empty/wrecked car. honkT counts up while there's cause, and below zero is the pause.
  const blocked = (clear.ped || clear.cap < 1) && vf < 1 && !held;
  if (blocked && (clear.ped || clear.stalled) && clear.cap < 1.5) {
    d.honkT += dt;
    if (d.honkT > 1.5) { d.honkT = -(8 + (v.id % 5)); v.horn = true; }
  } else d.honkT = Math.min(0, d.honkT + dt);
  const first = d.pts[0];
  // Pass only on a straight with a marked same-direction lane to our left.
  const canPass = first.stop !== undefined && (first.axis === 'h'
    ? Math.abs(P.y - w.city.nodes[first.stop].y)
    : Math.abs(P.x - w.city.nodes[first.stop].x)) > LANE_W
    && Math.hypot(first.x - P.x, first.y - P.y) > 22;
  if (blocked) {
    d.blockT += dt;
    // A car can be nudged diagonally across the parking strip after starting
    // its normal route. Recover using the nearby parked vehicle's frontage.
    if (d.blockT > 3 && !v.parkingTarget && !v.spec.trailer && v.spec.movement === 'wheels' &&
        blocker && !blocker.seats[0] && blocker.spot >= 0 && Math.abs(vf) < 0.6) {
      const bay = w.city.parking[blocker.spot];
      if (bay && Math.hypot(b.x - bay.x, b.y - bay.y) < 9 && Math.abs(Math.sin(b.angle - bay.angle)) > 0.16 &&
          (bay.lot !== undefined || (pt.axis && Math.abs(pt.axis === 'h' ? b.y - pt.y : b.x - pt.x) > 0.9))) {
        v.departureBay = blocker.spot;
        return;
      }
    }
    // Two occupied cars wedged at different angles can also negotiate a gap.
    // Only one starts the manoeuvre, and a driver waiting for priority keeps it.
    const otherDrive = blocker && w.peds.get(blocker.seats[0])?.ai?.drive;
    const crossed = blocker && otherDrive && v.id < blocker.id && otherDrive.why === 'car' &&
      Math.hypot(blocker.body.vx, blocker.body.vy) < 0.5 && Math.abs(Math.sin(b.angle - blocker.body.angle)) > 0.25;
    if (d.blockT > 4 && blocker && ((!blocker.seats[0] && clear.still) || crossed) && !clear.ped && pt.axis &&
        !v.parkingTarget && v.spec.movement === 'wheels' && !v.spec.trailer) {
      const dir = Math.sign(pt.axis === 'h' ? pt.x - P.x : pt.y - P.y);
      const ax = pt.axis === 'h' ? dir : 0, ay = pt.axis === 'v' ? dir : 0;
      const ahead = (blocker.body.x - P.x) * ax + (blocker.body.y - P.y) * ay;
      if (pt.lanes !== 1 || opposingLaneClear(w, v, blocker, ax, ay, pt, ahead, (v.spec.length + blocker.spec.length) / 2)) {
        startDetour(w, v, d, blocker);
        d.blockT = 0;
      }
    }
    // A stationary obstruction can be passed in a clear adjacent travel lane.
    const wait = clear.still ? 2 : Infinity; // never pass someone waiting in traffic or a pedestrian
    if (d.blockT > wait && canPass && laneClear(w, v)) { d.blockT = 0; d.passing = clear.blocker; d.bypassT = 3.5; }
  } else d.blockT = Math.max(0, d.blockT - dt);
  // Spooked drivers don't wait: when actually blocked they swerve around (if there's room) and go.
  if (panic && clear.still && canPass && clear.cap < 1.5 && vf < 3 && d.bypassT <= 0 && laneClear(w, v)) { d.passing = clear.blocker; d.bypassT = 2; }
  d.why = pulling ? 'siren' : d.reverseT > 0 ? 'reverse' : d.bypassT > 0 ? 'bypass' : red ? 'light' : yielding ? 'junction' : clear.ped && clear.cap < 2 ? 'ped' : clear.cap < 2 ? 'car' : 'free';
  if (unstick(w, v, d, target, dt)) return;
  // Apply the passing or pull-over offset to the lane target.

  let { x: tx, y: ty } = aim;
  if (d.bypassT > 0) {
    // Offset into the adjacent passing lane.
    tx += Math.sin(b.angle) * 3.8; ty -= Math.cos(b.angle) * 3.8;
  } else if (pulling) {
    // Over toward the kerb: aim a fixed distance right of the lane line (on a straight, the lane's
    // own direction; mid-turn, our heading), so the car settles there clear of the lane.
    const ax = pt.axis === 'h' ? Math.sign(Math.cos(b.angle)) || 1 : pt.axis === 'v' ? 0 : Math.cos(b.angle);
    const ay = pt.axis === 'v' ? Math.sign(Math.sin(b.angle)) || 1 : pt.axis === 'h' ? 0 : Math.sin(b.angle);
    // A few metres ahead of where we are along the lane line (not its far end), then to the right.
    const along = (P.x - pt.x) * ax + (P.y - pt.y) * ay;
    tx = pt.x + ax * (along + 6) - ay * PULL_OVER;
    ty = pt.y + ay * (along + 6) + ax * PULL_OVER;
  }
  if (v.parkingTarget?.lot !== goal?.lot || panic) delete v.parkingTarget;
  if (goal && !held && !d.borrowedLane && pt.axis && Math.hypot(P.x - goal.pullOver.x, P.y - goal.pullOver.y) < 55) {
    const spot = v.parkingTarget = chooseCurb(w, v, goal);
    if (spot) {
      tx = spot.x; ty = spot.y;
      // Check the path into the reserved bay. A queue further along the travel
      // lane can remain stopped for the entire duration of a valid pull-in.
      const approach = clearance(w, v, panic, true, [spot]);
      target = Math.min(roadSpeed, approach.cap, 4, Math.sqrt(5 * Math.max(0, Math.hypot(tx - P.x, ty - P.y) - 0.5)));
    }
  }
  if (d.merging && pt.axis) {
    const horizontal = pt.axis === 'h';
    const across = horizontal ? pt.y - P.y : pt.x - P.x;
    if (Math.abs(across) < 0.45) d.merging = false;
    else {
      const direction = Math.sign(horizontal ? pt.x - P.x : pt.y - P.y);
      let approaching = false;
      w.vehiclesNear(P.x, P.y, 28, other => {
        if (other === v || !occupiesRoad(other)) return;
        const lateral = horizontal ? other.body.y - pt.y : other.body.x - pt.x;
        const behind = direction * (horizontal ? P.x - other.body.x : P.y - other.body.y);
        const speed = direction * (horizontal ? other.body.vx : other.body.vy);
        if (Math.abs(lateral) < (other.spec.width + v.spec.width) / 2 && speed > 0.5 &&
            behind >= 0 && behind < (v.spec.length + other.spec.length) / 2 + speed * 1.5) approaching = true;
      });
      if (approaching) target = 0;
      else target = Math.min(target, 4);
    }
  }
  steerTo(v, tx, ty, target);
  if (creeping && !d.curbBlocker && !v.parkingTarget) v.ctl.steer = 0;
}

interface DriveGoal { stopAt: number; ram: boolean; speed?: number; frontage?: Segment }

/** Routed driving toward a point, switching to a straight line when close. */
export function driveTo(w: World, v: Vehicle, p: Ped, tx: number, ty: number, dt: number, opts: DriveGoal): number {
  const ai = p.ai!;
  if (!ai.drive) ai.drive = newDrive(w, v);
  return routeTo(w, v, ai.drive, tx, ty, dt, opts);
}

/** driveTo for whatever holds the route state (an AI driver, or a riderless horse called home). */
export function routeTo(w: World, v: Vehicle, d: DriveState, tx: number, ty: number, dt: number, opts: DriveGoal): number {
  const b = v.body;
  // Positions compared over the ground (world/levels.ts).
  const P = groundOf(b.x, b.y), T = groundOf(tx, ty);
  const dist = Math.hypot(T.x - P.x, T.y - P.y);
  if (flies(v.spec)) return flyTo(w, v, T.x, T.y, opts.stopAt, dt);
  const fast = opts.speed ?? Math.min(v.spec.maxSpeed * 0.92, 30);
  const clear = clearance(w, v, true);
  // A shop can be halfway down a long block. Once on its street (including
  // either end junction), the entrance is the destination, even beyond 45 m.
  const street = opts.frontage;
  const half = street ? street.width / 2 : 0;
  const onFrontage = street && P.x >= street.x0 - half && P.x <= street.x1 + half
    && P.y >= street.y0 - half && P.y <= street.y1 + half;
  if ((dist < 45 || onFrontage) && P.f === T.f && !w.statics.raycast(b.x, b.y, tx, ty, 1)) {
    let target = dist <= opts.stopAt ? 0 : opts.ram ? fast : Math.min(fast, Math.sqrt(2 * 8 * Math.max(0, dist - opts.stopAt)));
    if (!opts.ram) target = Math.min(target, clear.cap + 2);
    if (unstick(w, v, d, Math.max(target, 3), dt)) return dist;
    steerTo(v, T.x, T.y, target);
    return dist;
  }
  d.routeT -= dt;
  if (d.routeT <= 0 || !d.route.length) {
    d.routeT = 2;
    const from = w.map.nearestNode(b.x, b.y), to = w.map.nearestNode(tx, ty);
    d.route = findRoute(w, from.id, to.id);
    // Skip the first node if we're already past it.
    if (d.route.length > 1) {
      const n0 = w.city.nodes[d.route[0]], n1 = w.city.nodes[d.route[1]];
      const ahead = (n0.x - P.x) * Math.cos(b.angle) + (n0.y - P.y) * Math.sin(b.angle);
      if (ahead < 0 && Math.hypot(n1.x - P.x, n1.y - P.y) < Math.hypot(n1.x - n0.x, n1.y - n0.y) + 10) d.route.shift();
    }
  }
  let gx = T.x, gy = T.y;
  if (d.route.length) {
    const n = w.city.nodes[d.route[0]];
    if (Math.hypot(n.x - P.x, n.y - P.y) < 9 && d.route.length > 1) d.route.shift();
    const cur = w.city.nodes[d.route[0]];
    const nxt = d.route[1] !== undefined ? w.city.nodes[d.route[1]] : null;
    gx = cur.x; gy = cur.y;
    // Keep to the right-hand lane of the segment ahead.
    const seg = nxt ? segBetween(w, cur.id, nxt.id) : null;
    if (seg && nxt) {
      const hx = Math.sign(nxt.x - cur.x), hy = Math.sign(nxt.y - cur.y);
      gx += -hy * 1.8; gy += hx * 1.8;
    }
  }
  const turnAhead = Math.abs(angleDiff(b.angle, Math.atan2(gy - P.y, gx - P.x))) > 0.5;
  let target = turnAhead && Math.hypot(gx - P.x, gy - P.y) < 30 ? 10 : fast;
  // A corner at the junction we're coming up to: brake for it before we get there, not in it.
  if (d.route.length > 1) {
    const n0 = w.city.nodes[d.route[0]], n1 = w.city.nodes[d.route[1]];
    const toNode = Math.hypot(n0.x - P.x, n0.y - P.y);
    const bend = Math.abs(angleDiff(b.angle, Math.atan2(n1.y - n0.y, n1.x - n0.x)));
    if (bend > 0.7 && toNode < 28) target = Math.min(target, 6 + toNode * 0.25);
  }
  target = Math.min(target, clear.cap + 4);
  // Lights and siren on: traffic pulls over to the right, so go by on the left when it's clear.
  if (v.siren && clear.cap < 10 && !turnAhead && laneClear(w, v)) {
    gx += Math.sin(b.angle) * 3.6; gy -= Math.cos(b.angle) * 3.6;
    target = Math.max(target, Math.min(fast, 13));
  }
  if (unstick(w, v, d, Math.max(target, 3), dt)) return dist;
  steerTo(v, gx, gy, target);
  return dist;
}

/** Helicopter flight: climb, turn toward target, hover at a standoff distance. */
export function flyTo(w: World, v: Vehicle, tx: number, ty: number, standoff: number, dt: number): number {
  const b = v.body;
  const dist = Math.hypot(tx - b.x, ty - b.y);
  const cruiseAlt = 32;
  v.ctl.up = b.alt < cruiseAlt - 2;
  v.ctl.down = b.alt > cruiseAlt + 4;
  if (b.alt < 6) { v.ctl.throttle = 0; v.ctl.steer = 0; return dist; }
  const want = Math.atan2(ty - b.y, tx - b.x);
  v.ctl.steer = clamp(angleDiff(b.angle, want) * 1.8, -1, 1);
  const closing = dist - standoff;
  v.ctl.throttle = clamp(closing / 25, -0.6, 1) * (Math.abs(angleDiff(b.angle, want)) < 1.2 ? 1 : 0.2);
  void dt;
  return dist;
}
