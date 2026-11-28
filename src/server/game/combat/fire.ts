// Firing weapons: cooldowns, ammo and reloads; melee, hitscan, flame and projectiles.
import { angleDiff, r2 } from '../../../shared/math';
import { VEHICLES, WEAPONS, type WeaponSpec, weaponIndex } from '../../../shared/packs';
import { flies } from '../../../shared/sim/kinds';
import { materialOf } from '../../../shared/materials';
import { firingArc } from '../../../shared/sim/firingArc';
import { FX, HIT } from '../../../shared/protocol';
import { rayAabb, rayCircle } from '../../../shared/world/collision';
import { onNoise } from '../ai/reactions';
import type { Ped, Vehicle } from '../entities';
import { crime } from '../systems/wanted';
import type { World } from '../world';
import { damagePed, damageVehicle, spawnFire } from './damage';

/** Blows on the same person closer together than this (s) count toward a combo. */
const COMBO_GAP = 1.5;

const vehicleWeaponIds = new Map<string, number>();
const vw = (id: string) => {
  let i = vehicleWeaponIds.get(id);
  if (i === undefined) { i = weaponIndex(id); vehicleWeaponIds.set(id, i); }
  return i;
};

/** Ticks cooldown and reload timers. */
export function tickWeapon(p: Ped, dt: number): void {
  p.fireCd = Math.max(0, p.fireCd - dt);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      const h = p.weapons[p.wi];
      if (h) {
        const need = WEAPONS[h.w].clip - h.clip;
        const take = Math.min(need, h.ammo);
        h.clip += take;
        h.ammo -= take;
      }
    }
  }
}

/** Drops an empty gun for the best weapon that still has ammo (fists as a last resort). */
function switchFromEmpty(p: Ped): void {
  for (let i = p.weapons.length - 1; i >= 0; i--) {
    const h = p.weapons[i];
    if (WEAPONS[h.w].clip === 0 || h.clip + h.ammo > 0) { p.wi = i; return; }
  }
}

/** The weapon a ped would fire right now (vehicle-mounted when driving an armed vehicle). */
export function activeWeapon(w: World, p: Ped): { spec: WeaponSpec; index: number; mounted: Vehicle | null } | null {
  if (p.vehicle) {
    const v = w.vehicles.get(p.vehicle);
    if (!v) return null;
    if (p.seat === 0 && v.spec.weapons?.length) {
      const id = v.spec.weapons[v.vw % v.spec.weapons.length];
      const index = vw(id);
      return { spec: WEAPONS[index], index, mounted: v };
    }
    const h = p.weapons[p.wi];
    if (!h || !WEAPONS[h.w].driveBy) return null;
    return { spec: WEAPONS[h.w], index: h.w, mounted: null };
  }
  const h = p.weapons[p.wi];
  return h ? { spec: WEAPONS[h.w], index: h.w, mounted: null } : null;
}

/** Fires if the trigger is held and the weapon is ready. */
export function tryFire(w: World, p: Ped): void {
  const prev = p.triggerPrev;
  p.triggerPrev = p.trigger;
  if (!p.trigger || p.dead || p.down > 0 || (p.stagger ?? 0) > 0 || p.fireCd > 0) return;
  const aw = activeWeapon(w, p);
  if (!aw) return;
  const { spec, index, mounted } = aw;
  if (!spec.auto && prev) return;
  // A hand weapon from a vehicle: not behind you (shared/sim/firingArc.ts; a little slack for the
  // heading moving on since the client aimed).
  if (!mounted && p.vehicle) {
    const v = w.vehicles.get(p.vehicle);
    if (v && !flies(v.spec) && Math.abs(angleDiff(v.body.angle, p.aim)) > firingArc(v.spec) + 0.1) return;
  }
  if (!mounted && spec.clip > 0) {
    // GTA2 has no reloading: fire straight through your ammo, then move to another weapon.
    const h = p.weapons[p.wi];
    if (h.clip <= 0 && h.ammo > 0) {
      const take = Math.min(spec.clip, h.ammo);
      h.clip += take;
      h.ammo -= take;
    }
    if (h.clip <= 0) { switchFromEmpty(p); return; }
    h.clip--;
    if (h.clip + h.ammo === 0) switchFromEmpty(p);
  }
  p.fireCd = 1 / spec.rate;

  const origin = muzzle(w, p, mounted, spec);
  if (spec.kind !== 'melee' && p.player) crime(w, p, 'gunfire', origin.x, origin.y);
  if (spec.kind !== 'melee') onNoise(w, origin.x, origin.y, spec.kind === 'flame' ? 20 : 45, p.id, false);

  const aim = origin.angle;
  const npcSpread = p.player ? 1 : 1.8 - p.spec.accuracy;
  switch (spec.kind) {
    case 'melee': melee(w, p, spec, aim); break;
    case 'hitscan': {
      const pellets = spec.pellets ?? 1;
      for (let k = 0; k < pellets; k++) {
        const a = aim + (w.rng.next() - 0.5) * 2 * spec.spread * npcSpread;
        hitscan(w, p, origin.x, origin.y, origin.z, a, spec, index, mounted?.id ?? p.vehicle);
      }
      break;
    }
    case 'flame': flame(w, p, origin.x, origin.y, aim, spec, index); break;
    case 'projectile':
    case 'thrown': launch(w, p, origin.x, origin.y, origin.z, aim, spec, index); break;
  }
}

