// Moves NPC peds and all vehicles not stepped by a player's input; handles water,
// burning wrecks, turrets and horns.
import { angleDiff, approach } from '../../../shared/math';
import { flies, floats, onRails } from '../../../shared/sim/kinds';
import { FX } from '../../../shared/protocol';
import { stepFoot, stepVehicle, wearOf } from '../../../shared/sim/physics';
import { killPed, wallCrash, wreckVehicle } from '../combat/damage';
import { tickWeapon, tryFire } from '../combat/fire';
import type { Ped, Vehicle } from '../entities';
import { removeVehicle } from '../factory';
import type { World } from '../world';
import { grazing } from './graze';
import { bolting } from './spook';

export function stepPedBody(w: World, p: Ped, dt: number, speed: number): void {
  const b = p.body;
  const ox = b.x, oy = b.y;
  if (p.down > 0 || p.dead || (p.stagger ?? 0) > 0) {
    // Floored or reeling: no control, sliding to a stop with whatever knocked you.
    p.down = Math.max(0, p.down - dt);
    if (p.stagger) p.stagger = Math.max(0, p.stagger - dt);
    b.vx *= Math.exp(-5 * dt); b.vy *= Math.exp(-5 * dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
    w.statics.resolveCircle(b, 0.35);
  } else {
    stepFoot(b, p.ctl, speed, dt, w.statics);
  }
  // Water is a wall for walkers.
  if (w.map.isWater(b.x, b.y)) {
    if (w.map.isWater(ox, oy)) {
      p.swimT += dt;
      if (p.swimT > 1.5 && !p.dead) killPed(w, p, w.peds.get(p.lastHitBy) ?? null);
    } else { b.x = ox; b.y = oy; b.vx = 0; b.vy = 0; }
  } else p.swimT = 0;
}

export function updateNpcPeds(w: World, dt: number): void {
  for (const p of w.peds.values()) {
    if (p.player || p.vehicle) continue;
    tickWeapon(p, dt);
    if (p.dead) { p.deadT += dt; stepPedBody(w, p, dt, 0); continue; }
    // AI controls are scaled so that magnitude 1 means running.
    stepPedBody(w, p, dt, p.spec.runSpeed);
    const moving = Math.hypot(p.body.vx, p.body.vy) > 0.3;
    p.body.angle = p.trigger || p.ai?.task === 'attack' || !moving ? p.aim : Math.atan2(p.body.vy, p.body.vx);
    tryFire(w, p);
  }
  // NPCs firing from vehicles.
  for (const p of w.peds.values()) {
    if (p.player || !p.vehicle || p.dead) continue;
    tickWeapon(p, dt);
    tryFire(w, p);
  }
}

function playerDriven(w: World, v: Vehicle): boolean {
  const d = v.seats[0] ? w.peds.get(v.seats[0]) : undefined;
  return !!d?.player;
}

export function updateVehicles(w: World, dt: number): void {
  for (const v of w.vehicles.values()) {
    v.fireCd = Math.max(0, v.fireCd - dt);
    if (v.horn) { w.emit(FX.Horn, v.id); v.horn = false; }
    const driver = v.seats[0] ? w.peds.get(v.seats[0]) : undefined;
    // A train's cars are laid along the track by systems/trains.ts, not driven.
    if (!playerDriven(w, v) && !onRails(v.spec)) {
      // A horse called by its rider (systems/mounts.ts) goes on its own.
      const driven = (!!driver && !driver.dead && !v.wrecked) || ((v.calledBy > 0 || bolting(v) || grazing(v)) && !v.wrecked);
      const vx = v.body.vx, vy = v.body.vy;
      wallCrash(w, v, stepVehicle(v.body, v.spec, v.ctl, dt, w.statics, driven, undefined, wearOf(v.hp / v.spec.hp, v.id)), vx, vy);
      if (driver && v.spec.turret) v.turret = turnTurret(v.turret, driver.aim, dt, v.spec.turret);
    }
    if (!v.spec.turret) v.turret = v.body.angle;
    // How long this vehicle has been sitting still for no good reason (lights/junctions don't count).
    const why = driver?.ai?.drive?.why;
    const waiting = why === 'light' || why === 'junction' || why === 'car' || why === 'ped' || why === 'siren';
    v.idleT = Math.hypot(v.body.vx, v.body.vy) < 0.5 && !driver?.player && !waiting ? v.idleT + dt : 0;
    for (const sid of v.seats) {
      const o = sid ? w.peds.get(sid) : undefined;
      if (o) { o.body.x = v.body.x; o.body.y = v.body.y; o.body.alt = v.body.alt; }
    }
    if (v.burning >= 0) {
      v.burning += dt;
      if (v.burning > 5) wreckVehicle(w, v);
    }
    if (v.wrecked) {
      v.wreckT += dt;
      if (flies(v.spec)) v.body.alt = approach(v.body.alt, 0, 14 * dt);
      if (floats(v.spec)) sink(w, v, dt); // a burnt-out boat goes down
      continue;
    }
    sink(w, v, dt);
  }
}

function sink(w: World, v: Vehicle, dt: number): void {
  if (flies(v.spec) && v.body.alt > 0.5) { v.sinkT = 0; return; }
  if (floats(v.spec) && !v.wrecked) { v.sinkT = 0; return; } // it floats
  if (!w.map.isWater(v.body.x, v.body.y)) { v.sinkT = 0; return; }
  if (v.sinkT === 0) w.emit(FX.Splash, Math.round(v.body.x), Math.round(v.body.y));
  v.sinkT += dt;
  v.body.vx *= Math.exp(-2 * dt); v.body.vy *= Math.exp(-2 * dt);
  if (v.sinkT < 2.5) return;
  for (const sid of v.seats) {
    const o = sid ? w.peds.get(sid) : undefined;
    if (o && !o.dead) killPed(w, o, null);
  }
  removeVehicle(w, v);
}

export function turnTurret(cur: number, want: number, dt: number, rate: number): number {
  const d = angleDiff(cur, want);
  const step = rate * dt;
  return cur + Math.max(-step, Math.min(step, d));
}
