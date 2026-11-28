// On-foot AI tasks. Each sets the ped's controls/aim/trigger for this tick.
import { angleDiff, dist } from '../../../shared/math';
import { WEAPONS } from '../../../shared/packs';
import { Mode } from '../../../shared/protocol';
import type { Ped, TaskName } from '../entities';
import { freeSeat, seatPed } from '../factory';
import type { World } from '../world';
import { CYCLE } from '../../../shared/world/traffic';
import { footDirection, resetFootRoute } from './footNavigation';
import { safeToCross } from './pedCrossings';
import { MEDICAL_TIMEOUT, nextPatient, needsMedic } from './medicalScene';
import { reachDist } from './doors';
import { soldierHostile } from './soldiers';
import { route } from '../systems/lifts';

export function setTask(p: Ped, task: TaskName, target = 0, tx = 0, ty = 0): void {
  const ai = p.ai!;
  resetFootRoute(p);
  ai.task = task; ai.t = 0; ai.target = target; ai.tx = tx; ai.ty = ty; ai.workT = 0;
  if (task !== 'wander') ai.crossing = 'none';
}

function stop(p: Ped): void {
  p.ctl.mx = 0; p.ctl.my = 0;
}

/** Steers toward a point with simple unsticking. Returns remaining distance. */
export function moveToward(w: World, p: Ped, tx: number, ty: number, speed: number, _dt: number): number {
  // Someone on another floor of a building (world/levels.ts): go via its door and lift.
  const via = route(w, p, tx, ty);
  if (via) { tx = via.x; ty = via.y; }
  const dx = tx - p.body.x, dy = ty - p.body.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) { stop(p); return d; }
  const { x: mx, y: my } = footDirection(w, p, { x: tx, y: ty }, speed);
  const k = speed / Math.max(speed, p.spec.runSpeed);
  p.ctl.mx = mx * k; p.ctl.my = my * k;
  p.ctl.sprint = speed > p.spec.walkSpeed * 1.5;
  if (!p.trigger) p.aim = Math.atan2(my, mx);
  return d;
}

const ringCorner = (r: { x0: number; y0: number; x1: number; y1: number }, c: number): [number, number] => {
  const i = 1.5;
  return [[r.x0 + i, r.y0 + i], [r.x1 - i, r.y0 + i], [r.x1 - i, r.y1 - i], [r.x0 + i, r.y1 - i]][c] as [number, number];
};

function snapToBlock(w: World, p: Ped): boolean {
  const ai = p.ai!;
  let b = w.map.blockAt(p.body.x, p.body.y);
  if (!b) {
    outer: for (const d of [6, 10, 14, 20]) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        b = w.map.blockAt(p.body.x + dx * d, p.body.y + dy * d);
        if (b) break outer;
      }
    }
  }
  if (!b) return false;
  ai.block = b.id;
  let best = 0, bd = Infinity;
  for (let c = 0; c < 4; c++) {
    const [cx, cy] = ringCorner(b.rect, c);
    const d = Math.hypot(cx - p.body.x, cy - p.body.y);
    if (d < bd) { bd = d; best = c; }
  }
  ai.corner = best;
  ai.cdir = w.rng.chance(0.5) ? 1 : -1;
  return true;
}

