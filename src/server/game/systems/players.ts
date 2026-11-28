// Applies player inputs (movement, weapons, vehicles) and handles death/busted/respawn.
import { dist } from '../../../shared/math';
import { PLAYER_ARCHETYPE, RULES, UNARMED, WEAPONS, weaponIndex } from '../../../shared/packs';
import { flies, floats, onRails } from '../../../shared/sim/kinds';
import { stationEnter, trainLeave } from './trains';
import { BTN, EDGE_BUTTONS, type InputMsg, Mode, type S2C } from '../../../shared/protocol';
import { SPRINT, stepVehicle, wearOf } from '../../../shared/sim/physics';
import { damagePed, killPed, wallCrash } from '../combat/damage';
import { climbStairs, leaveOnRoof } from './lifts';
import { callMount, canGallop } from './mounts';
import { toggleHitch } from './hitching';
import { reinIn } from './spook';
import { onAttacked } from '../ai/reactions';
import { tickWeapon, tryFire } from '../combat/fire';
import type { Ped, Player, Vehicle } from '../entities';
import { freeSeat, giveWeapon, seatPed, shoreBeside, spawnPed, unseatPed } from '../factory';
import type { World } from '../world';
import { stepPedBody, turnTurret } from './movement';
import { clearHeat, crime } from './wanted';

export const JUMP_TIME = 0.5;

export function processPlayers(w: World, dt: number): void {
  for (const pl of w.players.values()) {
    const p = w.peds.get(pl.pid);
    if (!p) continue;
    // Into a car whose radio someone retuned: tune in to the same station.
    if (p.vehicle !== (pl.radioVid ?? 0)) {
      pl.radioVid = p.vehicle;
      const station = w.vehicles.get(p.vehicle)?.radio;
      if (station !== undefined) pl.send({ t: 'radio', vid: p.vehicle, station } satisfies S2C);
    }
    if (pl.mode === Mode.Dead || pl.mode === Mode.Busted) {
      pl.queue.length = 0;
      pl.respawnT -= dt;
      if (p.dead) stepPedBody(w, p, dt, 0);
      if (pl.respawnT <= 0) respawn(w, pl, p);
      continue;
    }
    const count = pl.queue.length > 4 ? pl.queue.length - 2 : Math.min(1, pl.queue.length);
    if (count === 0) {
      const stale = [...pl.last] as InputMsg;
      stale[6] &= ~EDGE_BUTTONS;
      applyInput(w, pl, p, stale, dt);
    } else {
      for (let k = 0; k < count; k++) {
        const inp = pl.queue.shift()!;
        pl.last = inp;
        pl.ack = inp[0];
        applyInput(w, pl, p, inp, dt);
      }
    }
    climbStairs(w, pl, p);
    pl.bustT = Math.max(0, pl.bustT - dt);
    if (pl.bustT > 1.4) bust(w, pl, p);
  }
}

function applyInput(w: World, pl: Player, p: Ped, inp: InputMsg, dt: number): void {
  if (p.dead) return;
  const [, mx, my, throttle, steer, aim, btn, wish] = inp;
  p.aim = aim;
  p.aimHeld = (btn & BTN.aim) !== 0;
  p.trigger = (btn & BTN.fire) !== 0;
  if (btn & BTN.enter) toggleVehicle(w, pl, p);
  const v = p.vehicle ? w.vehicles.get(p.vehicle) : undefined;
  if (btn & (BTN.next | BTN.prev)) {
    if (v && p.seat === 0 && v.spec.weapons && v.spec.weapons.length > 1) v.vw = (v.vw + 1) % v.spec.weapons.length;
    else cycleWeapon(p, btn & BTN.next ? 1 : -1);
  }
  if (wish >= 0 && wish < p.weapons.length && wish !== p.wi) { p.wi = wish; p.reloadT = 0; }
  if (v) {
    if (p.seat === 0) {
      v.ctl.throttle = throttle; v.ctl.steer = steer;
      v.ctl.handbrake = (btn & BTN.handbrake) !== 0;
      // A mount gallops on Sprint while it has the wind (systems/mounts.ts spends and restores it).
      v.ctl.sprint = (btn & BTN.sprint) !== 0 && canGallop(v);
      reinIn(v); // a rearing horse won't go, a lame one won't go faster than a trot (systems/spook.ts)
      v.ctl.up = (btn & BTN.up) !== 0; v.ctl.down = (btn & BTN.down) !== 0;
      if (btn & BTN.horn) { if (v.spec.siren) v.siren = !v.siren; else v.horn = true; }
      if (btn & BTN.hitch) toggleHitch(w, pl, v);
      const vx = v.body.vx, vy = v.body.vy;
      wallCrash(w, v, stepVehicle(v.body, v.spec, v.ctl, dt, w.statics, true, (x, y) => w.map.onRoad(x, y), wearOf(v.hp / v.spec.hp, v.id)), vx, vy);
      if (v.spec.turret) v.turret = turnTurret(v.turret, aim, dt, v.spec.turret);
      p.body.x = v.body.x; p.body.y = v.body.y;
    }
  } else {
    if (btn & BTN.call) callMount(w, pl);
    p.ctl.mx = mx; p.ctl.my = my;
    // GTA2 jump: a short hop at running speed; cars pass under you while airborne.
    p.jumpT = Math.max(0, p.jumpT - dt);
    if (btn & BTN.jump && p.jumpT === 0 && p.down <= 0) p.jumpT = JUMP_TIME;
    stepPedBody(w, p, dt, p.spec.runSpeed * (btn & BTN.sprint ? SPRINT : 1));
    p.body.angle = aim;
  }
  tickWeapon(p, dt);
  tryFire(w, p);
}

