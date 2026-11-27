// A poker table: Texas hold'em (blinds, flop, turn, river) or five-card draw (antes, one draw), no
// limit, side pots for whoever's all in. Pure state and rules; the server runs a table per player
// (systems/cardTables.ts) and the AI decides in games/pokerAi.ts.
import type { Rng } from '../rng';
import { bestScore, type Card, cardText, deck, handName } from './cards';

/** 'stud': five-card stud, the first card down and the other four dealt face up a street at a time. */
export type PokerVariant = 'holdem' | 'draw' | 'stud';
export type Street = 'idle' | 'pre' | 'flop' | 'turn' | 'river' | 'draw' | 'second' | 's3' | 's4' | 's5' | 'show';

/** The streets a variant's betting rounds run through. */
export const STREETS: Record<PokerVariant, Street[]> = {
  holdem: ['pre', 'flop', 'turn', 'river', 'show'],
  draw: ['pre', 'draw', 'second', 'show'],
  stud: ['pre', 's3', 's4', 's5', 'show'],
};

/** Can everyone see this card? Stud's up cards (all but the first); everyone's at a showdown. */
export const faceUp = (t: { variant: PokerVariant; street: Street }, k: number): boolean => (t.variant === 'stud' && k > 0) || t.street === 'show';

export interface PokerSeat {
  name: string;
  stack: number;
  cards: Card[];
  /** Put in this betting round, and in the whole hand. */
  bet: number;
  total: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  /** The one human at the table (everyone else is the AI). */
  human: boolean;
  /** 0 (a buddy who calls everything) .. 1 (a shark). */
  skill: number;
  /** This seat is a card sharp (sometimes cheats); `cheated`: did, this hand. */
  sharp: boolean;
  cheated: boolean;
  /** Gone from the table (shot, thrown out, or bust and not replaced yet). */
  out: boolean;
  /** Draw: how many it threw in (shown to the table). */
  drew?: number;
  /** What it last did, as the table shows it ("Raise to 400", "Fold", "SB"). */
  last?: string;
}

export interface PokerTable {
  variant: PokerVariant;
  seats: PokerSeat[];
  dealer: number;
  deck: Card[];
  board: Card[];
  street: Street;
  toAct: number;
  currentBet: number;
  minRaise: number;
  /** Hold'em blinds [small, big]; draw ante and the minimum opening bet. */
  blinds: [number, number];
  ante: number;
  /** What happened, newest last (the pane shows the tail). */
  log: string[];
  /** The last showdown: winners by seat and what they won. */
  result: { seat: number; won: number; hand: string }[] | null;
  /** House rake (casino: a cut of each pot, capped). */
  rake: number;
  rakeCap: number;
}

export type PokerAction =
  | { kind: 'fold' } | { kind: 'check' } | { kind: 'call' }
  | { kind: 'raise'; to: number }
  | { kind: 'draw'; discard: number[] };

export const pot = (t: PokerTable): number => t.seats.reduce((a, s) => a + s.total, 0);

/** The pot as the table shows it: the main pot, then a side pot for each all-in short of the
 *  rest (consecutive layers with the same players in them are one pot). */
export function pots(t: PokerTable): number[] {
  // A pot splits only where someone still in is all in for less than the rest.
  const top = Math.max(0, ...t.seats.map((s) => s.total));
  const levels = [...new Set([...t.seats.filter((s) => s.allIn && !s.folded && !s.out).map((s) => s.total), top])].filter((x) => x > 0).sort((a, b) => a - b);
  const out: { amount: number; who: string }[] = [];
  let prev = 0;
  for (const lv of levels) {
    const amount = t.seats.reduce((a, s) => a + Math.max(0, Math.min(s.total, lv) - prev), 0);
    const who = t.seats.map((s, i) => (!s.out && !s.folded && s.total >= lv ? i : -1)).filter((i) => i >= 0).join(',');
    prev = lv;
    const last = out[out.length - 1];
    if (last && (last.who === who || !who)) last.amount += amount; else out.push({ amount, who });
  }
  return out.map((p) => p.amount);
}
const live = (t: PokerTable) => t.seats.filter((s) => !s.out && !s.folded);
const inHand = (s: PokerSeat) => !s.out && !s.folded;
const next = (t: PokerTable, from: number, ok: (s: PokerSeat) => boolean): number => {
  for (let k = 1; k <= t.seats.length; k++) { const i = (from + k) % t.seats.length; if (ok(t.seats[i])) return i; }
  return -1;
};

export function newTable(variant: PokerVariant, seats: PokerSeat[], blinds: [number, number], ante: number, rake = 0, rakeCap = 0): PokerTable {
  return { variant, seats, dealer: 0, deck: [], board: [], street: 'idle', toAct: -1, currentBet: 0, minRaise: blinds[1], blinds, ante, log: [], result: null, rake, rakeCap };
}

