// Creating, seating and removing entities.
import { newVin } from './vehicleRegistry';
import { generateName } from '../../shared/packs/characters';
import { Rng } from '../../shared/rng';
import { PEDS, UNARMED, VEHICLES, WEAPONS, paletteFor, weaponIndex } from '../../shared/packs';
import { emptyControls, newBody } from '../../shared/sim/physics';
import type { Ai, HeldWeapon, Ped, Vehicle } from './entities';
import type { World } from './world';

export function newAi(): Ai {
  return {
    task: 'none', t: 0, think: Math.random() * 0.5, target: 0, tx: 0, ty: 0,
    block: -1, corner: 0, cdir: 1, crossing: 'none', drive: null, post: null, squad: 0, crew: 0, panicT: 0,
    enemy: 0, enemyT: 0, workT: 0,
  };
}

export function spawnPed(w: World, arch: number, x: number, y: number, angle = 0, withAi = true): Ped {
  const spec = PEDS[arch];
  const weapons: HeldWeapon[] = [{ w: UNARMED, ammo: 0, clip: 0 }];
  for (const l of spec.loadout) {
    if (w.rng.chance(l.chance)) giveWeapon({ weapons } as Ped, weaponIndex(l.weapon), l.ammo);
  }
  const p: Ped = {
    id: w.id(), kind: 'ped', arch, spec, faction: spec.faction,
    body: newBody(x, y, angle), ctl: emptyControls(),
    hp: spec.hp, armor: spec.armor, dead: false, deadT: 0, down: 0, burning: 0,
    weapons, wi: weapons.length - 1, fireCd: 0, reloadT: 0, trigger: false, triggerPrev: false, aim: angle,
    cash: Math.round(w.rng.range(spec.cash[0], spec.cash[1])),
    vehicle: 0, seat: -1, player: null, ai: withAi ? newAi() : null,
    lastHitBy: 0, lastHitT: -99, persistent: false, revived: false, swimT: 0, jumpT: 0,
  };
  if (withAi) {
    const rng = new Rng(w.seed ^ Math.imul(p.id, 2654435761));
    p.npcName = generateName(() => rng.next(), rng.chance(0.5) ? 'female' : 'male');
  }
  w.peds.set(p.id, p);
  return p;
}

/** Adds a weapon (or ammo for one already held). Returns the slot index. */
export function giveWeapon(p: Ped, wi: number, ammo: number): number {
  const spec = WEAPONS[wi];
  const have = p.weapons.findIndex((h) => h.w === wi);
  if (have >= 0) {
    p.weapons[have].ammo += ammo;
    return have;
  }
  const clip = Math.min(spec.clip, ammo);
  p.weapons.push({ w: wi, ammo: ammo - clip, clip });
  p.weapons.sort((a, b) => WEAPONS[a.w].slot - WEAPONS[b.w].slot || a.w - b.w);
  return p.weapons.findIndex((h) => h.w === wi);
}

export function spawnVehicle(w: World, type: number, x: number, y: number, angle: number, color = -1, registration: { vin?: string; owner?: string; slot?: string } = {}): Vehicle {
  const spec = VEHICLES[type];
  const pal = paletteFor(spec.colors);
  const v: Vehicle = {
    vin: registration.vin ?? newVin(), id: w.id(), kind: 'veh', type, spec, body: newBody(x, y, angle), ctl: emptyControls(),
    color: color >= 0 ? color : pal[Math.floor(w.rng.next() * pal.length)],
    hp: spec.hp, burning: -1, wrecked: false, wreckT: 0,
    seats: new Array(Math.max(1, spec.seats)).fill(0),
    siren: false, turret: angle, fireCd: 0, vw: 0, owner: 0, persistent: false, sinkT: 0, idleT: 0, spot: -1,
    stolenBy: 0, horn: false, trailer: angle, dents: [0, 0, 0, 0],
    stamina: spec.stamina?.gallop ?? 0, blown: false, calledBy: 0, rearT: 0, boltT: 0, boltX: 0, boltY: 0,
  };
  w.registry.registerSpawn(v, registration.owner, registration.slot);
  w.vehicles.set(v.id, v);
  return v;
}

