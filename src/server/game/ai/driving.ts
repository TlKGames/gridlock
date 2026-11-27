// NPC driving: lane-following traffic with lights, and routed/direct pursuit driving.
import { angleDiff, clamp } from '../../../shared/math';
import { flies } from '../../../shared/sim/kinds';
import { forwardSpeed } from '../../../shared/sim/physics';
import type { RoadNode } from '../../../shared/world/cityTypes';
import { groundOf } from '../../../shared/world/levels';
import { lightState } from '../../../shared/world/traffic';
import type { DriveState, Ped, Vehicle } from '../entities';
import type { World } from '../world';
import { mayEnter, nextJunction } from './junctions';
import { findRoute, laneOf, segBetween } from './route';

export function newDrive(w: World, v: Vehicle): DriveState {
  const { seg } = w.map.nearestSegment(v.body.x, v.body.y);
  const c = Math.cos(v.body.angle), s = Math.sin(v.body.angle);
  const dir: 1 | -1 = (seg.axis === 'h' ? c : s) >= 0 ? 1 : -1;
  const lane = seg.lanes > 1 && w.rng.chance(0.5) ? 1 : 0;
  const L = laneOf(w, seg, dir, lane);
  return { pts: [{ x: L.ex, y: L.ey, stop: L.to.id, axis: seg.axis }], seg: seg.id, dir, lane, route: [], routeT: 0, stuckT: 0, reverseT: 0, honkT: 0, blockT: 0, bypassT: 0, yieldT: 0, pullT: 0, why: '' };
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
    for (const o of w.vehicles.values()) if (o.siren && !o.wrecked && !(flies(o.spec) && o.body.alt > 2)) c.list.push(o);
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
function extend(w: World, d: DriveState): void {
  const seg = w.city.segs[d.seg];
  const cur = laneOf(w, seg, d.dir, d.lane);
  const node = cur.to;
  // Not back the way we came (unless it's a dead end).
  let options = node.segs.filter((s) => s !== seg.id);
  if (!options.length) options = [seg.id];
  // Straight on is likeliest.
  const weights = options.map((s) => (w.city.segs[s].axis === seg.axis ? 2.2 : 1));
  let r = w.rng.next() * weights.reduce((a, b) => a + b, 0);
  let pick = options[0];
  for (let k = 0; k < options.length; k++) { r -= weights[k]; if (r <= 0) { pick = options[k]; break; } }
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
  d.pts.push({ x: L.sx, y: L.sy });
  d.pts.push({ x: L.ex, y: L.ey, stop: L.to.id, axis: next.axis });
  d.seg = next.id; d.dir = ndir; d.lane = nlane;
}

/**
 * Speed cap from whatever is in front of the vehicle. `still` = the nearest blocker is a parked,
 * empty or wrecked car (worth driving around); `ped` = someone standing in the road.
 */
function clearance(w: World, v: Vehicle, aggressive: boolean, keepGap = false): { cap: number; ped: boolean; still: boolean; stalled: boolean } {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  const hl = v.spec.length / 2, hw = v.spec.width / 2;
  let cap = Infinity, ped = false, still = false, stalled = false;
  const look = 14 + Math.abs(forwardSpeed(b)) * 1.1;
  w.vehiclesNear(b.x + c * look / 2, b.y + s * look / 2, look / 2 + 10, (o) => {
    if (o === v || (flies(o.spec) && o.body.alt > 2)) return;
    const rx = o.body.x - b.x, ry = o.body.y - b.y;
    const f = rx * c + ry * s, l = -rx * s + ry * c;
    if (f <= 0 || f > look + o.spec.length || Math.abs(l) > hw + o.spec.width / 2 + 0.6) return;
    const gap = f - hl - o.spec.length / 2;
    const cc = Math.max(0, (gap - (aggressive && !keepGap ? 1 : 2.5)) * 1.1);
    if (cc < cap) {
      cap = cc;
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
      if (o.dead || !w.map.onRoad(o.body.x, o.body.y)) return;
      const rx = o.body.x - b.x, ry = o.body.y - b.y;
      const f = rx * c + ry * s, l = -rx * s + ry * c;
      if (f <= 0 || f > hl + 9 || Math.abs(l) > hw + 1) return;
      const pc = Math.max(0, (f - hl - 2.5) * 0.8);
      if (pc < cap) { cap = pc; ped = true; still = false; stalled = false; }
    });
  }
  return { cap, ped, still, stalled };
}

/** Is the lane to the left (oncoming side) free of traffic for an overtake? */
function laneClear(w: World, v: Vehicle): boolean {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  // Centre of the left lane, a bit ahead of us.
  const lx = b.x + s * 3.8 + c * 10, ly = b.y - c * 3.8 + s * 10;
  let ok = true;
  w.vehiclesNear(lx, ly, 26, (o) => {
    if (!ok || o === v) return;
    const rx = o.body.x - b.x, ry = o.body.y - b.y;
    const f = rx * c + ry * s, l = -rx * s + ry * c;
    if (l < -6 || l > -1.5 || f < -6 || f > 32) return; // only the left lane, beside and ahead
    ok = false;
  });
  return ok && !w.statics.raycast(b.x, b.y, lx, ly, 1);
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
  const dv = speed - vf;
  if (speed === 0 && Math.abs(vf) < 0.6) { v.ctl.throttle = 0; v.ctl.handbrake = true; return; }
  v.ctl.handbrake = false;
  v.ctl.throttle = dv > 0 ? clamp(dv * 0.45, 0.15, 1) : clamp(dv * 0.5, -1, -0.05);
}

/** Handles being wedged: back up with opposite lock for a moment. */
function unstick(v: Vehicle, d: DriveState, wanted: number, dt: number): boolean {
  if (d.reverseT > 0) {
    d.reverseT -= dt;
    v.ctl.throttle = -0.8;
    v.ctl.steer = -v.ctl.steer || 0.6;
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
export function cruise(w: World, v: Vehicle, p: Ped, dt: number, panic = false): void {
  const ai = p.ai!;
  if (!ai.drive) ai.drive = newDrive(w, v);
  const d = ai.drive;
  const b = v.body;
  // The lane points are ground coordinates.
  const P = groundOf(b.x, b.y);
  while (d.pts.length < 5) extend(w, d);
  const vf = forwardSpeed(b);
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
    if (!passed && pt.stop !== undefined && !panic && mustStop(w.city.nodes[pt.stop], pt.axis!, w.time, Math.max(0, ahead), vf)) break;
    if (dd < 3 + Math.abs(vf) * 0.15 || passed) d.pts.shift(); else break;
  }
  if (d.pts.length < 5) extend(w, d);
  const seg = w.city.segs[d.seg];
  let target = panic ? 18 : seg.lanes > 1 ? 16 : 11.5;
  target = Math.min(target, v.spec.maxSpeed * 0.8);
  // Slow for turns ahead.
  if (d.pts.slice(0, 3).some((pt) => !pt.axis && pt.stop === undefined)) target = Math.min(target, panic ? 11 : 7.5);
  // Lights.
  let red = false;
  if (!panic) {
    for (const pt of d.pts.slice(0, 3)) {
      if (pt.stop === undefined) continue;
      const node = w.city.nodes[pt.stop];
      // Distance to the line along your heading (lanes are offset sideways from the point).
      const dist = Math.max(0, (pt.x - P.x) * Math.cos(b.angle) + (pt.y - P.y) * Math.sin(b.angle));
      if (mustStop(node, pt.axis!, w.time, dist, vf)) {
        // Brake to stop on the line (5 m/s² comfortable), then hold.
        target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, dist - 1)));
        red = target < 2;
      }
      break;
    }
  }
  // Junction right-of-way (lights already handled): wait at the line if the box isn't ours.
  let yielding = false;
  if (!red) {
    const j = nextJunction(w, d);
    if (j) {
      const dist = Math.hypot(j.at.x - P.x, j.at.y - P.y);
      if (dist < 16 && !mayEnter(w, v, j.node, j.axis, j.exit)) {
        target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, dist - 1.5)));
        yielding = target < 2;
      }
    }
  }
  // Spooked drivers ignore people in the road but still keep a gap to the car ahead.
  const clear = clearance(w, v, panic || d.bypassT > 0, panic && d.bypassT <= 0);
  // A siren coming: ease over to the kerb at a crawl, stop there, and stay put until it's been gone
  // a few seconds. Fleeing drivers and other emergency vehicles don't.
  if (!panic && !v.spec.siren && sirenApproaching(w, v)) d.yieldT = 3;
  else d.yieldT = Math.max(0, d.yieldT - dt);
  const pulling = d.yieldT > 0;
  if (pulling) { d.pullT += dt; d.bypassT = 0; } else d.pullT = 0;
  const held = red || yielding || pulling;
  // Overtakes crawl past (bumps under ~4 m/s do no damage).
  if (d.bypassT > 0) { d.bypassT -= dt; target = Math.min(target, 4); }
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
  if (blocked) {
    d.blockT += dt;
    // Go around: a parked/wrecked car after a moment, a person who won't move after a while,
    // but only when the oncoming lane is clear.
    const wait = clear.still ? 1.5 : clear.ped ? 4 : Infinity; // queues are waited out
    if (d.blockT > wait && laneClear(w, v)) { d.blockT = 0; d.bypassT = 3.5; }
    // Deadlock breaker: still wedged after 10 s (a ring of cars all waiting on each other):
    // back up a touch, then squeeze round at a crawl.
    else if (d.blockT > 10 + (v.id % 5)) { d.blockT = 0; d.reverseT = 1; d.bypassT = 4; }
  } else d.blockT = Math.max(0, d.blockT - dt);
  // Spooked drivers don't wait: when actually blocked they swerve around (if there's room) and go.
  if (panic && clear.cap < 1.5 && vf < 3 && d.bypassT <= 0 && laneClear(w, v)) d.bypassT = 2;
  d.why = pulling ? 'siren' : d.reverseT > 0 ? 'reverse' : d.bypassT > 0 ? 'bypass' : red ? 'light' : yielding ? 'junction' : clear.ped && clear.cap < 2 ? 'ped' : clear.cap < 2 ? 'car' : 'free';
  if (unstick(v, d, Math.max(target, d.bypassT > 0 ? 3 : 0), dt)) return;
  // Pure pursuit on the polyline (aiming closer in while pulling over, so the car swings across).
  const look = pulling ? 4 : 6 + Math.abs(vf) * 0.45;
  const pt = d.pts[0];
  let tx = pt.x, ty = pt.y;
  const d0 = Math.hypot(pt.x - P.x, pt.y - P.y);
  if (d0 < look && d.pts[1]) {
    const n = d.pts[1];
    const segLen = Math.hypot(n.x - pt.x, n.y - pt.y) || 1;
    const t = Math.min(1, (look - d0) / segLen);
    tx = pt.x + (n.x - pt.x) * t; ty = pt.y + (n.y - pt.y) * t;
  }
  if (d.bypassT > 0) {
    // Offset into the oncoming lane (to the left of travel).
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
  steerTo(v, tx, ty, target);
}

