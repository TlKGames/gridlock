// Deterministic movement steps shared by the server simulation and client prediction.
import { approach, clamp, wrapAngle } from '../math';
import { RULES, type VehicleSpec } from '../packs';
import type { StaticWorld } from '../world/collision';
import { slopeFactor } from '../world/terrain';
import { stepBoat } from './boat';
import { stepMount } from './mount';

export const DT = 1 / 30;
export const PED_RADIUS = 0.35;
/** Sprint speed multiplier (Shift). */
export const SPRINT = 1.45;
export const HELI_MAX_ALT = 48;
export const HELI_CLIMB = 9;
const HELI_DRAG = 0.45;
/** Handbrake: share of the tyres' grip left to pull a slide back in line, friction of the locked
 *  wheels (share of the brakes), how fast steering spins the car (share of its turn rate), and how
 *  much of the engine's pull a power slide gets. */
const HANDBRAKE_GRIP = 0.12, HANDBRAKE_FRICTION = 0.9, HANDBRAKE_SPIN = 2.0, HANDBRAKE_POWER = 0.5;
/** How much less the locked wheels scrub off while you steer (share of the brakes at full lock). */
const HANDBRAKE_SLEW = 0.5;
/** How near the middle of a roof a helicopter's centre must be to set down on it (metres in from
 *  the edge it may hang over). */
const HELI_PAD = 0.8;
/** The share of gravity (m/s² per unit of grade) a wheeled vehicle feels along a slope. */
const ROLL = 9.8 * 0.6;

export interface Body {
  x: number; y: number; angle: number;
  vx: number; vy: number; av: number;
  alt: number;
}

export interface Controls {
  mx: number; my: number;   // on-foot move axes (screen space), -1..1
  throttle: number;         // vehicle: -1..1
  steer: number;            // vehicle: -1..1
  handbrake: boolean;
  sprint: boolean;
  up: boolean; down: boolean;
}

export const emptyControls = (): Controls => ({ mx: 0, my: 0, throttle: 0, steer: 0, handbrake: false, sprint: false, up: false, down: false });

export const newBody = (x: number, y: number, angle = 0): Body => ({ x, y, angle, vx: 0, vy: 0, av: 0, alt: 0 });

export function copyBody(dst: Body, src: Body): Body {
  dst.x = src.x; dst.y = src.y; dst.angle = src.angle; dst.vx = src.vx; dst.vy = src.vy; dst.av = src.av; dst.alt = src.alt;
  return dst;
}

export const speedOf = (b: Body): number => Math.hypot(b.vx, b.vy);
export const forwardSpeed = (b: Body): number => b.vx * Math.cos(b.angle) + b.vy * Math.sin(b.angle);

/** On-foot movement. Returns true if the ped bumped into static geometry. */
export function stepFoot(b: Body, c: Controls, speed: number, dt: number, world: StaticWorld): boolean {
  let mx = c.mx, my = c.my;
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  // Slower up a hill, a little quicker down one (world/terrain.ts).
  if (m > 1e-3) speed *= slopeFactor(world.gradeAt(b.x, b.y, c.mx / m, c.my / m));
  // GTA2-style: full speed the instant a key is down, dead stop when released.
  b.vx = mx * speed;
  b.vy = my * speed;
  moveOnGround(b, dt, world);
  const hit = world.resolveCircle(b, PED_RADIUS, 0);
  if (hit) {
    const vn = b.vx * hit.nx + b.vy * hit.ny;
    if (vn < 0) { b.vx -= vn * hit.nx; b.vy -= vn * hit.ny; }
  }
  return hit !== null;
}

const QUARTER = Math.PI / 2;
const ASSIST_CONE = (25 * Math.PI) / 180;

/**
 * Vehicle movement (wheels, bikes, tracks, rotors). Returns impact speed against static geometry.
 * `onRoad`, when given, enables GTA2's steer assist: with gas on and no steering, a car on a road
 * within 25° of the road's axis is eased straight along it. `wear`, when given, is how beaten up it
 * is: below RULES.wearFrom of its health it has less pull, top speed and grip, and pulls to one side.
 */
