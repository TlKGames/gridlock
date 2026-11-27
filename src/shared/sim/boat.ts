// Boats (pure, shared by server and client prediction). Unlike a car, a hull doesn't carry its speed
// round a turn: the water keeps the boat moving the way it was going, the prop pushes along the hull,
// and sideways drag (`grip`, low) slowly bleeds off the drift, so the stern swings out and the boat
// slides through its turns. The rudder needs water flowing past it (or the prop's wash at a crawl).
// Water drag stops a coasting boat in a glide. Land is a wall: a boat that runs aground bounces off.
import { rebound } from './impact';
import { approach, clamp } from '../math';
import type { VehicleSpec } from '../packs';
import type { StaticWorld } from '../world/collision';
import type { Body, Controls } from './physics';

/** Water drag (1/s): coasting, and under way. */
const COAST_DRAG = 0.45, UNDERWAY_DRAG = 0.12;
/** How quickly the hull answers the rudder (1/s): slower than a car's tyres. */
const YAW_RESPONSE = 3;

/** One step; returns the impact speed when it hit the shore (0 otherwise), for damage. */
export function stepBoat(b: Body, spec: VehicleSpec, c: Controls, dt: number, world: StaticWorld, driven: boolean): number {
  const throttle = driven ? c.throttle : 0, steer = driven ? c.steer : 0;
  let fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  const vf0 = b.vx * fx + b.vy * fy;
  // Rudder: water flowing past it, or the prop's wash kicking the stern round at a crawl.
  const flow = clamp(Math.abs(vf0) / 5 + Math.abs(throttle) * 0.35, 0, 1);
  const targetAv = steer * spec.turnRate * flow * (vf0 < -0.3 ? -1 : 1);
  b.av += (targetAv - b.av) * Math.min(1, YAW_RESPONSE * dt);
  const oldAngle = b.angle;
  b.angle += b.av * dt;
  // The velocity stays where it was in the world; split it along the new heading.
  fx = Math.cos(b.angle); fy = Math.sin(b.angle);
  let vf = b.vx * fx + b.vy * fy;
  let vl = -b.vx * fy + b.vy * fx;
  if (throttle > 0) vf += spec.accel * throttle * clamp(1 - (vf / spec.maxSpeed) ** 2, 0, 1) * dt;
  else if (throttle < 0) {
    if (vf > 0.5) vf = approach(vf, 0, spec.brake * -throttle * dt); // the prop in reverse
    else vf = Math.max(-spec.reverse, vf - spec.accel * 0.5 * -throttle * dt);
  }
  vf -= vf * (throttle === 0 ? COAST_DRAG : UNDERWAY_DRAG) * dt;
  vl *= Math.exp(-spec.grip * dt);
  b.vx = fx * vf - fy * vl;
  b.vy = fy * vf + fx * vl;
  const ox = b.x, oy = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (!afloat(b, spec, world)) {
    const x = b.x, y = b.y;
    b.x = ox; b.y = oy;
    if (!afloat(b, spec, world)) {
      b.angle = oldAngle; b.av = 0;
      if (!afloat(b, spec, world)) { refloat(b, spec, world); return 0; }
    }
    // Banks, dock faces and the map boundary follow the world axes. Keep any
    // translation along the face; only the blocked component drives damage.
    b.x = x;
    const clearX = afloat(b, spec, world);
    b.x = ox; b.y = y;
    const clearY = afloat(b, spec, world);
    if (clearX && clearY) {
      // The combined move clipped a convex corner, or rotation alone was blocked.
      b.x = x;
      if (afloat(b, spec, world)) return 0;
    }
    const slideX = clearX && (!clearY || Math.abs(b.vx) >= Math.abs(b.vy));
    b.x = slideX ? x : ox; b.y = !slideX && clearY ? y : oy;
    if (slideX) return rebound(b, 0, -Math.sign(b.vy), spec.length, true);
    if (clearY) return rebound(b, -Math.sign(b.vx), 0, spec.length, true);
    // Two faces at an inside corner.
    const hitX = rebound(b, -Math.sign(b.vx), 0, spec.length, true);
    return Math.hypot(hitX, rebound(b, 0, -Math.sign(b.vy), spec.length, true));
  }
  return 0;
}

/** Eases a hull that's partly on the bank back off it: the smallest nudge (up to a hull's width)
 *  that leaves it all on water. */
function refloat(b: Body, spec: VehicleSpec, world: StaticWorld): void {
  const x = b.x, y = b.y;
  for (let r = 0.25; r <= spec.width + spec.length / 2; r += 0.25) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      b.x = x + Math.cos(a) * r; b.y = y + Math.sin(a) * r;
      if (afloat(b, spec, world)) return;
    }
  }
  b.x = x; b.y = y;
}

/** Is the whole hull on boat water (its corners and the middle of each side)? */
export function afloat(b: Body, spec: VehicleSpec, world: StaticWorld): boolean {
  const c = Math.cos(b.angle), s = Math.sin(b.angle), hl = spec.length / 2, hw = spec.width / 2;
  for (const [a, w] of [[1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1]]) {
    if (!world.boatWater(b.x + c * hl * a - s * hw * w, b.y + s * hl * a + c * hw * w)) return false;
  }
  return true;
}
