// Hold-ups. Inside a walk-in place whose pack spec has `robbery`, point a gun at the clerk and keep
// it on them: after a moment their hands go up and the till comes out, a little at a time, for as
// long as you keep them covered (RULES.robSeconds empties a full one). A few seconds in, the silent
// alarm puts you on RULES.robWanted stars. Look away too long, shoot them, or leave, and it's over.
// Some clerks go for a gun instead (`fightBack`). Tills refill over RULES.tillRefill; a business
// another player owns is robbed from its safe, and the owner hears about it.
import { angleDiff, dist } from '../../../shared/math';
import { PROPERTIES, RULES, SERVICES, WANTED, WEAPONS, weaponIndex } from '../../../shared/packs';
import type { RobberySpec } from '../../../shared/packs/types';
import { TICK_HZ } from '../../../shared/protocol';
import type { Interior } from '../../../shared/world/interiors';
import { roomAt } from '../ai/doors';
import { setTask } from '../ai/tasks';
import type { Ped, Player } from '../entities';
import { giveWeapon } from '../factory';
import { textTo } from '../missions/cell';
import type { World } from '../world';
import type { Business } from './business';
import { addHeat, crime } from './wanted';

const DT = 1 / TICK_HZ;
const $ = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

interface HoldUp { player: number; robber: number; clerk: number; started: number; lastCover: number; owed: number; taken: number; alarmed: boolean }

export class Robberies {
  /** Interior index -> dollars in its till (missing = full). */
  private tills = new Map<number, number>();
  /** Interior index -> the hold-up going on there. */
  readonly holdUps = new Map<number, HoldUp>();
  /** Player id -> how long they've been covering a clerk (and which place). */
  private covering = new Map<number, { k: number; t: number }>();

  constructor(private w: World, private owners: Map<number, string>, private business: Business) {}

  private spec(i: Interior): RobberySpec | undefined {
    return i.property ? PROPERTIES[i.place.spec].robbery : SERVICES[i.place.spec].robbery;
  }

  /** The clerk working this counter, if they're there (and alive). */
  private clerkOf(i: Interior): Ped | undefined {
    let found: Ped | undefined;
    this.w.pedsNear(i.clerk.x, i.clerk.y, 3, (p) => {
      if (!found && !p.dead && !p.player && p.spec.id === i.clerkArch) found = p;
    });
    return found;
  }

  /** What's left to take: the till, or the safe of a business someone else owns. */
  private available(k: number, i: Interior, robber: Player): { amount: number; owner: string | null } {
    const owner = i.property ? this.owners.get(i.place.id) ?? null : null;
    if (owner) return { amount: owner === robber.ownerKey ? 0 : this.business.safes.get(i.place.id) ?? 0, owner };
    return { amount: this.tills.get(k) ?? this.spec(i)!.till, owner: null };
  }

  private take(k: number, i: Interior, owner: string | null, amount: number): void {
    if (owner) this.business.safes.set(i.place.id, Math.max(0, (this.business.safes.get(i.place.id) ?? 0) - amount));
    else this.tills.set(k, Math.max(0, (this.tills.get(k) ?? this.spec(i)!.till) - amount));
  }

  /** Is this player aiming a gun (with ammo) at the ped on purpose (Aim held: just walking up to the
   *  counter facing them, or shopping there, doesn't count), close enough, and in view? */
  private covers(p: Ped, c: Ped, cone: number, range: number): boolean {
    if (p.dead || p.vehicle || (p.player && !p.aimHeld)) return false;
    const h = p.weapons[p.wi];
    const s = h ? WEAPONS[h.w] : undefined;
    if (!s || s.kind === 'melee' || s.kind === 'thrown' || (s.clip > 0 && h.clip + h.ammo <= 0)) return false;
    const d = dist(p.body.x, p.body.y, c.body.x, c.body.y);
    if (d > range) return false;
    const want = Math.atan2(c.body.y - p.body.y, c.body.x - p.body.x);
    if (Math.abs(angleDiff(p.aim, want)) > cone) return false;
    return !this.w.statics.raycast(p.body.x, p.body.y, c.body.x, c.body.y, 1.4);
  }

  update(): void {
    const w = this.w;
    // Tills fill back up.
    for (const [k, cash] of this.tills) {
      const full = this.spec(w.city.interiors[k])!.till;
      const next = cash + (full * DT) / RULES.tillRefill;
      if (next >= full) this.tills.delete(k); else this.tills.set(k, next);
    }
    this.startHoldUps();
    for (const [k, h] of this.holdUps) this.continueHoldUp(k, h);
  }