/** Routed driving toward a point, switching to a straight line when close. */
export function driveTo(w: World, v: Vehicle, p: Ped, tx: number, ty: number, dt: number, opts: { stopAt: number; ram: boolean; speed?: number }): number {
  const ai = p.ai!;
  if (!ai.drive) ai.drive = newDrive(w, v);
  return routeTo(w, v, ai.drive, tx, ty, dt, opts);
}

/** driveTo for whatever holds the route state (an AI driver, or a riderless horse called home). */
export function routeTo(w: World, v: Vehicle, d: DriveState, tx: number, ty: number, dt: number, opts: { stopAt: number; ram: boolean; speed?: number }): number {
  const b = v.body;
  // Positions compared over the ground (world/levels.ts).
  const P = groundOf(b.x, b.y), T = groundOf(tx, ty);
  const dist = Math.hypot(T.x - P.x, T.y - P.y);
  if (flies(v.spec)) return flyTo(w, v, T.x, T.y, opts.stopAt, dt);
  const fast = opts.speed ?? Math.min(v.spec.maxSpeed * 0.92, 30);
  const clear = clearance(w, v, true);
  if (dist < 45 && P.f === T.f && !w.statics.raycast(b.x, b.y, tx, ty, 1)) {
    let target = dist <= opts.stopAt ? 0 : opts.ram ? fast : Math.min(fast, Math.sqrt(2 * 8 * Math.max(0, dist - opts.stopAt)));
    if (!opts.ram) target = Math.min(target, clear.cap + 2);
    if (unstick(v, d, Math.max(target, 3), dt)) return dist;
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
  if (unstick(v, d, Math.max(target, 3), dt)) return dist;
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
