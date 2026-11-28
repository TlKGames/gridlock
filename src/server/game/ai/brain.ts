// Per-tick AI update: perception, then the current task for every NPC.
import { angleDiff, dist } from '../../../shared/math';
import { WEAPONS } from '../../../shared/packs';
import { flies } from '../../../shared/sim/kinds';
import { Mode } from '../../../shared/protocol';
import { forwardSpeed } from '../../../shared/sim/physics';
import type { Ped, Vehicle } from '../entities';
import { unseatPed } from '../factory';
import type { World } from '../world';
import { BEHAVIOURS } from './behaviours';
import { interruptCommute, walkCommute } from './commute';
import { streetGoal } from './doors';
import { waitForTrain } from './crossings';
import { cruise, driveTo } from './driving';
import { soldierHostile } from './soldiers';
import { armBest, arrest, attack, extinguish, flee, returnToVehicle, revive, setTask, standAt, wander } from './tasks';

export function updateAi(w: World, dt: number): void {
  for (const p of w.peds.values()) {
    if (!p.ai || p.dead || p.player) continue;
    const ai = p.ai;
    ai.t += dt;
    if (p.down > 0 || (p.stagger ?? 0) > 0) { p.ctl.mx = 0; p.ctl.my = 0; p.trigger = false; continue; }
    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = 0.45 + w.rng.next() * 0.3;
      BEHAVIOURS[p.spec.behaviour].perceive(w, p);
    }
    if (p.burning > 0 && !p.vehicle) {
      // On fire: run around blindly.
      if (ai.task !== 'flee') setTask(p, 'flee', 0, p.body.x + w.rng.range(-3, 3), p.body.y + w.rng.range(-3, 3));
    }
    if (p.commute && (p.vehicle || ai.task !== 'wander')) interruptCommute(p);
    if (p.vehicle) vehicleTask(w, p, dt);
    else footTask(w, p, dt);
  }
}

function footTask(w: World, p: Ped, dt: number): void {
  const ai = p.ai!;
  let done = false;
  p.trigger = ai.task === 'attack' ? p.trigger : false;
  switch (ai.task) {
    case 'wander':
      if (p.commute) walkCommute(w, p, p.commute, dt);
      else wander(w, p, dt);
      break;
    case 'stand': case 'guard': standAt(w, p, dt); break;
    case 'flee': done = flee(w, p, dt); break;
    case 'cower': p.ctl.mx = 0; p.ctl.my = 0; done = ai.t > 3; if (done) setTask(p, 'flee', 0, ai.tx, ai.ty); return;
    // Held up (systems/robbery.ts ends it): hands up, facing whoever's holding the gun.
    case 'surrender': {
      p.ctl.mx = 0; p.ctl.my = 0;
      const t = w.peds.get(ai.target);
      if (t) p.aim = Math.atan2(t.body.y - p.body.y, t.body.x - p.body.x);
      return;
    }
    // Talking with someone (systems/faceTalk.ts): stood facing them for `tx` seconds, or until
    // they walk off.
    case 'chat': {
      p.ctl.mx = 0; p.ctl.my = 0;
      const t = w.peds.get(ai.target);
      if (t) p.aim = Math.atan2(t.body.y - p.body.y, t.body.x - p.body.x);
      done = !t || t.dead || ai.t > ai.tx || dist(p.body.x, p.body.y, t.body.x, t.body.y) > 6;
      break;
    }
    case 'attack': done = attack(w, p, dt); break;
    case 'arrest': done = arrest(w, p, dt); break;
    case 'revive': done = revive(w, p, dt); break;
    case 'extinguish': done = extinguish(w, p, dt); break;
    case 'return': done = returnToVehicle(w, p, dt); break;
    default: done = true;
  }
  if (done) {
    p.trigger = false;
    if (ai.task === 'flee') ai.block = -1;
    BEHAVIOURS[p.spec.behaviour].idle(w, p);
  }
}

function vehicleTask(w: World, p: Ped, dt: number): void {
  const v = w.vehicles.get(p.vehicle);
  if (!v) { p.vehicle = 0; return; }
  const ai = p.ai!;
  if (v.wrecked || v.burning >= 0) {
    unseatPed(w, p, true);
    setTask(p, 'flee', 0, v.body.x, v.body.y);
    return;
  }
  if (p.seat !== 0) { passenger(w, p, v); return; }
  v.ctl.up = false; v.ctl.down = false;
  switch (ai.task) {
    case 'pursue': pursue(w, p, v, dt); break;
    case 'respond': respond(w, p, v, dt); break;
    default: {
      if (ai.task !== 'drive') setTask(p, 'drive');
      if (ai.panicT > 0) ai.panicT -= dt;
      v.siren = false;
      if (flies(v.spec)) { v.ctl.down = true; v.ctl.throttle = 0; v.ctl.steer = 0; break; }
      const goal = ai.panicT > 0 ? undefined : p.commute;
      const spot = v.parkingTarget;
      if (goal && spot && spot.lot === goal.lot && Math.hypot(v.body.x - spot.x, v.body.y - spot.y) < 1.2 &&
          Math.hypot(v.body.vx, v.body.vy) < 1.2) {
        v.ctl.throttle = 0; v.ctl.handbrake = true;
        unseatPed(w, p, true);
        setTask(p, 'wander');
        break;
      }
      cruise(w, v, p, dt, ai.panicT > 0, goal);
    }
  }
  // A train at the crossing ahead: wait for it (ai/crossings.ts).
  if (waitForTrain(w, v)) { v.ctl.throttle = 0; v.ctl.sprint = false; v.ctl.handbrake = true; }
}

