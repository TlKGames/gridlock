// How a ridden animal moves (movement 'legs' with `gaits`): the verb. A breed's numbers (VehicleSpec
// .gaits, .stamina) are the nouns. Unlike a car it goes where it points (no slide, no drift), moves
// in gaits (walk, trot, canter; gallop on Sprint while it has the wind), eases down through them
// when you let go, turns on the spot at a standstill and wider the faster it goes, backs up only a
// few slow steps, and shies to a stop at a wall instead of crashing into it. Shared with the
// client's prediction: pure.
import { approach, clamp } from '../math';
import type { VehicleSpec } from '../packs/types';
import type { StaticWorld } from '../world/collision';
import { slopeFactor } from '../world/terrain';
import { type Body, type Controls, collideStatic, moveOnGround } from './physics';

/** The gait a throttle asks for (a pad trigger part-way: a walk or a trot; full: a canter). */
function targetSpeed(spec: VehicleSpec, throttle: number, sprint: boolean): number {
  const g = spec.gaits!;
  if (throttle <= 0) return 0;
  if (sprint) return g.gallop;
  return throttle < 0.4 ? g.walk : throttle < 0.75 ? g.trot : g.canter;
}

export function stepMount(b: Body, spec: VehicleSpec, c: Controls, dt: number, world: StaticWorld, driven: boolean): number {
  const g = spec.gaits!;
  const fx = Math.cos(b.angle), fy = Math.sin(b.angle);
  let v = b.vx * fx + b.vy * fy;
  const throttle = driven ? c.throttle : 0;
  const steer = driven ? c.steer : 0;
  if (throttle < 0) {
    // Reined in hard while moving; at a standstill, a few slow steps back.
    v = v > 0.3 ? approach(v, 0, g.slow * 2.5 * dt) : approach(v, -g.back, g.accel * 0.5 * dt);
  } else {
    // A climb holds it back, a descent lets it out a little (world/terrain.ts).
    const want = targetSpeed(spec, throttle, driven && c.sprint) * slopeFactor(world.gradeAt(b.x, b.y, fx, fy));
    v = approach(v, want, (v < want ? g.accel : want === 0 ? g.slow : g.slow * 0.7) * dt);
  }
  // Tight at a walk (on the spot when standing), wide at a gallop; a team is stiffer throughout.
  const k = clamp(Math.abs(v) / g.gallop, 0, 1);
  const rate = g.turnSlow + (g.turnFast - g.turnSlow) * k;
  const targetAv = steer * rate * (v < -0.1 ? -1 : 1);
  b.av += (targetAv - b.av) * Math.min(1, 10 * dt);
  b.angle += b.av * dt;
  // It goes where it points: all its speed along its heading.
  const nfx = Math.cos(b.angle), nfy = Math.sin(b.angle);
  b.vx = nfx * v; b.vy = nfy * v;
  moveOnGround(b, dt, world); // a cliff turns it aside
  const impact = collideStatic(b, spec, world, 0);
  if (impact > 0) {
    // Shies at the wall: pulls up rather than crashing (no damage).
    b.vx *= 0.2; b.vy *= 0.2;
  }
  return 0;
}
