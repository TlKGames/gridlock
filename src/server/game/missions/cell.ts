// The cell phone. Payphones are how you get in with a gang; once a gang respects you enough
// (RESPECT.cellAt) it texts you its number. From then on its people call you with work every few
// minutes while you're free (answer, decline, or miss it), and you can ring them to ask. Work by
// phone pays a little better (RESPECT.cellPay). Texts also carry news, like business income.
// A new arrival's phone rings soon after they get to town: the pack's welcome caller, whose number
// you keep (PEOPLE_CONTACTS). Ring them and they pick up (or tell you where to go after too many
// blown jobs) and point you at a payphone that's ringing for you. The mentor also rings with a
// nudge when you've been idle and no crew has your number; miss it and they leave a voicemail.
// What callers say is voiced (missions/talk.ts, packs/calls.ts).
import { CALLERS, CALLS, type CallSituation, GANGS, MENTOR_CALLER, MENTOR_REMINDER_DISMISSED, PEOPLE_CONTACTS, RESPECT, WELCOME_CALLER, YOU } from '../../../shared/packs';
import { Mode, type S2C } from '../../../shared/protocol';
import type { Player } from '../entities';
import type { World } from '../world';
import type { Missions } from './engine';
import { factionName, placeName } from './helpers';
import { gangCaller, type Part, pickParts, talk } from './talk';

/** How long after arriving a newcomer gets the friendly first call (from whoever the pack marks
 *  as the welcome caller, if anyone). */
const WELCOME_AFTER = 15;

/** Sends a text message to a player's phone. */
export function textTo(pl: Player, from: string, body: string): void {
  pl.send({ t: 'text', from, body } satisfies S2C);
}

export function newCell(w: World, respect: Record<string, number>): Player['cell'] {
  return { next: w.time + callGap(w), ringing: '', ringEnds: 0, dialCd: {}, known: new Set(GANGS.filter((g) => (respect[g] ?? 0) >= RESPECT.cellAt)), introAt: w.time + WELCOME_AFTER, nudgeAt: w.time + RESPECT.mentorNudgeAfter, people: '' };
}

const has = (who: string, s: CallSituation) => !!CALLS[who]?.[s]?.length;

const callGap = (w: World) => RESPECT.cellCallEvery[0] + w.rng.next() * (RESPECT.cellCallEvery[1] - RESPECT.cellCallEvery[0]);
/** A caller's name as the phone shows it: a gang, or a person from packs/calls.ts. */
const nameOf = (id: string) => CALLERS.find((c) => c.id === id)?.name ?? factionName(id);

export class Cell {
  constructor(private w: World, private missions: Missions) {}

  /** Gangs whose number you have. */
  contacts(pl: Player): string[] {
    return GANGS.filter((g) => (pl.respect[g] ?? 0) >= RESPECT.cellAt);
  }

  /** People whose number you have: the contacts you've talked to. */
  people(pl: Player): string[] {
    return PEOPLE_CONTACTS.filter((id) => pl.met.has(id));
  }

  update(): void {
    const w = this.w;
    for (const pl of w.players.values()) {
      const c = pl.cell;
      const contacts = this.contacts(pl);
      // Newly trusted: they text their number. Fall out of favour and you lose it.
      for (const g of contacts) {
        if (c.known.has(g)) continue;
        c.known.add(g);
        textTo(pl, factionName(g), `It's the ${factionName(g)}. You've been useful. Keep this number, we'll call when there's work.`);
      }
      for (const g of [...c.known]) if (!contacts.includes(g)) c.known.delete(g);
      const people = this.people(pl);
      if (people.join() !== c.people) { c.people = people.join(); pl.send({ t: 'people', ids: people } satisfies S2C); }
      if (c.ringing) {
        if (w.time < c.ringEnds) continue;
        this.missed(pl, c.ringing);
        c.ringing = '';
        c.next = w.time + callGap(w);
        continue;
      }
      const free = !pl.mission && pl.mode !== Mode.Dead && pl.mode !== Mode.Busted;
      if (!free) { c.next = Math.max(c.next, w.time + 30); c.nudgeAt = Math.max(c.nudgeAt, w.time + RESPECT.mentorNudgeAfter); continue; }
      if (WELCOME_CALLER && !pl.met.has(WELCOME_CALLER) && w.time >= c.introAt) { this.ring(pl, WELCOME_CALLER); continue; }
      // No crew has your number yet: the mentor rings now and then to say there's work.
      const m = MENTOR_CALLER;
      if (m && !contacts.length && pl.met.has(m) && !pl.met.has(MENTOR_REMINDER_DISMISSED) && w.time >= c.nudgeAt && has(m, 'nudge') && !this.missions.fedUp(pl) && this.missions.ringingBooth(pl)) {
        c.nudgeAt = w.time + RESPECT.mentorNudgeAfter;
        this.ring(pl, m);
        continue;
      }
      if (w.time < c.next || !contacts.length) continue;
      this.ring(pl, contacts[Math.floor(w.rng.next() * contacts.length)]);
    }
  }

