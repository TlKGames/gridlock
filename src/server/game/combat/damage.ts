// Applying damage, deaths, drops and explosions.
import { dist } from '../../../shared/math';
import { lawfulFaction, RULES, UNARMED, WEAPONS } from '../../../shared/packs';
import { materialOf } from '../../../shared/materials';
import { FX, Mode, PK } from '../../../shared/protocol';
import { onAttacked, onNoise } from '../ai/reactions';
import type { Ped, Vehicle } from '../entities';
import { unseatPed } from '../factory';
import { crime } from '../systems/wanted';
import type { World } from '../world';

export interface DamageOpts { fire?: boolean; blast?: boolean; melee?: boolean; vehicle?: boolean }

export function damagePed(w: World, v: Ped, amount: number, attackerId: number, opts: DamageOpts = {}): void {
  if (v.dead || amount <= 0) return;
  if (v.armor > 0 && !opts.fire) {
    const a = Math.min(v.armor, amount);
    v.armor -= a;
    amount -= a;
  }
  v.hp -= amount;
  const attacker = attackerId ? w.peds.get(attackerId) : undefined;
  const fresh = v.lastHitBy !== attackerId || w.time - v.lastHitT > 4;
  v.lastHitBy = attackerId;
  v.lastHitT = w.time;
  if (attacker && attacker.id !== v.id) {
    if (fresh && attacker.player) {
      crime(w, attacker, lawfulFaction(v.faction) ? 'assaultLaw' : 'assault', v.body.x, v.body.y);
    }
    onAttacked(w, v, attacker);
  }
  if (!opts.fire && !v.vehicle) w.emit(FX.Blood, Math.round(v.body.x * 10) / 10, Math.round(v.body.y * 10) / 10);
  if (v.hp <= 0) killPed(w, v, attacker ?? null, !!opts.vehicle);
}

/** `byVehicle`: run down by the killer's vehicle (vehicular homicide rather than murder). */
export function killPed(w: World, v: Ped, killer: Ped | null, byVehicle = false): void {
  v.dead = true;
  v.deadT = 0;
  v.hp = 0;
  v.burning = 0;
  v.trigger = false;
  if (v.vehicle) unseatPed(w, v, true);
  const pos = v.body;
  // Drops: cash and the best gun.
  const cash = v.player ? Math.floor(v.player.cash * RULES.deathCashLoss) : v.cash;
  if (v.player) v.player.cash -= cash;
  else v.cash = 0;
  if (cash > 0) dropPickup(w, PK.cash, pos.x + rand(w), pos.y + rand(w), cash, -1);
  const best = [...v.weapons].reverse().find((h) => h.w !== UNARMED && (h.ammo + h.clip > 0 || WEAPONS[h.w].clip === 0));
  if (best) dropPickup(w, PK.weapon, pos.x + rand(w), pos.y + rand(w), Math.max(best.ammo + best.clip, 0), best.w);

  const kp = killer?.player;
  if (kp && killer!.id !== v.id) {
    crime(w, killer!, lawfulFaction(v.faction) ? 'murderLaw' : byVehicle ? 'vehicularHomicide' : 'murder', pos.x, pos.y);
  }
  if (v.player) {
    const pl = v.player;
    pl.deaths++;
    pl.mode = Mode.Dead;
    pl.respawnT = 5;
    const by = kp && kp !== pl ? `${kp.name} killed ${pl.name}` : `${pl.name} got wasted`;
    w.notify('kill', by);
    if (RULES.loseWeaponsOnDeath) v.weapons = v.weapons.filter((h) => WEAPONS[h.w].clip === 0);
  } else if (kp) {
    w.notify('kill', `${kp.name} took out a ${v.spec.name.toLowerCase()}`, kp);
  }
  onNoise(w, pos.x, pos.y, 25, killer?.id ?? 0, true);
  w.onKill(killer, v);
}

const rand = (w: World) => w.rng.range(-0.8, 0.8);

export function dropPickup(w: World, type: number, x: number, y: number, value: number, weapon: number): void {
  if (w.map.isWater(x, y)) return;
  const id = w.id();
  w.pickups.set(id, { id, kind: 'pickup', type, x, y, value, weapon, life: 90 });
}

/** Which side of the vehicle faces a point: 0 front, 1 rear, 2 left, 3 right. */
export function sideFacing(v: Vehicle, x: number, y: number): number {
  const c = Math.cos(v.body.angle), s = Math.sin(v.body.angle);
  const lx = (x - v.body.x) * c + (y - v.body.y) * s, ly = -(x - v.body.x) * s + (y - v.body.y) * c;
  // Measured against the body's shape, so a hit near a corner of a long truck still reads as a side.
  if (Math.abs(lx) / (v.spec.length / 2) >= Math.abs(ly) / (v.spec.width / 2)) return lx >= 0 ? 0 : 1;
  return ly < 0 ? 2 : 3;
}

/** Damage per side as levels 0-3 (scuffed, dented, smashed), from the share of the vehicle's
 *  hit points that side has taken. */
const DENT_LEVELS = [0.06, 0.18, 0.35];
export function damageLevels(v: Vehicle): number[] {
  return v.dents.map((d) => DENT_LEVELS.filter((t) => d >= t * v.spec.hp).length);
}

/** `from`: where the hit came from (the shooter, the blast, the other car): that side of the body
 *  takes the dent. Without it (fire, flames) the damage is spread round. */