/** Everyone gets out; each crew member picks a job against the target. */
export function crewExit(w: World, v: Vehicle, job: (p: Ped) => void): void {
  for (const sid of [...v.seats]) {
    const c = sid ? w.peds.get(sid) : undefined;
    if (!c || c.player || !c.ai) continue;
    unseatPed(w, c, true);
    c.ai.crew = v.id;
    c.ai.block = -1;
    job(c);
  }
}

function pursue(w: World, p: Ped, v: Vehicle, dt: number): void {
  const ai = p.ai!;
  const t = w.peds.get(ai.target);
  const pl = t?.player;
  const military = p.spec.behaviour === 'military';
  const giveUp = !t || t.dead || (pl && (pl.wanted === 0 || pl.mode >= Mode.Dead)) || (military && !soldierHostile(w, p, t));
  if (giveUp) { v.siren = false; setTask(p, 'drive'); return; }
  const lethal = !pl || pl.lethal || military;
  v.siren = !!v.spec.siren;
  const pos = w.pedPos(t!);
  const tv = t!.vehicle ? w.vehicles.get(t!.vehicle) : undefined;
  if (flies(v.spec)) {
    driveTo(w, v, p, pos.x, pos.y, dt, { stopAt: 22, ram: false });
    gunner(w, p, v, pos, lethal);
    return;
  }
  // Someone indoors (a shop, an upper floor): drive to the street outside the door and go in on foot.
  const goal = tv ? { x: pos.x, y: pos.y, indoors: false } : streetGoal(w, pos.x, pos.y);
  const d = driveTo(w, v, p, goal.x, goal.y, dt, { stopAt: goal.indoors ? 2 : lethal ? 4 : 8, frontage: goal.frontage, ram: lethal && !!tv });
  if (v.spec.weapons?.length) { gunner(w, p, v, pos, lethal); if (d > 12) return; }
  const tSlow = tv ? Math.hypot(tv.body.vx, tv.body.vy) < 2 : true;
  const mySlow = Math.hypot(v.body.vx, v.body.vy) < (goal.indoors ? 1 : 3);
  const reach = goal.indoors ? 8 : tv ? 14 : lethal ? 20 : 12;
  if (d < reach && tSlow && mySlow && !v.spec.weapons?.length) {
    v.ctl.throttle = 0; v.ctl.handbrake = true;
    crewExit(w, v, (c) => setTask(c, lethal || c.spec.behaviour === 'military' ? 'attack' : 'arrest', t!.id));
  }
}

/** Driver-operated mounted weapons (tank cannon, gunship guns). */
function gunner(w: World, p: Ped, v: Vehicle, pos: { x: number; y: number }, lethal: boolean): void {
  const want = Math.atan2(pos.y - v.body.y, pos.x - v.body.x);
  p.aim = want;
  const d = dist(v.body.x, v.body.y, pos.x, pos.y);
  const aligned = flies(v.spec) ? Math.abs(angleDiff(v.body.angle, want)) < 0.5 : Math.abs(angleDiff(v.turret, want)) < 0.08;
  p.trigger = lethal && aligned && d < 85 && d > 8 && !p.triggerPrev;
  if (v.spec.weapons && v.spec.weapons.length > 1) v.vw = d < 45 ? 0 : 1;
}

function passenger(w: World, p: Ped, v: Vehicle): void {
  const driver = v.seats[0] ? w.peds.get(v.seats[0]) : undefined;
  p.trigger = false;
  if (!driver) {
    // Driver gone (shot, jacked): bail out.
    unseatPed(w, p, true);
    BEHAVIOURS[p.spec.behaviour].idle(w, p);
    return;
  }
  const dai = driver.ai;
  if (!dai || dai.task !== 'pursue') return;
  const t = w.peds.get(dai.target);
  if (!t || t.dead) return;
  const lethal = !t.player || t.player.lethal || p.spec.behaviour === 'military';
  armBest(p);
  const spec = WEAPONS[p.weapons[p.wi].w];
  if (!lethal || !spec.driveBy) return;
  const pos = w.pedPos(t);
  const d = dist(v.body.x, v.body.y, pos.x, pos.y);
  if (d > Math.min(spec.range, 45)) return;
  if (w.statics.raycast(v.body.x, v.body.y, pos.x, pos.y, Math.max(1.2, v.body.alt - 2))) return;
  p.aim = Math.atan2(pos.y - v.body.y, pos.x - v.body.x);
  p.trigger = spec.auto || !p.triggerPrev;
}

function respond(w: World, p: Ped, v: Vehicle, dt: number): void {
  const ai = p.ai!;
  v.siren = !!v.spec.siren;
  const goal = p.spec.behaviour === 'medic' ? streetGoal(w, ai.tx, ai.ty) : { x: ai.tx, y: ai.ty, frontage: undefined };
  const d = driveTo(w, v, p, goal.x, goal.y, dt, { stopAt: 9, ram: false, speed: 22, frontage: goal.frontage });
  if (ai.t > 90) { setTask(p, 'drive'); return; }
  if (d < 16 && Math.abs(forwardSpeed(v.body)) < 1.5) {
    const job = ai.target;
    const at = { x: ai.tx, y: ai.ty };
    v.siren = false;
    crewExit(w, v, (c) => {
      if (c.spec.behaviour === 'medic') setTask(c, 'revive', job);
      else setTask(c, 'extinguish', 0, at.x, at.y);
    });
  }
}