/** Walks the sidewalk ring around a block, sometimes crossing to a neighbouring block. */
export function wander(w: World, p: Ped, dt: number): void {
  const ai = p.ai!;
  if (ai.block < 0 && !snapToBlock(w, p)) { stop(p); return; }
  const block = w.city.blocks[ai.block];
  if (ai.crossing === 'waiting') {
    const waited = ai.workT;
    ai.workT += dt;
    if (waited > 0 && Math.floor(waited * 4) === Math.floor(ai.workT * 4)) { stop(p); return; }
    if (!safeToCross(w, p, ai.tx, ai.ty)) {
      // A wreck or parked car can block this crossing indefinitely. Try the next corner.
      if (ai.workT > CYCLE + 3) {
        ai.crossing = 'none';
        ai.corner = (ai.corner + ai.cdir + 4) % 4;
      }
      stop(p);
      return;
    }
    ai.crossing = 'walking';
  }
  const [tx, ty] = ai.crossing === 'walking' ? [ai.tx, ai.ty] : ringCorner(block.rect, ai.corner);
  const d = moveToward(w, p, tx, ty, p.spec.walkSpeed, dt);
  if (d > 1.2) return;
  if (ai.crossing === 'walking') { ai.crossing = 'none'; snapToBlock(w, p); return; }
  if (w.rng.chance(0.3)) {
    const c = ai.corner;
    const outs: [number, number][] = [[[0, -1], [-1, 0]], [[0, -1], [1, 0]], [[0, 1], [1, 0]], [[0, 1], [-1, 0]]][c] as [number, number][];
    const [ox, oy] = w.rng.pick(outs);
    for (let s = 8; s <= 26; s += 2) {
      const nb = w.map.blockAt(tx + ox * s, ty + oy * s);
      if (nb && nb.id !== block.id) {
        ai.tx = tx + ox * (s + 1.5); ai.ty = ty + oy * (s + 1.5);
        ai.crossing = 'waiting';
        ai.workT = 0;
        stop(p);
        return;
      }
      if (w.map.isWater(tx + ox * s, ty + oy * s)) break;
    }
  }
  if (w.rng.chance(0.06)) ai.cdir = ai.cdir === 1 ? -1 : 1;
  ai.corner = (ai.corner + ai.cdir + 4) % 4;
}

export function standAt(w: World, p: Ped, dt: number): void {
  const post = p.ai!.post;
  if (post && dist(p.body.x, p.body.y, post.x, post.y) > 1) { moveToward(w, p, post.x, post.y, p.spec.walkSpeed, dt); return; }
  stop(p);
  if (post) p.aim = post.angle;
}

export function flee(w: World, p: Ped, dt: number): boolean {
  const ai = p.ai!;
  const dx = p.body.x - ai.tx, dy = p.body.y - ai.ty;
  const d = Math.hypot(dx, dy) || 1;
  moveToward(w, p, p.body.x + (dx / d) * 10, p.body.y + (dy / d) * 10, p.spec.runSpeed, dt);
  return ai.t > 7 || d > 60;
}

/** Switches to the best weapon that still has ammo. */
export function armBest(p: Ped): void {
  for (let i = p.weapons.length - 1; i >= 0; i--) {
    const h = p.weapons[i];
    const s = WEAPONS[h.w];
    if (s.clip === 0 || h.clip + h.ammo > 0) {
      if (p.wi !== i) { p.wi = i; p.reloadT = 0; }
      return;
    }
  }
}

export function attack(w: World, p: Ped, dt: number): boolean {
  const ai = p.ai!;
  const t = w.peds.get(ai.target);
  if (!t || t.dead || (t.player && t.player.mode >= Mode.Dead)) { p.trigger = false; return true; }
  // Soldiers stand down once a player is off the base, not wanted enough and not fighting them.
  if (p.spec.behaviour === 'military' && !soldierHostile(w, p, t)) { p.trigger = false; return true; }
  armBest(p);
  const pos = w.pedPos(t);
  // On another floor: as far as the way round through the building, and out of sight.
  const { d, sameFloor } = reachDist(p.body.x, p.body.y, pos.x, pos.y);
  if (d > 110 || (d > 70 && ai.t > 20)) { p.trigger = false; return true; }
  const spec = WEAPONS[p.weapons[p.wi].w];
  const want = Math.atan2(pos.y - p.body.y, pos.x - p.body.x);
  const range = spec.kind === 'melee' ? 1.1 : Math.min(spec.range * 0.75, 32);
  const los = sameFloor && !w.statics.raycast(p.body.x, p.body.y, pos.x, pos.y, 1.2);
  if (d > range || !los) {
    moveToward(w, p, pos.x, pos.y, p.spec.runSpeed, dt);
    p.aim = want;
    p.trigger = los && spec.kind !== 'melee' && d < spec.range && w.rng.chance(0.5) ? !p.triggerPrev || spec.auto : false;
    return false;
  }
  stop(p);
  p.aim = p.aim + angleDiff(p.aim, want) * Math.min(1, dt * 10);
  const aligned = Math.abs(angleDiff(p.aim, want)) < 0.2;
  p.trigger = aligned && (spec.auto || !p.triggerPrev);
  return false;
}