export function damageVehicle(w: World, v: Vehicle, amount: number, attackerId: number, from?: { x: number; y: number }): void {
  if (v.wrecked || amount <= 0) return;
  // The dents show the hit in full; the vehicle loses only part of it in health (RULES.vehicleHpTake).
  v.hp -= amount * RULES.vehicleHpTake;
  if (from) v.dents[sideFacing(v, from.x, from.y)] += amount;
  else for (let i = 0; i < 4; i++) v.dents[i] += amount / 4;
  const attacker = w.peds.get(attackerId);
  if (attacker) {
    for (const sid of v.seats) {
      const occ = sid ? w.peds.get(sid) : undefined;
      if (occ && occ.id !== attackerId) onAttacked(w, occ, attacker);
    }
  }
  if (v.hp <= 0 && v.burning < 0) {
    v.hp = 0;
    if (attacker?.player) v.stolenBy = attacker.player.id; // remembered for kill credit
    // A horse or a wagon goes down where it is; anything with fuel burns, then blows.
    if (!materialOf(v.spec).explodes) wreckVehicle(w, v);
    else v.burning = 0;
  }
}

/** Running into a wall: `impact` is the speed into it (from stepVehicle), (vx, vy) the velocity
 *  just before, so the side you were heading with takes the dent. Gentle bumps do nothing. */
export function wallCrash(w: World, v: Vehicle, impact: number, vx: number, vy: number): void {
  if (impact <= RULES.wallSafe) return;
  const sp = Math.hypot(vx, vy) || 1;
  const excess = impact - RULES.wallSafe;
  // A fast, square hit crushes more than a scrape. Keep light contacts near
  // the pack's base damage and cap the bonus at 50% for severe impacts.
  const progressive = v.spec.movement === 'wheels' || v.spec.movement === 'bike' || v.spec.movement === 'boat';
  const damage = excess * RULES.wallDamage * (progressive ? 1 + Math.min(0.5, excess / 40) : 1);
  damageVehicle(w, v, damage, 0, { x: v.body.x + (vx / sp) * 50, y: v.body.y + (vy / sp) * 50 });
  if (impact > 12) w.emit(FX.Spark, Math.round(v.body.x + (vx / sp) * v.spec.length / 2), Math.round(v.body.y + (vy / sp) * v.spec.length / 2));
}

/** Turns a burning vehicle into a wreck with a blast; one whose material doesn't explode (a
 *  horse, a wagon: shared/materials.ts) just goes down, throwing its riders. */
export function wreckVehicle(w: World, v: Vehicle): void {
  v.wrecked = true;
  v.burning = -1;
  v.wreckT = 0;
  v.siren = false;
  if (!materialOf(v.spec).explodes) {
    for (const sid of v.seats) {
      const occ = sid ? w.peds.get(sid) : undefined;
      if (occ && !occ.dead) { unseatPed(w, occ, true); damagePed(w, occ, 15, 0); }
    }
    v.body.vx = 0; v.body.vy = 0; v.body.av = 0;
    return;
  }
  const credit = v.stolenBy ? w.players.get(v.stolenBy) : undefined;
  const creditPed = credit ? w.peds.get(credit.pid) : undefined;
  for (const sid of v.seats) {
    const occ = sid ? w.peds.get(sid) : undefined;
    if (occ && !occ.dead) killPed(w, occ, creditPed ?? null);
  }
  explode(w, v.body.x, v.body.y, 7, 140, creditPed?.id ?? 0, v.id);
}

export function explode(w: World, x: number, y: number, radius: number, dmg: number, attackerId: number, skipVeh = 0): void {
  w.emit(FX.Boom, Math.round(x * 10) / 10, Math.round(y * 10) / 10, radius);
  const attacker = w.peds.get(attackerId);
  if (attacker?.player) crime(w, attacker, 'explosion', x, y);
  w.pedsNear(x, y, radius, (p) => {
    if (p.dead) return;
    const d = dist(x, y, p.body.x, p.body.y);
    const k = Math.pow(1 - d / radius, 0.7);
    const dx = (p.body.x - x) / (d || 1), dy = (p.body.y - y) / (d || 1);
    p.body.vx += dx * 14 * k; p.body.vy += dy * 14 * k;
    // Only a close blast floors you (players are a bit sturdier).
    if (k > (p.player ? 0.5 : 0.3)) p.down = Math.max(p.down, 1.5 * k);
    damagePed(w, p, dmg * k, attackerId, { blast: true });
  });
  w.vehiclesNear(x, y, radius + 4, (v) => {
    if (v.id === skipVeh) return;
    const d = dist(x, y, v.body.x, v.body.y);
    const k = Math.max(0, 1 - Math.max(0, d - v.spec.length / 3) / radius);
    if (k <= 0) return;
    const push = (dmg * 60 * k) / v.spec.mass;
    v.body.vx += ((v.body.x - x) / (d || 1)) * push;
    v.body.vy += ((v.body.y - y) / (d || 1)) * push;
    v.body.av += (w.rng.next() - 0.5) * push * 0.3;
    damageVehicle(w, v, dmg * 2.4 * k, attackerId, { x, y });
  });
  if (w.rng.chance(0.35) && !w.map.isWater(x, y)) spawnFire(w, x, y, 2.5, 8, attackerId);
  onNoise(w, x, y, 70, attackerId, true);
  w.onExplosion(x, y, radius, attackerId);
}

export function spawnFire(w: World, x: number, y: number, r: number, life: number, owner: number): void {
  if (w.fires.size > 60 || w.map.isWater(x, y)) return;
  const id = w.id();
  w.fires.set(id, { id, kind: 'fire', x, y, r, life, owner });
}
