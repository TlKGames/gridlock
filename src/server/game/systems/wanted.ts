// Crime, heat and wanted levels.
import { dist2 } from '../../../shared/math';
import { flies } from '../../../shared/sim/kinds';
import { CRIMES, type CrimeKind, type CrimeSpec, lawfulFaction, RULES, WANTED, witnessFaction } from '../../../shared/packs';
import { Mode } from '../../../shared/protocol';
import type { Ped, Player } from '../entities';
import type { World } from '../world';

const MAX_HEAT = WANTED[WANTED.length - 1].heat * 1.4;

export const isLawful = (p: Ped): boolean => lawfulFaction(p.faction);

/** Is any lawful unit able to see (x,y)? Helicopters see over buildings. */
export function lawCanSee(w: World, x: number, y: number, range = RULES.heatSightRange): boolean {
  let seen = false;
  w.pedsNear(x, y, range, (p) => {
    if (seen || p.dead || !isLawful(p)) return;
    if (!w.statics.raycast(p.body.x, p.body.y, x, y, 1.4)) seen = true;
  });
  if (seen) return true;
  for (const v of w.vehicles.values()) {
    if (!flies(v.spec) || v.body.alt < 8 || v.wrecked) continue;
    const d = v.seats[0] ? w.peds.get(v.seats[0]) : undefined;
    if (d && isLawful(d) && dist2(v.body.x, v.body.y, x, y) < 140 * 140) return true;
  }
  // Lawful drivers see from their cars.
  w.vehiclesNear(x, y, range, (v) => {
    if (seen) return;
    const d = v.seats[0] ? w.peds.get(v.seats[0]) : undefined;
    if (d && isLawful(d) && !w.statics.raycast(v.body.x, v.body.y, x, y, 1.4)) seen = true;
  });
  return seen;
}

function civilianWitness(w: World, x: number, y: number, offender: Ped): boolean {
  let seen = false;
  w.pedsNear(x, y, RULES.witnessRange, (p) => {
    if (seen || p.dead || p.player || p === offender || !witnessFaction(p.faction)) return;
    if (!w.statics.raycast(p.body.x, p.body.y, x, y, 1.4)) seen = true;
  });
  return seen;
}

/** Reports a crime by a player-controlled ped: it goes on their felony record, and adds heat
 *  only if someone saw it. */
export function crime(w: World, offender: Ped, kind: CrimeKind, x: number, y: number): void {
  const pl = offender.player;
  if (!pl) return;
  const spec: CrimeSpec = CRIMES[kind];
  // On the record even when it lands after you died (a rocket in flight is still yours).
  if (spec.felony && w.time >= (pl.felonyCd[kind] ?? 0)) {
    pl.felonies[kind] = (pl.felonies[kind] ?? 0) + 1;
    pl.felonyCd[kind] = w.time + (spec.cooldown ?? 0);
    w.onFelony(pl);
  }
  // Heat doesn't build while dead or in custody.
  if (pl.mode === Mode.Dead || pl.mode === Mode.Busted) return;
  const heat = spec.heat;
  if (kind === 'gunfire') {
    if (w.time - pl.gunCrimeT < 0.6) return;
    pl.gunCrimeT = w.time;
  }
  let add = 0;
  if (lawCanSee(w, x, y)) { add = heat; pl.seenT = 0; }
  else if (civilianWitness(w, x, y, offender)) add = heat * 0.5;
  if (add > 0) addHeat(pl, add);
}

export function addHeat(pl: Player, add: number): void {
  pl.heat = Math.min(MAX_HEAT, pl.heat + add);
  refreshLevel(pl);
}

export function clearHeat(pl: Player): void {
  pl.heat = 0;
  refreshLevel(pl);
}

function refreshLevel(pl: Player): void {
  let level = 0;
  for (let i = 0; i < WANTED.length; i++) if (pl.heat >= WANTED[i].heat) level = i + 1;
  pl.wanted = level;
  pl.lethal = level > 0 && WANTED[level - 1].lethal;
}

export function updateWanted(w: World, dt: number): void {
  for (const pl of w.players.values()) {
    if (pl.heat <= 0) continue;
    const p = w.peds.get(pl.pid);
    if (!p || p.dead) continue;
    pl.seenCheckT -= dt;
    if (pl.seenCheckT <= 0) {
      pl.seenCheckT = 0.5;
      const pos = w.pedPos(p);
      if (lawCanSee(w, pos.x, pos.y)) pl.seenT = 0;
      else pl.seenT += 0.5;
    }
    if (pl.seenT > 5) {
      pl.heat = Math.max(0, pl.heat - RULES.heatDecayPerSec * dt * (1 + pl.wanted * 0.5));
      refreshLevel(pl);
    }
  }
}