function muzzle(w: World, p: Ped, mounted: Vehicle | null, spec: WeaponSpec): { x: number; y: number; z: number; angle: number } {
  if (p.vehicle) {
    const v = w.vehicles.get(p.vehicle)!;
    const b = v.body;
    if (mounted) {
      const isHeli = flies(mounted.spec);
      // Helicopter guns fire within a cone around the nose; turrets use their own angle.
      const angle = isHeli ? b.angle + Math.max(-0.5, Math.min(0.5, angleDiff(b.angle, p.aim))) : mounted.turret;
      const reach = isHeli ? mounted.spec.length * 0.45 : mounted.spec.length * 0.55;
      return { x: b.x + Math.cos(angle) * reach, y: b.y + Math.sin(angle) * reach, z: Math.max(1.2, b.alt), angle };
    }
    const off = v.spec.width / 2 + 0.3;
    const side = angleDiff(b.angle, p.aim) > 0 ? 1 : -1;
    return { x: b.x - Math.sin(b.angle) * off * side, y: b.y + Math.cos(b.angle) * off * side, z: Math.max(1.2, b.alt), angle: p.aim };
  }
  const reach = 0.4 + spec.size * 0.6;
  return { x: p.body.x + Math.cos(p.aim) * reach, y: p.body.y + Math.sin(p.aim) * reach, z: 1.2, angle: p.aim };
}

function melee(w: World, p: Ped, spec: WeaponSpec, aim: number): void {
  w.emit(FX.Swing, p.id);
  let best: Ped | null = null, bestD = Infinity;
  w.pedsNear(p.body.x, p.body.y, spec.range + 0.5, (o) => {
    if (o === p || o.dead) return;
    const d = Math.hypot(o.body.x - p.body.x, o.body.y - p.body.y);
    const ang = Math.atan2(o.body.y - p.body.y, o.body.x - p.body.x);
    if (Math.abs(angleDiff(aim, ang)) > spec.spread || d >= bestD) return;
    best = o; bestD = d;
  });
  if (best) {
    const o = best as Ped;
    // The blow lands: a shove they reel from (no control while they slide), and a thud.
    const push = spec.knockback ?? 3;
    o.body.vx = Math.cos(aim) * push; o.body.vy = Math.sin(aim) * push;
    o.stagger = Math.max(o.stagger ?? 0, spec.stagger ?? 0.3);
    // Three in a row on the same person floors them; heavy weapons can on their own (players
    // only to the big ones, and rarely).
    const c = p.combo && p.combo.target === o.id && w.time - p.combo.t < COMBO_GAP ? p.combo : { target: o.id, hits: 0, t: 0 };
    c.hits++; c.t = w.time;
    p.combo = c;
    const heavy = o.player ? spec.damage >= 40 && w.rng.chance(0.35) : spec.damage > 30 || w.rng.chance(0.15);
    if (c.hits >= 3 || heavy) { o.down = Math.max(o.down, 1.0); c.hits = 0; }
    w.emit(FX.Hit, p.id, o.id, WEAPONS.indexOf(spec));
    damagePed(w, o, spec.damage, p.id, { melee: true });
    return;
  }
  w.vehiclesNear(p.body.x, p.body.y, spec.range + 3, (v) => {
    if (v.id === p.vehicle) return;
    const hit = rayVehicle(p.body.x, p.body.y, Math.cos(aim) * (spec.range + 0.5), Math.sin(aim) * (spec.range + 0.5), v);
    if (hit !== null) damageVehicle(w, v, spec.damage * spec.vehicleMul, p.id, p.body);
  });
}

export function rayVehicle(x0: number, y0: number, dx: number, dy: number, v: Vehicle): number | null {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  const lx = (x0 - b.x) * c + (y0 - b.y) * s, ly = -(x0 - b.x) * s + (y0 - b.y) * c;
  const ldx = dx * c + dy * s, ldy = -dx * s + dy * c;
  const hl = v.spec.length / 2, hw = v.spec.width / 2;
  const h = rayAabb(lx, ly, ldx, ldy, { x0: -hl, y0: -hw, x1: hl, y1: hw, h: 0 });
  return h ? h.t : null;
}