function cycleWeapon(p: Ped, dir: number): void {
  const n = p.weapons.length;
  if (n < 2) return;
  for (let k = 1; k <= n; k++) {
    const i = (p.wi + dir * k + n * 4) % n;
    const h = p.weapons[i];
    if (WEAPONS[h.w].clip === 0 || h.ammo + h.clip > 0) { p.wi = i; p.reloadT = 0; return; }
  }
}

function nearestVehicle(w: World, p: Ped): Vehicle | null {
  let best: Vehicle | null = null, bd = Infinity;
  w.vehiclesNear(p.body.x, p.body.y, 9, (v) => {
    // A seatless vehicle (a wagon standing without its team) can't be got into.
    // A train is boarded at a station (systems/trains.ts), not like a car.
    if (v.wrecked || v.burning >= 0 || v.spec.seats === 0 || onRails(v.spec) || (flies(v.spec) && v.body.alt > 1)) return;
    const d = dist(p.body.x, p.body.y, v.body.x, v.body.y) - Math.max(v.spec.length, v.spec.width) / 2;
    if (d < 1.8 && d < bd) { bd = d; best = v; }
  });
  return best;
}

function toggleVehicle(w: World, pl: Player, p: Ped): void {
  if (p.vehicle) {
    const v = w.vehicles.get(p.vehicle);
    if (v && onRails(v.spec)) { trainLeave(w, pl, p, v); return; }
    if (v && flies(v.spec)) {
      const floor = w.statics.floorAt(v.body.x, v.body.y);
      if (v.body.alt > floor + 1) return; // still in the air
      if (floor > 0) { // set down on a roof
        const err = leaveOnRoof(w, p, v);
        if (err) w.notify('info', err, pl);
        else if (v.seats[0] === 0) { v.ctl.throttle = 0; v.ctl.steer = 0; }
        return;
      }
    }
    // Out of a boat: onto the shore beside it, or not at all out on open water. Slow enough to step
    // off (no bailing out of a boat at speed).
    if (v && floats(v.spec)) {
      const at = Math.hypot(v.body.vx, v.body.vy) < 3 ? shoreBeside(w, v) : null;
      if (!at) { w.notify('info', 'Pull up to the shore to get out.', pl); return; }
      unseatPed(w, p, false);
      p.body.x = at.x; p.body.y = at.y; p.body.alt = 0;
      if (v.seats[0] === 0) { v.ctl.throttle = 0; v.ctl.steer = 0; }
      return;
    }
    // Bailing out on the move: step out at a crawl, get thrown down and hurt faster, and at speed
    // it's the last thing you do. The vehicle rolls on without you.
    const speed = v ? Math.hypot(v.body.vx, v.body.vy) : 0;
    unseatPed(w, p, true);
    if (v && v.seats[0] === 0) { v.ctl.throttle = 0; v.ctl.steer = 0; }
    if (speed >= RULES.bailDie) killPed(w, p, null, true);
    else if (speed > RULES.bailFall) {
      // Down briefly just over the line, longer the harder you hit the road.
      p.down = Math.max(p.down, 0.5 + (speed - RULES.bailFall) * 0.05);
      damagePed(w, p, (speed - RULES.bailFall) ** 2 * 0.2, 0, { vehicle: true });
    }
    return;
  }
  const v = nearestVehicle(w, p);
  // No car to hand: at a station, take the train.
  if (!v) { stationEnter(w, pl, p); return; }
  const driver = v.seats[0] ? w.peds.get(v.seats[0]) : undefined;
  if (driver?.player) {
    const seat = freeSeat(v, 1);
    if (seat > 0) seatPed(w, p, v, seat);
    return;
  }
  if (driver) {
    unseatPed(w, driver, true);
    driver.down = 1;
    crime(w, p, 'carjack', v.body.x, v.body.y);
    onAttacked(w, driver, p);
    // Passengers bail out of a jacked car.
    for (const sid of v.seats) {
      const o = sid ? w.peds.get(sid) : undefined;
      if (o && !o.player) { unseatPed(w, o, true); onAttacked(w, o, p); }
    }
  } else if (v.owner !== pl.id && w.registry.get(v)?.owner !== 'player:' + pl.ownerKey && v.stolenBy !== pl.id) {
    crime(w, p, 'vehicleTheft', v.body.x, v.body.y);
  }
  if (v.owner !== pl.id) v.stolenBy = pl.id;
  v.spot = -1;
  seatPed(w, p, v, 0);
  v.ctl.throttle = 0; v.ctl.steer = 0;
}