export function seatPed(w: World, p: Ped, v: Vehicle, seat: number): void {
  if (p.vehicle) unseatPed(w, p, false);
  v.seats[seat] = p.id;
  if (seat === 0) {
    v.spot = -1;
    w.registry.drive(p, v);
  }
  p.vehicle = v.id;
  p.seat = seat;
  p.body.x = v.body.x; p.body.y = v.body.y;
  p.body.vx = 0; p.body.vy = 0;
}

/** Removes a ped from its vehicle, placing it beside the door if `place`. */
export function unseatPed(w: World, p: Ped, place = true): void {
  const v = w.vehicles.get(p.vehicle);
  if (v) {
    w.registry.exit(p, v);
    const curbExit = p.seat === 0 && !!v.parkingTarget;
    if (p.seat === 0) delete v.parkingTarget;
    if (v.seats[p.seat] === p.id) v.seats[p.seat] = 0;
    if (place) placeBeside(w, p, v, p.seat % 2 === 0 && !curbExit ? -1 : 1);
  }
  p.vehicle = 0;
  p.seat = -1;
}

function placeBeside(w: World, p: Ped, v: Vehicle, side: number): void {
  const b = v.body;
  const off = v.spec.width / 2 + 0.7;
  for (const s of [side, -side]) {
    const x = b.x + -Math.sin(b.angle) * off * s, y = b.y + Math.cos(b.angle) * off * s;
    const probe = { x, y };
    if (!w.statics.resolveCircle(probe, 0.35) && !w.map.isWater(x, y)) {
      p.body.x = x; p.body.y = y; p.body.alt = 0;
      return;
    }
  }
  p.body.x = b.x - Math.cos(b.angle) * (v.spec.length / 2 + 1);
  p.body.y = b.y - Math.sin(b.angle) * (v.spec.length / 2 + 1);
  w.statics.resolveCircle(p.body, 0.35);
}

/** Dry ground to step out of a boat onto: beside it, ahead or behind, within a long step of the
 *  hull (the bank, a quay, a bridge end), or null out on open water. */
export function shoreBeside(w: World, v: Vehicle): { x: number; y: number } | null {
  const b = v.body, c = Math.cos(b.angle), s = Math.sin(b.angle);
  const hw = v.spec.width / 2, hl = v.spec.length / 2;
  for (const reach of [0.6, 1.2, 2.0, 3.0]) {
    for (const [fwd, side] of [[0, 1], [0, -1], [0.6, 1], [0.6, -1], [-0.6, 1], [-0.6, -1], [1, 0], [-1, 0]]) {
      const along = side ? fwd * hl : fwd * (hl + reach); // beside the hull, or off the bow / stern
      const across = side * (hw + reach);
      const x = b.x + c * along - s * across, y = b.y + s * along + c * across;
      if (!w.map.isWater(x, y) && !w.statics.resolveCircle({ x, y }, 0.35)) return { x, y };
    }
  }
  return null;
}

export function freeSeat(v: Vehicle, from = 0): number {
  for (let i = from; i < v.seats.length; i++) if (!v.seats[i]) return i;
  return -1;
}

export function driverOf(w: World, v: Vehicle): Ped | null {
  return v.seats[0] ? w.peds.get(v.seats[0]) ?? null : null;
}

export function removePed(w: World, p: Ped): void {
  if (p.vehicle) unseatPed(w, p, false);
  w.peds.delete(p.id);
}

export function removeVehicle(w: World, v: Vehicle, unload = false): void {
  w.registry.remove(v, unload);
  for (const id of v.seats) {
    const p = id ? w.peds.get(id) : undefined;
    if (!p) continue;
    if (p.player) unseatPed(w, p, true);
    else removePed(w, p);
  }
  w.vehicles.delete(v.id);
}