function hitscan(w: World, p: Ped, x0: number, y0: number, z: number, angle: number, spec: WeaponSpec, wIndex: number, ownVeh: number): void {
  const dx = Math.cos(angle) * spec.range, dy = Math.sin(angle) * spec.range;
  const wall = w.statics.raycast(x0, y0, x0 + dx, y0 + dy, z > 4 ? z - 2 : 1.2);
  let t = wall ? wall.t : 1;
  let hitPed: Ped | null = null, hitVeh: Vehicle | null = null;
  const mx = x0 + dx / 2, my = y0 + dy / 2, rr = spec.range / 2 + 2;
  w.pedHash.query(mx, my, rr, (o) => {
    if (o === p || o.dead) return;
    const h = rayCircle(x0, y0, dx, dy, o.body.x, o.body.y, o.down > 0 ? 0.3 : 0.45);
    if (h && h.t < t) { t = h.t; hitPed = o; hitVeh = null; }
  });
  w.vehHash.query(mx, my, rr + 8, (v) => {
    if (v.id === ownVeh) return;
    const ht = rayVehicle(x0, y0, dx, dy, v);
    if (ht !== null && ht < t) { t = ht; hitVeh = v; hitPed = null; }
  });
  let hitType: number = wall && t === wall.t ? HIT.wall : HIT.none;
  if (hitPed) {
    damagePed(w, hitPed, spec.damage, p.id);
    hitType = HIT.flesh;
  } else if (hitVeh) {
    const v = hitVeh as Vehicle;
    // Sparks off metal, dust off wood, blood from a horse (shared/materials.ts).
    const mat = materialOf(v.spec);
    hitType = mat.hit;
    if (mat.bleeds) w.emit(FX.Blood, r2(x0 + dx * t), r2(y0 + dy * t));
    damageVehicle(w, v, spec.damage * spec.vehicleMul, p.id, { x: x0, y: y0 });
    // The driver feels a bullet strike even when the shooter is outside hearing range.
    const driver = w.peds.get(v.seats[0]);
    if (!v.wrecked && driver?.ai && !driver.dead && driver.spec.behaviour === 'civilian') {
      driver.ai.panicT = Math.max(driver.ai.panicT, 6);
    }
    if (!v.spec.armored) {
      // Bullets through glass and open tops can reach occupants.
      for (const sid of v.seats) {
        const occ = sid ? w.peds.get(sid) : undefined;
        if (occ && w.rng.chance(v.spec.openTop ? 0.6 : 0.18)) damagePed(w, occ, spec.damage * 0.7, p.id);
      }
    }
  }
  // The shooter goes along so the tracer can leave their gun as it's drawn (the hit line itself
  // runs from their body the way they aim).
  w.emit(FX.Shot, r2(x0), r2(y0), r2(x0 + dx * t), r2(y0 + dy * t), wIndex, hitType, p.id);
}

function flame(w: World, p: Ped, x0: number, y0: number, aim: number, spec: WeaponSpec, wIndex: number): void {
  const range = spec.range;
  w.emit(FX.Shot, r2(x0), r2(y0), r2(x0 + Math.cos(aim) * range), r2(y0 + Math.sin(aim) * range), wIndex, HIT.none, p.id);
  w.pedsNear(x0, y0, range, (o) => {
    if (o === p || o.dead) return;
    const ang = Math.atan2(o.body.y - y0, o.body.x - x0);
    if (Math.abs(angleDiff(aim, ang)) > spec.spread * 1.4) return;
    o.burning = Math.max(o.burning, 3.5);
    damagePed(w, o, spec.damage, p.id, { fire: true });
  });
  w.vehiclesNear(x0, y0, range + 3, (v) => {
    if (v.id === p.vehicle) return;
    const ang = Math.atan2(v.body.y - y0, v.body.x - x0);
    if (Math.abs(angleDiff(aim, ang)) > spec.spread * 1.6) return;
    damageVehicle(w, v, spec.damage * spec.vehicleMul, p.id);
  });
  if (w.rng.chance(0.08)) {
    const d = range * w.rng.range(0.6, 1);
    const wall = w.statics.raycast(x0, y0, x0 + Math.cos(aim) * d, y0 + Math.sin(aim) * d);
    const t = wall ? wall.t * 0.9 : 1;
    spawnFire(w, x0 + Math.cos(aim) * d * t, y0 + Math.sin(aim) * d * t, 1.8, 5, p.id);
  }
}

function launch(w: World, p: Ped, x: number, y: number, z: number, angle: number, spec: WeaponSpec, wIndex: number): void {
  const pr = spec.projectile!;
  const id = w.id();
  const arc = !!pr.arc;
  // Thrown objects are lobbed to land around 80% of their range.
  const flight = arc ? (spec.range * 0.8) / pr.speed : 0;
  const isHeli = p.vehicle && flies(VEHICLES[w.vehicles.get(p.vehicle)!.type]);
  const vz = arc ? (9.8 * flight) / 2 : isHeli ? -z / ((spec.range * 0.6) / pr.speed) : 0;
  w.projectiles.set(id, {
    id, kind: 'proj', weapon: wIndex, owner: p.id, x, y, z: arc ? 1.4 : z,
    vx: Math.cos(angle) * pr.speed, vy: Math.sin(angle) * pr.speed, vz, angle,
    life: Math.max(1, spec.range / pr.speed + 1.5), fuse: pr.fuse ?? 0,
  });
  w.emit(FX.Throw, p.id, wIndex);
}
