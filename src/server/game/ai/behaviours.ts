// Personalities: how each NPC behaviour picks tasks and reacts. Keyed by the archetype's
// `behaviour` field from the ped pack.
import { dist } from '../../../shared/math';
import { type Behaviour, RESPECT, WEAPONS, hostile } from '../../../shared/packs';
import { Mode } from '../../../shared/protocol';
import type { Ped } from '../entities';
import { unseatPed } from '../factory';
import { crime, isLawful } from '../systems/wanted';
import type { World } from '../world';
import { onBase, soldierHostile } from './soldiers';
import { setTask } from './tasks';

export interface BehaviourDef {
  idle(w: World, p: Ped): void;
  perceive(w: World, p: Ped): void;
  attacked(w: World, p: Ped, attacker: Ped): void;
  noise(w: World, p: Ped, x: number, y: number, source: Ped | null, lethal: boolean): void;
}

const armed = (p: Ped) => p.weapons.some((h) => WEAPONS[h.w].kind !== 'melee' && h.ammo + h.clip > 0);

function fightOrFlight(w: World, p: Ped, attacker: Ped): void {
  if (p.ai!.task === 'attack' && p.ai!.target === attacker.id) return;
  const brave = w.rng.next() < p.spec.courage * (armed(p) ? 1 : 0.5);
  if (p.vehicle) {
    if (brave && p.seat === 0) { unseatPed(w, p, true); setTask(p, 'attack', attacker.id); }
    else if (p.seat === 0) { p.ai!.panicT = 8; setTask(p, 'drive'); }
    return;
  }
  if (brave) setTask(p, 'attack', attacker.id);
  else setTask(p, 'flee', attacker.id, attacker.body.x, attacker.body.y);
}

function alertAllies(w: World, p: Ped, attacker: Ped, radius: number): void {
  w.pedsNear(p.body.x, p.body.y, radius, (o) => {
    if (o === p || o.dead || !o.ai || o.faction !== p.faction || o === attacker) return;
    // Clerks and guards share the civilian faction. Only other guard-role NPCs answer their call.
    if (p.spec.behaviour === 'guard' && o.spec.behaviour !== 'guard') return;
    // An attack on one of them is an attack on all of them: they hold the grudge too.
    o.ai.enemy = attacker.id;
    o.ai.enemyT = w.time;
    if (o.ai.task !== 'attack') setTask(o, 'attack', attacker.id);
  });
}

function returnOrWander(w: World, p: Ped): void {
  const crew = p.ai!.crew ? w.vehicles.get(p.ai!.crew) : undefined;
  if (crew && !crew.wrecked && !p.vehicle) setTask(p, 'return', crew.id);
  else setTask(p, p.vehicle ? (p.seat === 0 ? 'drive' : 'none') : p.ai!.post ? 'stand' : 'wander');
}

function fleeNoise(w: World, p: Ped, x: number, y: number, lethal: boolean): void {
  const ai = p.ai!;
  if (ai.task === 'flee' || ai.task === 'attack' || ai.task === 'cower' || ai.task === 'surrender') return;
  // Drivers only spook at danger close by: a few seconds of fleeing, then back to normal.
  if (p.vehicle) {
    const gunfire = !lethal && p.spec.behaviour === 'civilian';
    const distance = Math.hypot(p.body.x - x, p.body.y - y);
    if (p.seat === 0 && ((lethal && distance < 25) || (gunfire && distance < 15))) {
      ai.panicT = Math.max(ai.panicT, lethal ? 6 : 3);
    }
    return;
  }
  if (w.rng.chance(lethal ? 0.85 : 0.6)) setTask(p, w.rng.chance(0.2) ? 'cower' : 'flee', 0, x, y);
}

/** Police and military: pursue/arrest wanted players, fight anyone shooting nearby. */
function lawPerceive(w: World, p: Ped, military: boolean): void {
  const ai = p.ai!;
  if (ai.task === 'attack' || ai.task === 'arrest' || ai.task === 'pursue' || ai.task === 'respond') return;
  const pos = w.pedPos(p);
  for (const pl of w.players.values()) {
    const t = w.peds.get(pl.pid);
    if (!t || t.dead || pl.mode >= Mode.Dead) continue;
    const tp = w.pedPos(t);
    const d = dist(pos.x, pos.y, tp.x, tp.y);
    // Soldiers: only on their base, or wanted badly enough for the army (soldiers.ts).
    if (military && pl.wanted === 0 && d < 30 && onBase(w, tp.x, tp.y) && !w.statics.raycast(pos.x, pos.y, tp.x, tp.y, 1.2)) {
      crime(w, t, 'trespass', tp.x, tp.y);
    }
    if (pl.wanted === 0 || d > 60) continue;
    if (military && !soldierHostile(w, p, t)) continue;
    if (w.statics.raycast(pos.x, pos.y, tp.x, tp.y, 1.4) && d > 12) continue;
    engage(w, p, t, pl.lethal || military);
    return;
  }
}

