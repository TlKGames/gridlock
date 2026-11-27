// A poker game for one player (systems/cardTables.ts runs it): the others are real people sat round
// the table (peds you can see, and shoot), dealt and played by games/poker.ts and games/pokerAi.ts
// at a human pace. Cheating (RULES.cardCheats): you can slip in an ace, stack the deck on your deal
// or peek at your neighbours' cards; each risks being seen, more so the sharper the table. Card
// sharps among the others now and then cheat too, and sometimes it shows; call one out.
import { NAME_PARTS, PEDS, RULES, WEAPONS, pedWith } from '../../../shared/packs';
import type { TableSpec } from '../../../shared/packs/types';
import { FX, HIT } from '../../../shared/protocol';
import { type Card, rank } from '../../../shared/games/cards';
import { act, deal, newTable, type PokerAction, type PokerSeat, type PokerTable } from '../../../shared/games/poker';
import { aiAct } from '../../../shared/games/pokerAi';
import { gangMember } from '../../../shared/world/gangTurf';
import type { TableSpot } from '../../../shared/world/tables';
import { killPed } from '../combat/damage';
import type { Ped, Player } from '../entities';
import { giveWeapon, removePed, spawnPed } from '../factory';
import { setTask } from '../ai/tasks';
import type { World } from '../world';

export interface PokerGame {
  t: PokerTable;
  spec: TableSpec;
  /** The ped sat in each seat (seat 0 is you). */
  peds: number[];
  /** Seconds until the next AI move, or the next deal; and how long that wait was when it began
   *  (the table shows the one to act thinking, the next deal coming). */
  wait: number;
  waitTotal: number;
  /** Seats whose cards you've peeked at this hand; cheats you've pulled this hand. */
  peeked: Set<number>;
  cheated: Set<string>;
  /** You'll be dealt a stacked hand (you rigged the shuffle). */
  stacked: boolean;
  /** Who cheated last hand (still worth calling out). */
  lastCheat: Set<number>;
}

const name = (w: World) => `${NAME_PARTS.first[Math.floor(w.rng.next() * NAME_PARTS.first.length)]}`;

/** Who sits at a table: the gang's own, a friend (seat 1) and their pals, or the public. */
function archFor(w: World, spot: TableSpot, seat: number, friendArch?: string): number {
  if (spot.gang) return gangMember(spot.gang);
  if (friendArch && seat === 1) { const a = PEDS.findIndex((p) => p.id === friendArch); if (a >= 0) return a; }
  const civ = PEDS.map((p, i) => ({ p, i })).filter(({ p }) => p.behaviour === 'civilian');
  return civ.length ? civ[Math.floor(w.rng.next() * civ.length)].i : Math.max(0, pedWith('civilian'));
}

function seatPerson(w: World, spot: TableSpot, k: number, friendArch?: string): number {
  const s = spot.seats[k - 1];
  const p = spawnPed(w, archFor(w, spot, k, friendArch), s.x, s.y, s.angle);
  p.persistent = true;
  setTask(p, 'stand');
  p.ai!.post = { x: s.x, y: s.y, angle: s.angle };
  return p.id;
}