export function stepVehicle(b: Body, spec: VehicleSpec, c: Controls, dt: number, world: StaticWorld, driven: boolean, onRoad?: (x: number, y: number) => boolean, wear?: Wear): number {
  let pull = 0;
  if (wear && wear.health < RULES.wearFrom) {
    const k = clamp((RULES.wearFrom - wear.health) / RULES.wearFrom, 0, 1);
    spec = worn(spec, k);
    pull = wear.side * RULES.wearPull * k;
  }
  // A ridden animal moves in gaits (sim/mount.ts); Sprint asks for a gallop (the caller clears it
  // when the mount is blown).
  if (spec.gaits) return stepMount(b, spec, c, dt, world, driven);
  if (spec.movement === 'rotor') return stepHeli(b, spec, c, dt, world, driven);
  if (spec.movement === 'boat') return stepBoat(b, spec, c, dt, world, driven);
  if (driven && c.handbrake && (spec.movement === 'wheels' || spec.movement === 'bike') && !spec.minTurnRadius) {
    return stepHandbrake(b, spec, c, dt, world);
  }
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  // Vehicles that pivot on their rear axle: the centre's sideways motion from turning is part of
  // the turn, not a skid, so it's taken out before grip acts on the slip.
  const pivot = spec.rearAxle ?? 0;
  let vf = b.vx * fx + b.vy * fy;
  let vl = -b.vx * fy + b.vy * fx - b.av * pivot;
  const throttle = driven ? c.throttle : 0;
  // A beaten-up car pulls to one side (worse the more it's hurt) whenever it's moving.
  const steer = driven ? clamp(c.steer + pull, -1, 1) : 0;
  const hand = driven && c.handbrake;

  if (throttle > 0) {
    if (vf < -0.5) vf = approach(vf, 0, spec.brake * dt);
    else vf += spec.accel * throttle * clamp(1 - (vf / spec.maxSpeed) ** 2, 0, 1) * dt;
  } else if (throttle < 0) {
    if (vf > 0.5) vf = approach(vf, 0, spec.brake * -throttle * dt);
    else vf = Math.max(-spec.reverse, vf - spec.accel * 0.7 * -throttle * dt);
  } else {
    vf = approach(vf, 0, (driven ? 2.2 : 6) * dt);
  }
  if (hand) vf = approach(vf, 0, spec.brake * 0.45 * dt);
  vf -= vf * 0.04 * dt;
  // Gravity along the slope: it labours up a hill and rolls on down one (world/terrain.ts).
  vf -= ROLL * world.gradeAt(b.x, b.y, fx, fy) * dt;

  const speedK = clamp(Math.abs(vf) / spec.maxSpeed, 0, 1);
  // Oversteer while turning (GTA2 turn_in): the rear lets go a little as you steer at speed.
  const turnIn = spec.turnIn ?? 0.15;
  let grip = spec.grip * (1 - turnIn * Math.abs(steer) * speedK * 1.6);
  if (hand) grip = spec.grip * 0.12;
  vl *= Math.exp(-Math.max(0.3, grip) * dt);

  let targetAv: number;
  if (spec.movement === 'tracks') {
    targetAv = steer * spec.turnRate * (vf < -0.5 ? -1 : 1);
  } else if (spec.minTurnRadius) {
    // Truck: turning rate follows the steering geometry (v / radius) up to the grip a heavy rig
    // has (lateral accel / v), so it turns tight at a crawl and wide at speed.
    const sp = Math.abs(vf);
    const most = Math.min(sp / spec.minTurnRadius, (spec.maxLateral ?? 4) / Math.max(sp, 0.5));
    targetAv = steer * most * Math.sign(vf) * (hand ? 1.3 : 1);
  } else {
    // Tight at low speed, much lazier at top speed (GTA2: ~1.25x down to ~0.5x).
    const low = clamp(Math.abs(vf) / 3.5, 0, 1);
    const bySpeed = 1.25 - 0.75 * speedK;
    targetAv = steer * spec.turnRate * low * Math.sign(vf) * bySpeed * (hand ? 1.5 : 1);
  }
  b.av += (targetAv - b.av) * Math.min(1, 12 * dt);
  b.angle += b.av * dt;
  if (onRoad && steer === 0 && throttle > 0 && vf > 3 && !hand && onRoad(b.x, b.y)) {
    const axis = Math.round(b.angle / QUARTER) * QUARTER;
    const off = wrapAngle(axis - b.angle);
    if (Math.abs(off) < ASSIST_CONE) b.angle += clamp(off, -spec.turnRate * 0.5 * dt, spec.turnRate * 0.5 * dt);
  }

  const nfx = Math.cos(b.angle), nfy = Math.sin(b.angle);
  const lat = vl + b.av * pivot;
  b.vx = nfx * vf - nfy * lat;
  b.vy = nfy * vf + nfx * lat;
  moveOnGround(b, dt, world);
  return collideStatic(b, spec, world, 0);
}

/** Handbrake on (cars and bikes; heavy rigs just brake harder through the normal step): the rear
 *  wheels lock, so the car stops carrying its speed round with it. It keeps sliding the way it was
 *  going, slowed by the locked tyres, with only a little grip pulling the slide back in line, while
 *  steering swings it round on the spot (steer right, it spins clockwise): hold it through a half
 *  turn and let go facing back the way you came, still sliding, for a handbrake 180. Gas while
 *  sliding pushes along the way it now points (a power slide); the brakes add to the friction. */