function bust(w: World, pl: Player, p: Ped): void {
  pl.bustT = 0;
  pl.mode = Mode.Busted;
  pl.respawnT = 4;
  const fine = Math.floor(pl.cash * RULES.bustedFine);
  pl.cash -= fine;
  if (p.vehicle) unseatPed(w, p, true);
  p.trigger = false;
  p.weapons = p.weapons.filter((h) => WEAPONS[h.w].clip === 0);
  p.wi = 0;
  w.notify('kill', `${pl.name} got busted`);
  w.notify('warn', `Busted. Fine $${fine}, weapons confiscated.`, pl);
}

/** Respawn at a hospital / owned home (death) or a precinct (busted). */
function respawn(w: World, pl: Player, old: Ped): void {
  const busted = pl.mode === Mode.Busted;
  const pos = old.vehicle ? w.pedPos(old) : old.body;
  const candidates = w.city.services.filter((s) => s.verb === (busted ? 'police' : 'hospital')).map((s) => ({ x: s.x, y: s.y }));
  if (!busted) for (const id of pl.owned) { const pr = w.city.properties[id]; if (pr.verb === 'home') candidates.push({ x: pr.x, y: pr.y }); }
  // Nowhere to go (a universe without the place): where they fell.
  let at = candidates[0] ?? { x: pos.x, y: pos.y }, bd = Infinity;
  for (const c of candidates) { const d = dist(pos.x, pos.y, c.x, c.y); if (d < bd) { bd = d; at = c; } }
  if (!busted) pl.cash = Math.max(0, pl.cash - RULES.hospitalFee);
  const weapons = old.weapons;
  if (old.vehicle) unseatPed(w, old, false);
  w.peds.delete(old.id);
  const p = makeAvatar(w, pl, at.x, at.y);
  p.weapons = weapons.length ? weapons : p.weapons;
  if (!p.weapons.some((h) => h.w === UNARMED)) p.weapons.unshift({ w: UNARMED, ammo: 0, clip: 0 });
  p.wi = p.weapons.length - 1;
  pl.mode = Mode.Foot;
  clearHeat(pl);
}

export function makeAvatar(w: World, pl: Player, x: number, y: number): Ped {
  const p = spawnPed(w, PLAYER_ARCHETYPE, x + w.rng.range(-1.5, 1.5), y + w.rng.range(-1.5, 1.5), 0, false);
  p.player = pl;
  p.persistent = true;
  p.cash = 0;
  w.statics.resolveCircle(p.body, 0.4);
  pl.pid = p.id;
  return p;
}

export function equipStart(p: Ped): void {
  for (const s of RULES.startWeapons) giveWeapon(p, weaponIndex(s.weapon), s.ammo);
  p.wi = p.weapons.length - 1;
}