  private startHoldUps(): void {
    const w = this.w;
    for (const pl of w.players.values()) {
      const p = w.peds.get(pl.pid);
      const i = p && !p.vehicle && !p.dead ? roomAt(w, p.body.x, p.body.y) : undefined;
      const k = i ? w.city.interiors.indexOf(i) : -1;
      const c = i && this.spec(i) && !this.holdUps.has(k) ? this.clerkOf(i) : undefined;
      if (!p || !i || !c || c.ai?.task !== 'stand' || !this.covers(p, c, 0.3, RULES.robRange)) { this.covering.delete(pl.id); continue; }
      const cov = this.covering.get(pl.id);
      const t = (cov && cov.k === k ? cov.t : 0) + DT;
      this.covering.set(pl.id, { k, t });
      if (t < RULES.robStart) continue;
      this.covering.delete(pl.id);
      const { amount, owner } = this.available(k, i, pl);
      if (owner && owner === pl.ownerKey) continue; // your own staff
      // Some clerks keep a gun under the counter.
      if (w.rng.next() < this.spec(i)!.fightBack) {
        const gun = RULES.counterGun;
        if (gun && !c.weapons.some((wh) => WEAPONS[wh.w].kind !== 'melee')) c.wi = giveWeapon(c, weaponIndex(gun.weapon), gun.ammo);
        setTask(c, 'attack', p.id);
        this.alarm(p, i);
        w.notify('warn', 'The clerk goes for a gun!', pl);
        continue;
      }
      setTask(c, 'surrender', p.id);
      this.holdUps.set(k, { player: pl.id, robber: p.id, clerk: c.id, started: w.time, lastCover: w.time, owed: 0, taken: 0, alarmed: false });
      const full = owner ? 1 : this.spec(i)!.till;
      w.notify('info', amount >= full * 0.1 ? `Hands up! Keep them covered while they empty the ${owner ? 'safe' : 'till'}.` : `Hands up! But the ${owner ? 'safe' : 'till'}'s about empty.`, pl);
    }
  }

  private continueHoldUp(k: number, h: HoldUp): void {
    const w = this.w, i = w.city.interiors[k];
    const pl = w.players.get(h.player);
    const p = w.peds.get(h.robber), c = w.peds.get(h.clerk);
    const clerkOk = c && !c.dead && c.ai?.task === 'surrender';
    if (!pl || !p || !clerkOk) { this.end(k, h, clerkOk ? 'gone' : 'clerk'); return; }
    if (roomAt(w, p.body.x, p.body.y) === i && this.covers(p, c, 0.6, RULES.robRange + 2)) h.lastCover = w.time;
    if (w.time - h.lastCover > RULES.robGrace) { this.end(k, h, 'lost'); return; }
    if (!h.alarmed && w.time - h.started >= RULES.robAlarm) { h.alarmed = true; this.alarm(p, i); }
    // Once the alarm's in, they know exactly where you are until you leave.
    if (h.alarmed) pl.seenT = 0;
    // The cash comes out at a steady rate; paid over in $10s.
    const { amount, owner } = this.available(k, i, pl);
    h.owed += (this.spec(i)!.till * DT) / RULES.robSeconds;
    const pay = Math.floor(Math.min(amount, Math.floor(h.owed / 10) * 10));
    if (pay > 0) {
      h.owed -= pay;
      h.taken += pay;
      this.take(k, i, owner, pay);
      w.earn(pl, pay);
    }
    if (amount - pay < 1) this.end(k, h, 'empty');
  }

  /** The silent alarm: on the record, and the police are coming. */
  private alarm(p: Ped, i: Interior): void {
    const pl = p.player;
    crime(this.w, p, 'robbery', i.clerk.x, i.clerk.y);
    if (!pl) return;
    const need = WANTED[RULES.robWanted - 1].heat;
    if (pl.heat < need) addHeat(pl, need - pl.heat);
    this.w.notify('warn', 'Silent alarm! The police are on their way.', pl);
  }

  private end(k: number, h: HoldUp, why: 'empty' | 'lost' | 'clerk' | 'gone'): void {
    const w = this.w, i = w.city.interiors[k];
    this.holdUps.delete(k);
    const c = w.peds.get(h.clerk);
    if (c && !c.dead && c.ai?.task === 'surrender') setTask(c, 'cower', 0, c.body.x, c.body.y);
    const pl = w.players.get(h.player);
    if (pl && h.taken > 0) {
      const note = why === 'empty' ? "That's all of it" : why === 'lost' ? 'You let them go' : "It's over";
      w.notify('money', `${note}: +${$(h.taken)}`, pl);
    } else if (pl && why === 'lost') w.notify('info', 'You let them go.', pl);
    // Someone else's business: its owner hears about it.
    const owner = i.property ? this.owners.get(i.place.id) : undefined;
    if (owner && h.taken > 0) {
      for (const o of w.players.values()) {
        if (o.ownerKey === owner) textTo(o, i.place.name, `We got held up. They took ${$(h.taken)} out of the safe.`);
      }
    }
  }
}