const say = (t: PokerTable, text: string) => { t.log.push(text); if (t.log.length > 40) t.log.shift(); };

function putIn(t: PokerTable, s: PokerSeat, amount: number): number {
  const a = Math.min(amount, s.stack);
  s.stack -= a; s.bet += a; s.total += a;
  if (s.stack === 0) s.allIn = true;
  return a;
}

/** Deals a new hand (needs two players with chips). `order`: a stacked deck to deal from. */
export function deal(t: PokerTable, rng: Rng, order?: Card[]): boolean {
  const players = t.seats.filter((s) => !s.out && s.stack > 0);
  if (players.length < 2) return false;
  for (const s of t.seats) {
    s.cards = []; s.bet = 0; s.total = 0; s.folded = s.out || s.stack <= 0; s.allIn = false; s.acted = false; s.cheated = false; s.drew = undefined; s.last = undefined;
  }
  t.dealer = next(t, t.dealer, (s) => !s.folded);
  t.deck = order ? [...order] : deck(rng);
  t.board = [];
  t.result = null;
  const n = t.variant === 'draw' ? 5 : 2;
  for (let r = 0; r < n; r++) for (let k = 1; k <= t.seats.length; k++) { const s = t.seats[(t.dealer + k) % t.seats.length]; if (!s.folded) s.cards.push(t.deck.pop()!); }
  t.currentBet = 0;
  t.minRaise = t.blinds[1];
  if (t.variant === 'holdem') {
    const heads = players.length === 2;
    const sb = heads ? t.dealer : next(t, t.dealer, inHand), bb = next(t, sb, inHand);
    putIn(t, t.seats[sb], t.blinds[0]);
    putIn(t, t.seats[bb], t.blinds[1]);
    t.seats[sb].last = 'SB'; t.seats[bb].last = 'BB';
    t.currentBet = t.blinds[1];
    t.street = 'pre';
    t.toAct = next(t, bb, (s) => inHand(s) && !s.allIn);
    say(t, `${t.seats[t.dealer].name} deals. Blinds ${t.blinds[0]}/${t.blinds[1]}.`);
  } else {
    for (const s of t.seats) if (inHand(s)) putIn(t, s, t.ante);
    for (const s of t.seats) s.bet = 0;
    t.street = 'pre';
    t.toAct = next(t, t.dealer, (s) => inHand(s) && !s.allIn);
    say(t, `${t.seats[t.dealer].name} deals. Ante ${t.ante}.`);
  }
  return true;
}

/** What the seat to act may do. */
export function options(t: PokerTable, i: number): { toCall: number; canCheck: boolean; minTo: number; maxTo: number } {
  const s = t.seats[i];
  const toCall = Math.max(0, t.currentBet - s.bet);
  return { toCall, canCheck: toCall === 0, minTo: Math.min(s.bet + s.stack, t.currentBet + Math.max(t.minRaise, t.blinds[1])), maxTo: s.bet + s.stack };
}

/** Applies an action for the seat to act. Returns an error, or null. */
export function act(t: PokerTable, i: number, a: PokerAction): string | null {
  if (t.toAct !== i) return 'Not your turn.';
  const s = t.seats[i];
  if (t.street === 'draw') {
    if (a.kind !== 'draw') return 'Draw first.';
    const keep = s.cards.filter((_, k) => !a.discard.includes(k));
    const n = s.cards.length - keep.length;
    if (n > 3 && !(n === 4 && keep.some((c) => c % 13 === 12))) return 'Three cards at most (four if you keep an ace).';
    for (let k = 0; k < n; k++) keep.push(t.deck.pop()!);
    s.cards = keep;
    s.drew = n;
    s.acted = true;
    s.last = n ? `Draws ${n}` : 'Stands pat';
    say(t, `${s.name} ${n ? `draws ${n}` : 'stands pat'}.`);
    t.toAct = next(t, i, (q) => inHand(q) && !q.acted);
    if (t.toAct < 0) beginRound(t, 'second');
    return null;
  }
  const o = options(t, i);
  switch (a.kind) {
    case 'fold': s.folded = true; s.last = 'Fold'; say(t, `${s.name} folds.`); break;
    case 'check': if (!o.canCheck) return 'You can\'t check.'; s.last = 'Check'; say(t, `${s.name} checks.`); break;
    case 'call': {
      const c = putIn(t, s, o.toCall);
      s.last = !c ? 'Check' : s.allIn ? 'All in' : `Call ${c}`;
      say(t, c ? `${s.name} calls ${c}${s.allIn ? ', all in' : ''}.` : `${s.name} checks.`);
      break;
    }
    case 'raise': {
      const to = Math.max(o.minTo, Math.min(o.maxTo, Math.round(a.to)));
      // Not enough behind to raise: it's a call (all in).
      if (to <= t.currentBet) return act(t, i, { kind: 'call' });
      const by = to - t.currentBet;
      putIn(t, s, to - s.bet);
      if (by >= t.minRaise) t.minRaise = by;
      const opening = t.currentBet === 0;
      t.currentBet = to;
      // Everyone else has to answer it.
      for (const q of t.seats) if (q !== s) q.acted = false;
      s.last = s.allIn ? 'All in' : opening ? `Bet ${to}` : `Raise to ${to}`;
      say(t, `${s.name} ${opening ? 'bets' : 'raises to'} ${to}${s.allIn ? ', all in' : ''}.`);
      break;
    }
    default: return 'Not now.';
  }
  s.acted = true;
  afterAction(t, i);
  return null;
}