  /** A call nobody picked up: a person leaves a voicemail (their `voicemail` lines, or else a
   *  nudge); others leave the missed call. The welcome text introduces the contact. */
  private missed(pl: Player, who: string): void {
    pl.send({ t: 'call', gang: who, state: 'missed' } satisfies S2C);
    if (who === WELCOME_CALLER && !pl.met.has(who)) { this.welcomeText(pl, who); return; }
    const parts = PEOPLE_CONTACTS.includes(who) ? pickParts(this.w, pl, [[who, has(who, 'voicemail') ? 'voicemail' : 'nudge']]) : [];
    if (parts.length) pl.send({ t: 'voicemail', from: who, parts } satisfies S2C);
    else textTo(pl, nameOf(who), 'Missed call.');
  }

  private welcomeText(pl: Player, who: string): void {
    pl.met.add(who);
    const summary = CALLERS.find(c => c.id === who)?.welcomeText;
    textTo(pl, nameOf(who), summary ?? 'Welcome to town. Keep my number and call me for work.');
  }

  private ring(pl: Player, who: string): void {
    pl.cell.ringing = who;
    pl.cell.ringEnds = this.w.time + RESPECT.cellRing;
    pl.send({ t: 'call', gang: who, state: 'ring' } satisfies S2C);
  }

  /** The player answered (or declined) the call that's ringing. */
  answer(pl: Player, accept: boolean): string | null {
    const w = this.w, c = pl.cell, g = c.ringing;
    if (!g) return null;
    c.ringing = '';
    c.next = w.time + callGap(w);
    pl.send({ t: 'call', gang: g, state: 'end' } satisfies S2C);
    if (!accept && g === MENTOR_CALLER) pl.met.add(MENTOR_REMINDER_DISMISSED);
    if (g === WELCOME_CALLER && !pl.met.has(g)) {
      if (accept) talk(w, pl, 'cell', [[YOU, 'pickup'], [g, 'intro']]);
      else this.welcomeText(pl, g);
      return null;
    }
    if (PEOPLE_CONTACTS.includes(g)) {
      // You picked up, so no "call me back": he sends you to the payphone that's ringing for you.
      const booth = this.missions.ringingBooth(pl);
      if (accept) {
        const tip = !!booth && has(g, 'tip');
        talk(w, pl, 'cell', [[YOU, 'pickup'], [g, 'hello'], [g, tip ? 'tip' : 'nudge'], ...(tip ? [[YOU, 'on_it'] as Part] : [])]);
      }
      if (booth) textTo(pl, nameOf(g), `Payphone in ${placeName(w, booth.x, booth.y)}. It's ringing for you.`);
      else if (!accept) textTo(pl, nameOf(g), "Give me a call when you want work.");
      return null;
    }
    if (!accept) return null;
    if (pl.mission) { this.say(pl, g, 'busy', [YOU, 'pickup']); return null; }
    this.missions.offer(pl, g, RESPECT.cellPay, [[YOU, 'pickup']]);
    return null;
  }

  /** The player rings a contact to ask for work. */
  dial(pl: Player, gang: string): string | null {
    const w = this.w, c = pl.cell;
    if (pl.mode === Mode.Dead || pl.mode === Mode.Busted) return 'Not now.';
    if (this.people(pl).includes(gang)) { this.ringPerson(pl, gang); return null; }
    if (!this.contacts(pl).includes(gang)) return "You don't have that number.";
    pl.send({ t: 'call', gang, state: 'end' } satisfies S2C);
    // You ask for work; they give you a job, or say you're busy, or that there's nothing.
    if (pl.mission) { this.say(pl, gang, 'busy', [YOU, 'ask']); return null; }
    if ((c.dialCd[gang] ?? 0) > w.time) { this.say(pl, gang, 'nothing', [YOU, 'ask']); return null; }
    c.dialCd[gang] = w.time + RESPECT.cellDialCooldown;
    c.next = Math.max(c.next, w.time + callGap(w));
    this.missions.offer(pl, gang, RESPECT.cellPay, [[YOU, 'ask']]);
    return null;
  }

  /** You ring a person: they pick up, or brush you off if you've blown too many jobs; then they
   *  point you at a payphone that's ringing for you (voiced if they have a `tip`, and a text with
   *  where it is), or say you're busy, or that there's nothing. */
  private ringPerson(pl: Player, who: string): void {
    pl.send({ t: 'call', gang: who, state: 'end' } satisfies S2C);
    if (this.missions.fedUp(pl) && has(who, 'refuse')) { talk(this.w, pl, 'cell', [[who, 'refuse']]); return; }
    const parts: Part[] = [[who, 'answer'], [YOU, 'ask']];
    const booth = this.missions.ringingBooth(pl);
    if (pl.mission) parts.push([who, 'busy']);
    else if (booth) parts.push([who, 'tip'], [YOU, 'on_it']);
    else parts.push([who, 'nothing']);
    talk(this.w, pl, 'cell', parts);
    if (booth) textTo(pl, nameOf(who), `Payphone in ${placeName(this.w, booth.x, booth.y)}. It's ringing for you.`);
  }

  /** `lead`: what you said first (picking up, or asking for work). */
  private say(pl: Player, gang: string, situation: 'busy' | 'nothing', lead: Part): void {
    const who = gangCaller(this.w, pl, gang, situation);
    if (who) talk(this.w, pl, 'cell', [lead, [who, situation]]);
  }
}