export function startPoker(w: World, pl: Player, spot: TableSpot, spec: TableSpec, chips: number, friend?: { name: string; arch: string }): PokerGame {
  const friendName = friend?.name;
  const n = Math.min(spec.players ?? 4, spot.seats.length);
  const [lo, hi] = spec.buyIn ?? [spec.stakes[1] * 40, spec.stakes[1] * 100];
  const seats: PokerSeat[] = [];
  const peds = [pl.pid];
  const seat = (nm: string, stack: number, human: boolean): PokerSeat => ({
    name: nm, stack, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, human,
    skill: spec.skill ?? 0.5, sharp: false, cheated: false, out: false,
  });
  seats.push(seat('You', chips, true));
  for (let k = 1; k <= n; k++) {
    const s = seat(k === 1 && friendName ? friendName : name(w), Math.round(w.rng.range(lo, hi)), false);
    // A little spread in how well each plays; some are sharps.
    s.skill = Math.max(0, Math.min(1, (spec.skill ?? 0.5) + w.rng.range(-0.12, 0.12)));
    s.sharp = RULES.cardCheats && w.rng.chance(spec.sharps ?? 0) && !(k === 1 && friendName);
    seats.push(s);
    peds.push(seatPerson(w, spot, k, friend?.arch));
  }
  const draw = spec.game !== 'holdem';
  const t = newTable(spec.game === 'holdem' ? 'holdem' : spec.game === 'stud' ? 'stud' : 'draw', seats,
    draw ? [spec.stakes[0], spec.stakes[1]] : spec.stakes, draw ? spec.stakes[0] : 0, spec.rake?.[0] ?? 0, spec.rake?.[1] ?? 0);
  t.dealer = Math.floor(w.rng.next() * seats.length);
  return { t, spec, peds, wait: 1.5, waitTotal: 1.5, peeked: new Set(), cheated: new Set(), stacked: false, lastCheat: new Set() };
}

/** Everyone sat at the table goes home (you stay where you are). */
export function endPoker(w: World, g: PokerGame): void {
  for (const id of g.peds.slice(1)) { const p = w.peds.get(id); if (p && !p.dead) removePed(w, p); }
}

/** One tick: seats emptied by a death, the AI's moves, the next deal. Returns true when the view changed. */
export function tickPoker(w: World, g: PokerGame, dt: number, log: (s: string) => void): boolean {
  const t = g.t;
  let changed = false;
  g.peds.forEach((id, k) => {
    if (k === 0) return;
    const p = w.peds.get(id);
    if ((!p || p.dead) && !t.seats[k].out) { t.seats[k].out = true; t.seats[k].folded = true; changed = true; log(`${t.seats[k].name} is out of the game.`); }
  });
  g.wait -= dt;
  if (g.wait > 0) return changed;
  if (t.street === 'show' || t.street === 'idle') {
    if (t.seats[0].stack <= 0) return changed; // waiting on a rebuy
    // Bust seats take a fresh player in their chair.
    t.seats.forEach((s, k) => {
      if (k === 0 || s.out || s.stack > 0) return;
      const [lo, hi] = g.spec.buyIn ?? [t.blinds[1] * 40, t.blinds[1] * 100];
      log(`${s.name} is busted and leaves; ${(s.name = name(w))} sits down.`);
      s.stack = Math.round(w.rng.range(lo, hi));
    });
    if (t.seats.filter((s) => !s.out && s.stack > 0).length < 2) return changed;
    g.lastCheat = new Set(t.seats.map((s, k) => (s.cheated ? k : -1)).filter((k) => k > 0));
    g.peeked.clear(); g.cheated.clear();
    deal(t, w.rng);
    if (g.stacked) { stackHand(t); g.stacked = false; }
    aiCheats(w, t, log);
    g.wait = g.waitTotal = 0.8 + thinkTime(w, t);
    return true;
  }
  if (t.toAct > 0) {
    const a = aiAct(t, t.toAct, w.rng);
    act(t, t.toAct, a);
    // (act moves the hand on: it may be over now) The next one to act thinks it over.
    g.wait = g.waitTotal = (t.street as string) === 'show' ? 4 : thinkTime(w, t);
    return true;
  }
  return changed;
}

/** Your move at the table. */
export function pokerMove(w: World, g: PokerGame, a: PokerAction): string | null {
  const t = g.t;
  if (t.toAct !== 0) return 'Not your turn.';
  const err = act(t, 0, a);
  // The next one thinks it over (or the pot's pushed and the next deal waits).
  g.wait = g.waitTotal = t.street === 'show' ? 4 : thinkTime(w, t);
  return err;
}

/** How long the one to act (if it's not you) takes over it: longer facing a bet. */
function thinkTime(w: World, t: PokerTable): number {
  if (t.toAct <= 0) return 0.7;
  const facing = t.currentBet > t.seats[t.toAct].bet;
  return 0.8 + w.rng.next() * 1.1 + (facing ? 0.5 : 0);
}

