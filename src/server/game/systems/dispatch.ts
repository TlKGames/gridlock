// Response squads: police/military for wanted players, ambulances for bodies, fire trucks for fires.
import { dist2 } from '../../../shared/math';
import { SERVICE_CALLS, type Squad as SquadSpec, VEHICLES, WANTED, pedIndex, vehicleIndex } from '../../../shared/packs';
import { flies } from '../../../shared/sim/kinds';
import { Mode } from '../../../shared/protocol';
import { BEHAVIOURS } from '../ai/behaviours';
import { MEDICAL_RADIUS, MEDICAL_TIMEOUT, needsMedic } from '../ai/medicalScene';
import { streetGoal } from '../ai/doors';
import { setTask } from '../ai/tasks';
import type { Squad } from '../entities';
import { seatPed, spawnPed, spawnVehicle } from '../factory';
import type { World } from '../world';
import { laneSpawn } from './spawnPoints';

// Bound a stalled response so a still-active incident can request a fresh crew.
const SERVICE_TIMEOUT = 180;

export class Dispatch {
  private timer = 0;
  private lastSpawn = new Map<number, number>();
  /** Player id -> the wanted level they last rose to, and when. */
  private reached = new Map<number, { level: number; t: number }>();

  constructor(private w: World) {}

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    this.cleanup();
    for (const pl of this.w.players.values()) {
      // When each player reached their current level: its units take a while to get going.
      const at = this.reached.get(pl.id);
      if (pl.wanted <= 0) this.reached.delete(pl.id);
      else if (!at || pl.wanted > at.level) this.reached.set(pl.id, { level: pl.wanted, t: this.w.time });
      else if (pl.wanted < at.level) at.level = pl.wanted; // cooling off: no fresh delay
      if (pl.wanted > 0 && pl.mode < Mode.Dead) this.wanted(pl.id, pl.wanted);
    }
    this.medics();
    this.fireCrews();
  }

  private spawnSquad(spec: SquadSpec, key: string, player: number, near: { x: number; y: number }, task: (driver: number) => void): Squad | null {
    const w = this.w;
    const type = vehicleIndex(spec.vehicle);
    const vs = VEHICLES[type];
    let x: number, y: number, angle: number, alt = 0;
    if (flies(vs)) {
      const a = w.rng.next() * Math.PI * 2;
      x = near.x + Math.cos(a) * 170; y = near.y + Math.sin(a) * 170;
      angle = a + Math.PI; alt = 30;
    } else {
      const s = laneSpawn(w, near.x, near.y, 120, 175, near);
      if (!s) return null;
      ({ x, y, angle } = s);
    }
    const v = spawnVehicle(w, type, x, y, angle);
    v.body.alt = alt;
    v.persistent = true;
    v.siren = !!vs.siren;
    const squad: Squad = { id: w.id(), player, key, vehicle: v.id, members: [] };
    spec.crew.forEach((arch, i) => {
      if (i >= v.seats.length) return;
      const p = spawnPed(w, pedIndex(arch), x, y, angle);
      p.persistent = true;
      seatPed(w, p, v, i);
      p.ai!.squad = squad.id;
      p.ai!.crew = v.id;
      setTask(p, 'none');
      squad.members.push(p.id);
    });
    if (squad.members[0]) task(squad.members[0]);
    w.squads.set(squad.id, squad);
    return squad;
  }

  private wanted(playerId: number, level: number): void {
    const w = this.w;
    const pl = w.players.get(playerId)!;
    const target = w.peds.get(pl.pid);
    if (!target) return;
    const spec = WANTED[level - 1];
    if (w.time - (this.reached.get(playerId)?.t ?? w.time) < spec.respond) return;
    if (w.time - (this.lastSpawn.get(playerId) ?? -99) < spec.every) return;
    const pos = w.pedPos(target);
    let total = 0;
    for (const s of w.squads.values()) if (s.player === playerId) total++;
    if (total >= spec.squads.reduce((a, b) => a + b.max, 0)) return;
    for (const [k, slot] of spec.squads.entries()) {
      const key = `w${level}:${k}`;
      let active = 0;
      for (const s of w.squads.values()) if (s.player === playerId && s.key === key) active++;
      if (active >= slot.max) continue;
      const sq = this.spawnSquad(slot.squad, key, playerId, pos, (d) => setTask(w.peds.get(d)!, 'pursue', target.id));
      if (sq) { this.lastSpawn.set(playerId, w.time); return; }
    }
  }

  private medics(): void {
    const w = this.w, call = SERVICE_CALLS.medic;
    const active = [...w.squads.values()].filter(s => s.key === 'medic' && s.incident);
    for (const p of w.peds.values()) {
      if (active.length >= call.maxActive) return;
      if (!needsMedic(p) || p.deadT < 3) continue;
      const { x, y } = p.body;
      if (active.some(s => dist2(x, y, s.incident!.x, s.incident!.y) <= MEDICAL_RADIUS ** 2)) continue;
      if (w.nearestPlayerDist2(x, y) > 150 * 150) continue;
      const goal = streetGoal(w, x, y);
      const squad = this.spawnSquad(call.squad, 'medic', 0, goal, d => setTask(w.peds.get(d)!, 'respond', 0, x, y));
      if (squad) {
        squad.incident = { target: 0, x, y, expires: w.time + MEDICAL_TIMEOUT };
        active.push(squad);
      }
    }
  }

  private fireCrews(): void {
    const w = this.w, call = SERVICE_CALLS.fire;
    const active = [...w.squads.values()].filter(s => s.key === 'fire' && s.incident);
    const send = (target: number, x: number, y: number) => {
      if (w.nearestPlayerDist2(x, y) > 150 * 150) return;
      // Firefighters search within 25 metres of their assigned location.
      if (active.some(s => s.incident!.target === target || dist2(x, y, s.incident!.x, s.incident!.y) < 25 * 25)) return;
      const squad = this.spawnSquad(call.squad, 'fire', 0, { x, y }, (d) => setTask(w.peds.get(d)!, 'respond', 0, x, y));
      if (squad) {
        squad.incident = { target, x, y, expires: w.time + SERVICE_TIMEOUT };
        active.push(squad);
      }
    };
    for (const f of w.fires.values()) {
      if (active.length >= call.maxActive) return;
      if (f.life >= 4) send(f.id, f.x, f.y);
    }
    for (const v of w.vehicles.values()) {
      if (active.length >= call.maxActive) return;
      if (v.burning >= 0) send(v.id, v.body.x, v.body.y);
    }
  }

  /** Drops dead squads and stands down units whose target is no longer wanted. */
  private cleanup(): void {
    const w = this.w;
    for (const s of w.squads.values()) {
      const alive = s.members.filter((id) => { const p = w.peds.get(id); return p && !p.dead; });
      const v = w.vehicles.get(s.vehicle);
      const pl = s.player ? w.players.get(s.player) : undefined;
      const standDown = s.player !== 0 && (!pl || pl.wanted === 0 || pl.mode >= Mode.Dead);
      const gone = !alive.length;
      const timedOut = s.incident && w.time >= s.incident.expires;
      const serviceDone = s.incident && (timedOut || !alive.some(id => {
        const task = w.peds.get(id)?.ai?.task;
        return task === 'respond' || task === 'revive' || task === 'extinguish';
      }));
      if (!gone && !standDown && !serviceDone) continue;
      for (const id of s.members) {
        const p = w.peds.get(id);
        if (!p) continue;
        p.persistent = false;
        if (p.ai) {
          p.ai.squad = 0;
          if (!p.dead && (standDown || timedOut)) BEHAVIOURS[p.spec.behaviour].idle(w, p);
        }
      }
      if (v) { v.persistent = false; v.siren = false; }
      w.squads.delete(s.id);
    }
  }
}