export function engage(w: World, p: Ped, t: Ped, lethal: boolean): void {
  if (p.vehicle) {
    if (p.seat === 0) setTask(p, 'pursue', t.id);
    return;
  }
  setTask(p, lethal ? 'attack' : 'arrest', t.id);
}

const civilian: BehaviourDef = {
  idle: (w, p) => setTask(p, p.vehicle ? 'drive' : 'wander'),
  perceive: () => {},
  attacked: fightOrFlight,
  noise: (w, p, x, y, _s, lethal) => fleeNoise(w, p, x, y, lethal),
};

const stander: BehaviourDef = {
  idle: (w, p) => setTask(p, p.vehicle ? 'drive' : p.ai!.post ? 'stand' : 'wander'),
  perceive: () => {},
  attacked: (w, p, a) => fightOrFlight(w, p, a),
  noise: (w, p, x, y, _s, lethal) => { if (p.spec.courage < 0.5) fleeNoise(w, p, x, y, lethal); },
};

const gang: BehaviourDef = {
  idle: stander.idle,
  perceive: (w, p) => {
    if (p.ai!.task === 'attack' || p.vehicle) return;
    let rival: Ped | null = null;
    w.pedsNear(p.body.x, p.body.y, 18, (o) => {
      if (!rival && !o.dead && o.faction !== p.faction && hostile(p.faction, o.faction)) rival = o;
    });
    if (rival && w.rng.chance(0.2) && !w.statics.raycast(p.body.x, p.body.y, (rival as Ped).body.x, (rival as Ped).body.y, 1.2)) {
      setTask(p, 'attack', (rival as Ped).id);
      return;
    }
    // Players this gang has no respect for get jumped on sight.
    for (const pl of w.players.values()) {
      if ((pl.respect[p.faction] ?? 0) > RESPECT.hostileBelow) continue;
      const t = w.peds.get(pl.pid);
      if (!t || t.dead) continue;
      const pos = w.pedPos(t);
      if (dist(p.body.x, p.body.y, pos.x, pos.y) > 16 || w.statics.raycast(p.body.x, p.body.y, pos.x, pos.y, 1.2)) continue;
      if (w.rng.chance(0.5)) setTask(p, 'attack', t.id);
      return;
    }
  },
  attacked: (w, p, a) => {
    if (p.vehicle && p.seat === 0) { unseatPed(w, p, true); }
    if (!p.vehicle) setTask(p, 'attack', a.id);
    alertAllies(w, p, a, 28);
  },
  noise: () => {},
};

const law = (military: boolean): BehaviourDef => ({
  idle: (w, p) => returnOrWander(w, p),
  perceive: (w, p) => lawPerceive(w, p, military),
  attacked: (w, p, a) => {
    if (isLawful(a)) return;
    if (a.player && a.player.wanted > 0) { engage(w, p, a, true); return; }
    // NPCs get fought; so do players who attack a soldier, wanted or not.
    if (!a.player || military) { if (p.vehicle && p.seat === 0) unseatPed(w, p, true); if (!p.vehicle) setTask(p, 'attack', a.id); }
    alertAllies(w, p, a, 30);
  },
  noise: (w, p, _x, _y, s) => {
    if (!s || s.player || isLawful(s) || p.ai!.task === 'attack') return;
    if (dist(p.body.x, p.body.y, s.body.x, s.body.y) < 40) {
      if (p.vehicle && p.seat === 0) setTask(p, 'pursue', s.id);
      else if (!p.vehicle) setTask(p, 'attack', s.id);
    }
  },
});

const service: BehaviourDef = {
  idle: (w, p) => returnOrWander(w, p),
  perceive: () => {},
  attacked: (w, p, a) => { if (!p.vehicle) setTask(p, 'flee', a.id, a.body.x, a.body.y); },
  noise: (w, p, x, y, _s, lethal) => { if (p.ai!.task !== 'revive' && p.ai!.task !== 'extinguish') fleeNoise(w, p, x, y, lethal); },
};

export const BEHAVIOURS: Record<Behaviour, BehaviourDef> = {
  civilian,
  streetwalker: { ...stander, noise: civilian.noise },
  dealer: stander,
  guard: { ...stander, attacked: (w, p, a) => { setTask(p, 'attack', a.id); alertAllies(w, p, a, 25); } },
  gang,
  police: law(false),
  military: law(true),
  medic: service,
  firefighter: service,
  player: civilian,
};