function afterAction(t: PokerTable, i: number): void {
  const left = live(t);
  if (left.length === 1) { award(t, true); return; }
  const waiting = t.seats.findIndex((q) => inHand(q) && !q.allIn && (!q.acted || q.bet < t.currentBet));
  if (waiting >= 0) { t.toAct = next(t, i, (q) => inHand(q) && !q.allIn && (!q.acted || q.bet < t.currentBet)); return; }
  // The round's settled: on to the next.
  const order = STREETS[t.variant];
  beginRound(t, order[order.indexOf(t.street) + 1]);
}

function beginRound(t: PokerTable, street: Street): void {
  // A new betting round: the last round's actions are cleared (a fold or all-in stands).
  for (const q of t.seats) { q.bet = 0; q.acted = false; if (q.last !== 'Fold' && q.last !== 'All in') q.last = undefined; }
  t.currentBet = 0;
  t.minRaise = t.blinds[1];
  t.street = street;
  if (street === 'flop') { t.deck.pop(); t.board.push(t.deck.pop()!, t.deck.pop()!, t.deck.pop()!); say(t, `Flop: ${t.board.map(cardText).join(' ')}`); }
  if (street === 'turn' || street === 'river') { t.deck.pop(); t.board.push(t.deck.pop()!); say(t, `${street === 'turn' ? 'Turn' : 'River'}: ${cardText(t.board[t.board.length - 1])}`); }
  // Stud: another card face up to everyone still in.
  if (street === 's3' || street === 's4' || street === 's5') for (const q of t.seats) if (inHand(q)) q.cards.push(t.deck.pop()!);
  if (street === 'show') { award(t, false); return; }
  // Nobody left to bet against (all in): run it out.
  const canBet = t.seats.filter((q) => inHand(q) && !q.allIn).length;
  if (street !== 'draw' && canBet < 2) { const order = STREETS[t.variant]; beginRound(t, order[order.indexOf(street) + 1] ?? 'show'); return; }
  t.toAct = next(t, t.dealer, (q) => inHand(q) && (street === 'draw' || !q.allIn));
}

/** Showdown (or everyone else folded): pots, side pots for the all-ins, and the rake. */
function award(t: PokerTable, uncontested: boolean): void {
  t.street = 'show';
  t.toAct = -1;
  const scores = t.seats.map((s) => (inHand(s) ? bestScore([...s.cards, ...t.board]) : -1));
  const won = new Map<number, number>();
  let total = pot(t);
  const take = t.rake > 0 && !uncontested ? Math.min(t.rakeCap, Math.floor(total * t.rake)) : 0;
  let rakeLeft = take;
  // Layers by how much each put in: whoever matched a layer and is still in can win it.
  const levels = [...new Set(t.seats.filter((s) => s.total > 0).map((s) => s.total))].sort((a, b) => a - b);
  let prev = 0;
  for (const lv of levels) {
    const layer = t.seats.reduce((a, s) => a + Math.max(0, Math.min(s.total, lv) - prev), 0);
    const contenders = t.seats.map((s, i) => i).filter((i) => inHand(t.seats[i]) && t.seats[i].total >= lv);
    prev = lv;
    if (!contenders.length) continue;
    let amount = layer;
    const r = Math.min(rakeLeft, amount); amount -= r; rakeLeft -= r;
    const best = Math.max(...contenders.map((i) => scores[i]));
    const winners = contenders.filter((i) => scores[i] === best);
    const share = Math.floor(amount / winners.length);
    winners.forEach((i, k) => won.set(i, (won.get(i) ?? 0) + share + (k === 0 ? amount - share * winners.length : 0)));
  }
  total -= take;
  t.result = [...won.entries()].map(([seat, w]) => ({ seat, won: w, hand: uncontested ? '' : handName(scores[seat]) }));
  for (const r of t.result) {
    t.seats[r.seat].stack += r.won;
    t.seats[r.seat].last = `Wins ${r.won}`;
    say(t, uncontested ? `${t.seats[r.seat].name} takes ${r.won}.` : `${t.seats[r.seat].name} wins ${r.won} with ${r.hand.toLowerCase()} (${t.seats[r.seat].cards.map(cardText).join(' ')}).`);
  }
  void total;
}