// ---- Cheating ----------------------------------------------------------------------------------

/** What you could pull right now. */
export function cheatsOpen(g: PokerGame): string[] {
  if (!RULES.cardCheats) return [];
  const t = g.t, me = t.seats[0];
  const out: string[] = [];
  const inHand = t.street !== 'show' && t.street !== 'idle' && !me.folded;
  if (inHand && !g.cheated.has('peek')) out.push('peek');
  if (inHand && !g.cheated.has('ace') && me.cards.some((c) => rank(c) !== 12) && aceLeft(t) >= 0) out.push('ace');
  // Stacking the deck: between hands, when the next deal is yours.
  const nextDealer = nextIn(t, t.dealer);
  if (!inHand && nextDealer === 0 && !g.stacked) out.push('stack');
  out.push('callout');
  return out;
}

const nextIn = (t: PokerTable, from: number) => { for (let k = 1; k <= t.seats.length; k++) { const i = (from + k) % t.seats.length; if (!t.seats[i].out && t.seats[i].stack > 0) return i; } return -1; };

/** An ace still in the deck (not on the table or in anyone's hand). */
function aceLeft(t: PokerTable): number {
  return t.deck.findIndex((c) => rank(c) === 12);
}

/** How likely the table is to spot a cheat: the sharper the company, the likelier. */
function spotted(w: World, t: PokerTable, base: number, per: number): boolean {
  const eyes = t.seats.filter((s) => !s.human && !s.out);
  const sharp = eyes.length ? eyes.reduce((a, s) => a + s.skill, 0) / eyes.length : 0;
  return w.rng.chance(Math.min(0.9, base + per * sharp));
}

export type CheatOutcome = { caught: boolean; text: string; by?: number };

export function cheat(w: World, g: PokerGame, kind: string): CheatOutcome {
  const t = g.t, me = t.seats[0];
  if (!cheatsOpen(g).includes(kind)) return { caught: false, text: 'Not now.' };
  g.cheated.add(kind);
  if (kind === 'peek') {
    // The players either side of you.
    const left = nextIn(t, 0), right = (() => { for (let k = t.seats.length - 1; k > 0; k--) if (!t.seats[k].out && !t.seats[k].folded) return k; return -1; })();
    for (const k of [left, right]) if (k > 0) g.peeked.add(k);
    if (spotted(w, t, 0.04, 0.12)) return { caught: true, text: 'Somebody saw your eyes wander.', by: left > 0 ? left : right };
    return { caught: false, text: 'You get a look at your neighbours\' cards.' };
  }
  if (kind === 'ace') {
    // Your lowest card goes up your sleeve; an ace from the deck comes out of it.
    const ai = aceLeft(t);
    let low = 0;
    me.cards.forEach((c, k) => { if (rank(c) < rank(me.cards[low])) low = k; });
    const ace = t.deck.splice(ai, 1)[0];
    t.deck.splice(Math.floor(w.rng.next() * t.deck.length), 0, me.cards[low]);
    me.cards[low] = ace;
    if (spotted(w, t, 0.12, 0.25)) return { caught: true, text: 'An ace too many. They saw it come out of your sleeve.', by: across(t) };
    return { caught: false, text: 'An ace slides out of your sleeve into your hand.' };
  }
  // Stacking: your next deal gives you a hand worth having.
  g.stacked = true;
  if (spotted(w, t, 0.1, 0.2)) return { caught: true, text: 'Your shuffle was too neat. They know a stacked deck when they see one.', by: across(t) };
  return { caught: false, text: 'You run up the deck as you shuffle. Next hand is yours.' };
}

/** The seat across the table from you (the man who'd see it). */
function across(t: PokerTable): number {
  const live = t.seats.map((s, k) => k).filter((k) => k > 0 && !t.seats[k].out);
  return live[Math.floor(live.length / 2)] ?? 1;
}