function stepHandbrake(b: Body, spec: VehicleSpec, c: Controls, dt: number, world: StaticWorld): number {
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  let vf = b.vx * fx + b.vy * fy;
  let vl = -b.vx * fy + b.vy * fx;
  if (burningOut(spec, c, Math.abs(vf))) return stepBurnout(b, spec, c, dt, world, vf, vl);
  vl *= Math.exp(-spec.grip * HANDBRAKE_GRIP * dt);
  if (c.throttle > 0) vf += spec.accel * c.throttle * HANDBRAKE_POWER * dt;
  b.vx = fx * vf - fy * vl;
  b.vy = fy * vf + fx * vl;
  // Locked tyres scrubbing along the road, whichever way it's sliding.
  const speed = Math.hypot(b.vx, b.vy);
  // Straight on, it slams the car to a stop; steering, the car slews round on the locked wheels and
  // scrubs off less, so it can swing right round.
  const lock = HANDBRAKE_FRICTION - HANDBRAKE_SLEW * Math.abs(c.steer);
  const friction = spec.brake * (lock + (c.throttle < 0 ? -c.throttle * 0.5 : 0)) * dt;
  const k = speed > 0 ? Math.max(0, speed - friction) / speed : 0;
  b.vx *= k; b.vy *= k;
  const targetAv = c.steer * spec.turnRate * HANDBRAKE_SPIN * clamp(speed / 2, 0, 1);
  b.av += (targetAv - b.av) * Math.min(1, 10 * dt);
  b.angle += b.av * dt;
  moveOnGround(b, dt, world);
  return collideStatic(b, spec, world, 0);
}

/** Gas and handbrake together at a standstill or a crawl (`speed`: forward speed; the tail swinging
 *  round in a donut doesn't count): a burnout (cars only; a bike or a rig just brakes). The same test
 *  tells the renderer to smoke (VF.burnout). */
export const burningOut = (spec: VehicleSpec, c: Controls, speed: number): boolean =>
  spec.movement === 'wheels' && !spec.minTurnRadius && c.handbrake && c.throttle > 0.5 && speed < BURNOUT_MAX;
const BURNOUT_MAX = 5;

/** A burnout: the driven wheels spin against the brakes, so the car barely creeps forward; steering
 *  swings the tail round the front wheels (a donut). Let go of the handbrake and it launches. */
function stepBurnout(b: Body, spec: VehicleSpec, c: Controls, dt: number, world: StaticWorld, vf: number, vl: number): number {
  vf = approach(vf, 0.6 * c.throttle, 6 * dt);
  // The tail swings round the front axle: the centre moves sideways with the turn.
  const targetAv = c.steer * spec.turnRate * 1.3;
  b.av += (targetAv - b.av) * Math.min(1, 6 * dt);
  vl = approach(vl, -b.av * spec.length * 0.4, 20 * dt);
  b.angle += b.av * dt;
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  b.vx = fx * vf - fy * vl;
  b.vy = fy * vf + fx * vl;
  moveOnGround(b, dt, world);
  return collideStatic(b, spec, world, 0);
}

/** How beaten up a vehicle is: its health (share of its spec's) and the side it pulls to (+1 / -1). */
export interface Wear { health: number; side: number }

/** A vehicle's wear from its health and id (the id picks the side a wreck pulls to, the same on
 *  the server and in the driver's prediction). */
export const wearOf = (health: number, id: number): Wear => ({ health, side: id % 2 ? 1 : -1 });

/** Whether a mount is galloping flat out (spending its wind): Sprint held, going faster than a canter. */
export const galloping = (b: Body, spec: VehicleSpec, sprint: boolean): boolean =>
  !!spec.stamina && !!spec.gaits && sprint && Math.hypot(b.vx, b.vy) > spec.gaits.canter * 1.02;

/** A spec as it drives `k` of the way (0..1) from fine to wrecked; cached in steps of 5%. */
const wornCache = new Map<VehicleSpec, Map<number, VehicleSpec>>();
function worn(spec: VehicleSpec, k: number): VehicleSpec {
  const step = Math.round(k * 20);
  let m = wornCache.get(spec);
  if (!m) wornCache.set(spec, (m = new Map()));
  let s = m.get(step);
  if (!s) {
    const t = step / 20, lerp = (to: number) => 1 - (1 - to) * t;
    s = { ...spec, accel: spec.accel * lerp(RULES.wearPower), maxSpeed: spec.maxSpeed * lerp(RULES.wearSpeed), grip: spec.grip * lerp(RULES.wearGrip) };
    m.set(step, s);
  }
  return s;
}

/** Where the trailer hitch sits: this far behind the vehicle's centre. */
export const hitchOffset = (spec: VehicleSpec): number => spec.trailer?.hitch ?? spec.length / 2 - 0.9;