export function arrest(w: World, p: Ped, dt: number): boolean {
  const ai = p.ai!;
  const t = w.peds.get(ai.target);
  const pl = t?.player;
  if (!t || !pl || t.dead || pl.wanted === 0 || pl.mode >= Mode.Dead) return true;
  const pos = w.pedPos(t);
  const { d, sameFloor } = reachDist(p.body.x, p.body.y, pos.x, pos.y);
  p.trigger = false;
  if (d > 100) return true;
  const reach = t.vehicle ? (w.vehicles.get(t.vehicle)?.spec.width ?? 2) / 2 + 1.6 : 1.5;
  if (d > reach || !sameFloor || w.statics.raycast(p.body.x, p.body.y, pos.x, pos.y, 1.2)) { moveToward(w, p, pos.x, pos.y, p.spec.runSpeed, dt); return false; }
  stop(p);
  p.aim = Math.atan2(pos.y - p.body.y, pos.x - p.body.x);
  const tv = t.vehicle ? w.vehicles.get(t.vehicle) : undefined;
  const slow = tv ? Math.hypot(tv.body.vx, tv.body.vy) < 1.5 : Math.hypot(t.body.vx, t.body.vy) < 2.6;
  if (slow) pl.bustT += dt * 2; // decays at 1x in the player system
  return false;
}

export function revive(w: World, p: Ped, dt: number): boolean {
  const ai = p.ai!;
  const body = w.peds.get(ai.target);
  if (!body || !needsMedic(body)) {
    stop(p);
    return !nextPatient(w, p);
  }
  const { x, y } = body.body;
  const { d, sameFloor } = reachDist(p.body.x, p.body.y, x, y);
  if (!sameFloor || d > 1.3 || w.statics.raycast(p.body.x, p.body.y, x, y, 1.2)) {
    ai.workT = 0;
    moveToward(w, p, x, y, p.spec.runSpeed, dt);
    return false;
  }
  stop(p);
  ai.workT += dt;
  if (ai.workT < 3) return false;
  body.dead = false;
  if (body.resident) delete body.resident.deceased;
  body.hp = body.spec.hp * 0.5;
  body.revived = true;
  const scene = w.squads.get(ai.squad)?.incident;
  if (scene) scene.expires = w.time + MEDICAL_TIMEOUT;
  if (body.ai) { body.ai.block = -1; setTask(body, body.ai.post ? 'stand' : 'wander'); }
  return !nextPatient(w, p);
}

export function extinguish(w: World, p: Ped, dt: number): boolean {
  const ai = p.ai!;
  let near: { x: number; y: number } | null = null, nd = Infinity;
  for (const f of w.fires.values()) {
    const d = dist(ai.tx, ai.ty, f.x, f.y);
    if (d < 25 && d < nd) { nd = d; near = f; }
  }
  for (const v of w.vehicles.values()) {
    if (v.burning < 0) continue;
    const d = dist(ai.tx, ai.ty, v.body.x, v.body.y);
    if (d < 25 && d < nd) { nd = d; near = v.body; }
  }
  if (!near || ai.t > 40) return true;
  const d = moveToward(w, p, near.x, near.y, p.spec.runSpeed, dt);
  if (d > 6) return false;
  stop(p);
  p.aim = Math.atan2(near.y - p.body.y, near.x - p.body.x);
  ai.workT += dt;
  for (const f of w.fires.values()) if (dist(near.x, near.y, f.x, f.y) < 7) f.life -= dt * 4;
  for (const v of w.vehicles.values()) {
    if (v.burning >= 0 && dist(near.x, near.y, v.body.x, v.body.y) < 7) { v.burning = -1; v.hp = Math.max(v.hp, 1); }
  }
  return false;
}

/** Walks back to the crew vehicle (ai.target) and gets in. */
export function returnToVehicle(w: World, p: Ped, dt: number): boolean {
  const v = w.vehicles.get(p.ai!.target);
  if (!v || v.wrecked || p.ai!.t > 30) return true;
  const d = moveToward(w, p, v.body.x, v.body.y, p.spec.runSpeed, dt);
  if (d > Math.max(v.spec.length, v.spec.width) / 2 + 1.4) return false;
  const seat = v.seats[0] ? freeSeat(v, 1) : 0;
  if (seat < 0) return true;
  seatPed(w, p, v, seat);
  setTask(p, seat === 0 ? 'drive' : 'none');
  return false;
}