/** Rig the deal you just made: you get a monster (a pair of aces; draw: three aces). */
function stackHand(t: PokerTable): void {
  const me = t.seats[0];
  const want = t.variant === 'draw' ? 3 : 2;
  const aces: Card[] = [];
  for (const s of t.seats) if (!s.human) for (let k = 0; k < s.cards.length; k++) if (rank(s.cards[k]) === 12 && aces.length < want) { aces.push(s.cards[k]); s.cards[k] = t.deck.pop()!; }
  for (let k = t.deck.length - 1; k >= 0 && aces.length < want; k--) if (rank(t.deck[k]) === 12) aces.push(t.deck.splice(k, 1)[0]);
  aces.forEach((a, k) => { t.deck.unshift(me.cards[k]); me.cards[k] = a; });
}

/** Sharps sometimes help themselves: a better card from the deck. Sometimes it shows. */
function aiCheats(w: World, t: PokerTable, log: (s: string) => void): void {
  if (!RULES.cardCheats) return;
  t.seats.forEach((s) => {
    if (s.human || s.out || !s.sharp || !w.rng.chance(0.06)) return;
    const ai = t.deck.findIndex((c) => rank(c) >= 10);
    if (ai < 0) return;
    let low = 0;
    s.cards.forEach((c, k) => { if (rank(c) < rank(s.cards[low])) low = k; });
    const good = t.deck.splice(ai, 1)[0];
    t.deck.unshift(s.cards[low]);
    s.cards[low] = good;
    s.cheated = true;
    // A tell: not always.
    if (w.rng.chance(0.55)) log(w.rng.pick([`${s.name}'s hand dips below the table for a second.`, `${s.name} squares the deck a little too carefully.`, `Something up ${s.name}'s sleeve catches the light.`]));
  });
}

/** Calling someone out. Right: you draw and shoot him dead before he moves (his money's yours).
 *  Wrong: he goes for his gun, and so does anyone with him. */
export function callOut(w: World, g: PokerGame, k: number, me: Ped): { right: boolean; text: string } {
  const t = g.t, s = t.seats[k];
  const them = w.peds.get(g.peds[k]);
  if (!s || k === 0 || s.out || !them) return { right: false, text: 'Nobody there.' };
  const right = s.cheated || g.lastCheat.has(k);
  if (right) {
    shoot(w, me, them);
    // The hand's off: everyone takes back what they put in; his stack is yours.
    for (const q of t.seats) { q.stack += q.total; q.total = 0; q.bet = 0; }
    t.seats[0].stack += s.stack + 0;
    s.stack = 0; s.out = true; s.folded = true;
    t.street = 'show'; t.toAct = -1; t.result = null;
    g.wait = g.waitTotal = 3;
    return { right: true, text: `You call ${s.name} a cheat, and you're right. You draw first.` };
  }
  return { right: false, text: `${s.name} wasn't cheating. He's going for his gun.` };
}

/** Puts a sidearm in someone's hand if they haven't one (to draw at the table). */
export function arm(p: Ped): void {
  const gun = p.weapons.findIndex((h) => WEAPONS[h.w].kind !== 'melee' && (h.clip > 0 || h.ammo > 0));
  if (gun >= 0) { p.wi = gun; return; }
  const sidearm = WEAPONS.findIndex((x) => x.kind !== 'melee' && x.slot === 1);
  if (sidearm < 0) return;
  giveWeapon(p, sidearm, WEAPONS[sidearm].clip * 2);
  p.wi = p.weapons.findIndex((h) => h.w === sidearm);
}

/** Draw and fire across the table: one shot, dead (the shot and blood drawn as any other). */
export function shoot(w: World, from: Ped, at: Ped): void {
  arm(from);
  from.aim = Math.atan2(at.body.y - from.body.y, at.body.x - from.body.x);
  from.body.angle = from.aim;
  const r = (v: number) => Math.round(v * 100) / 100;
  w.emit(FX.Shot, r(from.body.x), r(from.body.y), r(at.body.x), r(at.body.y), from.weapons[from.wi]?.w ?? 0, HIT.flesh, from.id);
  w.emit(FX.Blood, r(at.body.x), r(at.body.y));
  killPed(w, at, from);
}