/**
 * Advances an articulated trailer's heading. The trailer pivots on the hitch and its rear axle
 * can't slide sideways, so it swings toward the path of the hitch (classic trailer kinematics).
 */
export function stepTrailer(b: Body, spec: VehicleSpec, trailerAngle: number, dt: number): number {
  const t = spec.trailer;
  if (!t) return b.angle;
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const off = hitchOffset(spec);
  // Hitch velocity = body velocity + spin × (hitch offset behind the centre).
  const hvx = b.vx + b.av * (s * off), hvy = b.vy - b.av * (c * off);
  const axle = t.length * 0.8;
  let rate = (hvx * -Math.sin(trailerAngle) + hvy * Math.cos(trailerAngle)) / axle;
  // Reversing, true trailer kinematics fold up within seconds (articulation grows at about
  // |v|·rel/axle). A straightening term twice that strong keeps it drivable: the trailer still
  // answers the steering but settles back in line instead of jackknifing.
  const along = hvx * Math.cos(trailerAngle) + hvy * Math.sin(trailerAngle);
  if (along < 0) rate -= 2 * wrapAngle(trailerAngle - b.angle) * (-along / axle);
  let a = trailerAngle + rate * dt;
  // Jackknife limit.
  const rel = wrapAngle(a - b.angle);
  if (Math.abs(rel) > 1.45) a = b.angle + Math.sign(rel) * 1.45;
  return a;
}

/** Centre of the trailer box for a given trailer heading. */
export function trailerCentre(b: Body, spec: VehicleSpec, trailerAngle: number): { x: number; y: number } {
  const off = hitchOffset(spec);
  const hx = b.x - Math.cos(b.angle) * off, hy = b.y - Math.sin(b.angle) * off;
  const half = (spec.trailer?.length ?? 0) / 2;
  return { x: hx - Math.cos(trailerAngle) * half, y: hy - Math.sin(trailerAngle) * half };
}

function stepHeli(b: Body, spec: VehicleSpec, c: Controls, dt: number, world: StaticWorld, driven: boolean): number {
  // Whatever's under it is the floor: the street, or a roof it can set down on.
  const floor = world.floorAt(b.x, b.y, HELI_PAD);
  const flying = b.alt > floor + 1.5;
  if (driven && c.up) b.alt = Math.min(HELI_MAX_ALT, b.alt + HELI_CLIMB * dt);
  else if (driven && c.down) b.alt = Math.max(floor, b.alt - HELI_CLIMB * dt);
  else if (!driven) b.alt = Math.max(floor, b.alt - HELI_CLIMB * 0.8 * dt);
  if (b.alt < floor) b.alt = floor;

  const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  if (flying && driven) {
    const t = c.throttle;
    b.vx += fx * spec.accel * t * dt;
    b.vy += fy * spec.accel * t * dt;
    const targetAv = c.steer * spec.turnRate;
    b.av += (targetAv - b.av) * Math.min(1, 4 * dt);
  } else {
    b.av *= Math.exp(-6 * dt);
  }
  // Air drag sets the real top speed (accel / drag) below the spec's hard cap.
  const drag = flying ? HELI_DRAG : 6;
  b.vx *= Math.exp(-drag * dt);
  b.vy *= Math.exp(-drag * dt);
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > spec.maxSpeed) { b.vx *= spec.maxSpeed / sp; b.vy *= spec.maxSpeed / sp; }
  b.angle += b.av * dt;
  b.x += b.vx * dt; // flying: over the cliffs
  b.y += b.vy * dt;
  return collideStatic(b, spec, world, b.alt);
}

/** Moves a body on the ground by its velocity; a cliff (world/terrain.ts) stops it like a wall,
 *  sliding along the edge, with no crash (nothing hit hard). */
export function moveOnGround(b: Body, dt: number, world: StaticWorld): void {
  const px = b.x, py = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const hit = world.cliff(b, px, py);
  if (!hit) return;
  const vn = b.vx * hit.nx + b.vy * hit.ny;
  if (vn < 0) { b.vx -= vn * hit.nx; b.vy -= vn * hit.ny; }
}

export function collideStatic(b: Body, spec: VehicleSpec, world: StaticWorld, z: number): number {
  const hl = spec.length / 2, hw = spec.width / 2;
  const hit = world.resolveObb(b, hl, hw, z);
  if (!hit) return 0;
  const vn = b.vx * hit.nx + b.vy * hit.ny;
  if (vn >= 0) return 0;
  const e = 0.22;
  b.vx -= (1 + e) * vn * hit.nx;
  b.vy -= (1 + e) * vn * hit.ny;
  b.vx *= 0.92; b.vy *= 0.92;
  b.av *= 0.5;
  return -vn;
}
