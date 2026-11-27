// Businesses you own. Each game hour a business's income goes into its safe (up to RULES.safeHours of
// it): walk in and collect it as cash, or at midnight an armoured car takes what's left to your bank,
// less a fee. Once in a while a gang that doesn't respect you leans on a business on its turf: a crew
// at the door; kill them or pay them off, or they empty the safe. Perks by type (packs `perk`): the
// car wash takes your heat off, your warehouse fences stolen cars, your club puts you in touch with
// any gang that will work with you.
import { dist } from '../../../shared/math';
import { GANGS, PROPERTIES, RESPECT, RULES } from '../../../shared/packs';
import type { Place } from '../../../shared/world/cityTypes';
import { turfGang } from '../../../shared/world/gangTurf';
import { setTask } from '../ai/tasks';
import type { Player, Vehicle } from '../entities';
import { removeVehicle, spawnPed, unseatPed } from '../factory';
import { textTo } from '../missions/cell';
import type { Missions } from '../missions/engine';
import { archetypeOf, factionName } from '../missions/helpers';
import type { World } from '../world';
import { clearHeat } from './wanted';

interface Trouble { gang: string; owner: string; crew: number[]; ends: number }

const $ = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export class Business {
  /** Property id -> dollars in its safe. */
  readonly safes = new Map<number, number>();
  /** Property id -> a gang leaning on it. */
  readonly trouble = new Map<number, Trouble>();
  private lastHour = -1;
  /** Something about a player's businesses changed: resend their profile. */
  onChange: (pl: Player) => void = () => {};

  constructor(private w: World, private owners: Map<number, string>, private missions: Missions) {}

  private ownerOf(propId: number): Player | undefined {
    const name = this.owners.get(propId);
    for (const pl of this.w.players.values()) if (pl.ownerKey === name) return pl;
    return undefined;
  }

  private place(propId: number): Place { return this.w.city.properties[propId]; }
  private spec(propId: number) { return PROPERTIES[this.place(propId).spec]; }

  update(): void {
    const w = this.w;
    const hour = Math.floor(w.gameMinutes / 60);
    if (this.lastHour >= 0 && hour !== this.lastHour) this.hourly(hour);
    this.lastHour = hour;
    for (const [propId, t] of this.trouble) {
      const owner = this.ownerOf(propId);
      const left = t.crew.filter((id) => { const p = w.peds.get(id); return p && !p.dead; });
      const name = this.place(propId).name;
      if (!left.length) {
        this.end(propId);
        if (owner) textTo(owner, factionName(t.gang), `Fine. ${name} is yours. For now.`);
      } else if (w.time > t.ends) {
        const took = this.safes.get(propId) ?? 0;
        this.safes.set(propId, 0);
        this.end(propId);
        if (owner) textTo(owner, name, took ? `The ${factionName(t.gang)} cleaned out the safe: ${$(took)} gone.` : `The ${factionName(t.gang)} turned the place over. The safe was empty.`);
      }
    }
  }

  private end(propId: number): void {
    const t = this.trouble.get(propId);
    if (!t) return;
    for (const id of t.crew) { const p = this.w.peds.get(id); if (p) p.persistent = false; }
    this.trouble.delete(propId);
    const owner = this.ownerOf(propId);
    if (owner) this.onChange(owner);
  }

  private hourly(hour: number): void {
    const w = this.w;
    const touched = new Set<Player>();
    for (const [propId] of this.owners) {
      const spec = this.spec(propId);
      const pl = this.ownerOf(propId);
      if (!pl || spec.income <= 0) continue; // income comes in while the owner is in town
      const cap = spec.income * RULES.safeHours;
      const before = this.safes.get(propId) ?? 0;
      const now = Math.min(cap, before + spec.income);
      this.safes.set(propId, now);
      touched.add(pl);
      if (before < cap && now >= cap) textTo(pl, this.place(propId).name, `The safe's full (${$(now)}). Come collect, or it waits for the night pickup.`);
      // Now and then the local gang leans on a place, if it doesn't think much of you.
      const gang = turfGang(w.city.blocks[w.city.lots[this.place(propId).lot].block].district);
      if (gang && GANGS.includes(gang) && !this.trouble.has(propId) && (pl.respect[gang] ?? 0) < RULES.troubleBelow
        && w.rng.next() < RULES.troubleChance / 24) this.startTrouble(propId, gang, pl);
    }
    if (hour === 0) {
      // The armoured car's night round: safes to the bank, less its fee.
      const byOwner = new Map<Player, number>();
      for (const [propId, amount] of this.safes) {
        const pl = this.ownerOf(propId);
        if (!pl || amount <= 0) continue;
        byOwner.set(pl, (byOwner.get(pl) ?? 0) + amount);
        this.safes.set(propId, 0);
      }
      for (const [pl, total] of byOwner) {
        const fee = Math.round(total * RULES.safeSweepFee);
        w.earnToBank(pl, total - fee);
        textTo(pl, 'Harbor Trust', `Night pickup: ${$(total - fee)} from your businesses into your account (${$(fee)} armoured-car fee). Balance ${$(pl.bank)}.`);
        touched.add(pl);
      }
    }
    for (const pl of touched) this.onChange(pl);
  }

  /** A gang crew turns up at a business's door. */
  startTrouble(propId: number, gang: string, owner: Player): void {
    const w = this.w, p = this.place(propId);
    const crew: number[] = [];
    for (let k = 0; k < RULES.troubleCrew; k++) {
      const a = (k / RULES.troubleCrew) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 2.4, y = p.y + Math.sin(a) * 2.4;
      const ped = spawnPed(w, archetypeOf(gang), x, y, a + Math.PI);
      ped.persistent = true;
      ped.ai!.post = { x, y, angle: a + Math.PI };
      setTask(ped, 'stand');
      crew.push(ped.id);
    }
    this.trouble.set(propId, { gang, owner: owner.ownerKey, crew, ends: w.time + RULES.troubleSeconds });
    textTo(owner, p.name, `Some ${factionName(gang)} are leaning on us. Deal with them or pay them off, or they'll clean out the safe.`);
    this.onChange(owner);
  }

  /** Owner actions at the door: collect the safe, pay off a crew, or (club) meet a gang. */
  act(pl: Player, kind: 'collect' | 'payoff' | 'meet', id: string, propId: number): string | null {
    const w = this.w;
    const p = w.peds.get(pl.pid), place = this.place(propId);
    if (!p || p.dead || !place) return 'Not now.';
    if (this.owners.get(propId) !== pl.ownerKey) return "It isn't yours.";
    const pos = w.pedPos(p);
    const counter = place.counter ? dist(pos.x, pos.y, place.counter.x, place.counter.y) : Infinity;
    if (Math.min(dist(pos.x, pos.y, place.x, place.y), counter) > 8) return 'Too far away.';
    if (kind === 'collect') {
      const amount = this.safes.get(propId) ?? 0;
      if (amount <= 0) return 'The safe is empty.';
      if (this.trouble.has(propId)) return 'Not with that crew at the door.';
      this.safes.set(propId, 0);
      w.earn(pl, amount);
      w.notify('money', `+${$(amount)} from the safe`, pl);
    } else if (kind === 'payoff') {
      const t = this.trouble.get(propId);
      if (!t) return 'Nobody to pay.';
      const price = this.spec(propId).income * RULES.payoffHours;
      if (pl.cash + pl.bank < price) return 'Not enough money.';
      const fromCash = Math.min(pl.cash, price);
      pl.cash -= fromCash; pl.bank -= price - fromCash;
      pl.respect[t.gang] = Math.min(RESPECT.max, (pl.respect[t.gang] ?? 0) + RULES.payoffRespect);
      for (const id of t.crew) { const c = w.peds.get(id); if (c && !c.dead) { c.persistent = false; setTask(c, 'wander'); } }
      this.trouble.delete(propId);
      textTo(pl, factionName(t.gang), `Pleasure doing business. ${place.name} won't have any more trouble from us. Today.`);
    } else {
      if (this.spec(propId).perk !== 'club') return 'Nobody to meet here.';
      if (!GANGS.includes(id) || (pl.respect[id] ?? 0) < RESPECT.noWorkBelow) return "They won't talk to you.";
      if (pl.mission) return 'Finish the job you have first.';
      this.missions.offer(pl, id, RESPECT.cellPay);
    }
    this.onChange(pl);
    return null;
  }

  /** A player's car pulled onto the pad of a business they own: the car wash and the warehouse. */
  onPad(pl: Player, v: Vehicle, propId: number): void {
    const w = this.w, spec = this.spec(propId);
    if (spec.perk === 'wash') {
      const hot = pl.wanted > 0 || pl.heat > 0;
      clearHeat(pl);
      w.notify('money', hot ? 'Washed. The heat is off.' : 'Washed and waxed.', pl);
    } else if (spec.perk === 'fence') {
      if (v.owner === pl.id) { w.notify('warn', "That's your own car.", pl); return; }
      if (v.spec.price <= 0) { w.notify('warn', 'Too hot to move.', pl); return; }
      const value = Math.round(v.spec.price * RULES.chopValue * RULES.fenceMul * Math.max(0.2, v.hp / v.spec.hp));
      const p = w.peds.get(pl.pid);
      if (p) unseatPed(w, p, true);
      removeVehicle(w, v);
      w.earn(pl, value);
      w.notify('money', `+${$(value)} for the ${v.spec.name}`, pl);
    }
  }

  /** What the owner's client shows: safes and trouble at their places. */
  profileOf(pl: Player): { safes: [number, number][]; trouble: [number, string, number][] } {
    const name = pl.ownerKey;
    const mine = [...this.owners].filter(([, o]) => o === name).map(([id]) => id);
    return {
      safes: mine.filter((id) => this.spec(id).income > 0).map((id) => [id, this.safes.get(id) ?? 0]),
      trouble: mine.filter((id) => this.trouble.has(id)).map((id) => { const t = this.trouble.get(id)!; return [id, t.gang, Math.round(t.ends * 1000)]; }),
    };
  }
}
