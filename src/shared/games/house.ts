// House games: you against the bank. Pure rules on the room's RNG; the server runs a round per
// player (systems/cardTables.ts) and the pane shows it (client hud/cardTable.ts). Bets are whole
// dollars; every function returns what changed hands so the caller pays out.
import type { Rng } from '../rng';
import { type Card, cardText, deck, rank } from './cards';

// ---- Blackjack / twenty-one -------------------------------------------------------------------

export interface BjHand { cards: Card[]; bet: number; done: boolean; doubled: boolean }
export interface Blackjack {
  /** 'twentyone': a single deck, the dealer draws to a soft 17, no splitting. */
  variant: 'blackjack' | 'twentyone';
  shoe: Card[];
  hands: BjHand[];
  active: number;
  dealer: Card[];
  phase: 'bet' | 'play' | 'done';
  /** What each hand came to (for the pane) and the net paid back to you this round. */
  outcome: string[];
  paid: number;
}

/** Blackjack value: the best total not over 21 (aces 1 or 11), and whether an ace still counts 11. */
export function bjValue(cs: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cs) { const r = rank(c); if (r === 12) { aces++; total += 11; } else total += r >= 8 ? 10 : r + 2; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const natural = (cs: Card[]) => cs.length === 2 && bjValue(cs).total === 21;

export function newBlackjack(variant: Blackjack['variant']): Blackjack {
  return { variant, shoe: [], hands: [], active: 0, dealer: [], phase: 'bet', outcome: [], paid: 0 };
}

function draw(g: { shoe: Card[] }, rng: Rng, decks: number): Card {
  if (g.shoe.length < 15) { g.shoe = []; for (let d = 0; d < decks; d++) g.shoe.push(...deck(rng)); rng.shuffle(g.shoe); }
  return g.shoe.pop()!;
}

const decksOf = (g: Blackjack) => (g.variant === 'blackjack' ? 6 : 1);

/** Deals a round for `bet` (already taken from you). */
export function bjDeal(g: Blackjack, rng: Rng, bet: number): void {
  g.hands = [{ cards: [draw(g, rng, decksOf(g)), draw(g, rng, decksOf(g))], bet, done: false, doubled: false }];
  g.dealer = [draw(g, rng, decksOf(g)), draw(g, rng, decksOf(g))];
  g.active = 0; g.phase = 'play'; g.outcome = []; g.paid = 0;
  if (natural(g.hands[0].cards) || natural(g.dealer)) bjFinish(g, rng);
}

/** hit / stand / double / split on the active hand. Returns the extra stake it needs (double,
 *  split) the caller must take first, or an error. */
export function bjStake(g: Blackjack, op: 'double' | 'split'): number | string {
  const h = g.hands[g.active];
  if (g.phase !== 'play' || !h || h.cards.length !== 2) return 'Only on your first two cards.';
  if (op === 'split') {
    if (g.variant !== 'blackjack' || g.hands.length > 1) return 'No splitting here.';
    const val = (c: Card) => (rank(c) === 12 ? 11 : Math.min(10, rank(c) + 2));
    if (val(h.cards[0]) !== val(h.cards[1])) return 'Only a pair splits.';
  }
  return h.bet;
}

export function bjAct(g: Blackjack, rng: Rng, op: 'hit' | 'stand' | 'double' | 'split'): void {
  const h = g.hands[g.active];
  if (g.phase !== 'play' || !h) return;
  const n = decksOf(g);
  if (op === 'split') {
    const second: BjHand = { cards: [h.cards.pop()!, draw(g, rng, n)], bet: h.bet, done: false, doubled: false };
    h.cards.push(draw(g, rng, n));
    g.hands.push(second);
    return;
  }
  if (op === 'double') { h.bet *= 2; h.doubled = true; h.cards.push(draw(g, rng, n)); h.done = true; }
  else if (op === 'hit') { h.cards.push(draw(g, rng, n)); if (bjValue(h.cards).total >= 21) h.done = true; }
  else h.done = true;
  if (!h.done) return;
  g.active++;
  if (g.active >= g.hands.length) bjFinish(g, rng);
}

/** The dealer plays out and every hand is settled. */
function bjFinish(g: Blackjack, rng: Rng): void {
  const n = decksOf(g);
  const live = g.hands.some((h) => bjValue(h.cards).total <= 21) && !natural(g.hands[0].cards);
  if (live && !natural(g.dealer)) {
    for (;;) {
      const v = bjValue(g.dealer);
      if (v.total > 17 || (v.total === 17 && !(g.variant === 'twentyone' && v.soft))) break;
      g.dealer.push(draw(g, rng, n));
    }
  }
  const d = bjValue(g.dealer).total, dNat = natural(g.dealer);
  g.paid = 0;
  g.outcome = g.hands.map((h) => {
    const v = bjValue(h.cards).total;
    const nat = natural(h.cards) && g.hands.length === 1;
    if (nat && !dNat) { g.paid += h.bet + Math.floor(h.bet * 1.5); return 'Blackjack! Pays 3 to 2.'; }
    if (v > 21) return 'Bust.';
    if (dNat) return nat ? (g.paid += h.bet, 'Push.') : 'Dealer has blackjack.';
    if (d > 21 || v > d) { g.paid += h.bet * 2; return d > 21 ? 'Dealer busts. You win.' : 'You win.'; }
    if (v === d) { g.paid += h.bet; return 'Push.'; }
    return 'Dealer wins.';
  });
  g.phase = 'done';
}

// ---- Roulette ---------------------------------------------------------------------------------

/** American wheel: 0, 00 (37) and 1..36. */
export const ROULETTE_REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export type RouletteBet = { on: 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' | 'dozen1' | 'dozen2' | 'dozen3' | 'col1' | 'col2' | 'col3' | 'number'; n?: number; amount: number };
export const ROULETTE_KINDS = new Set(['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3', 'number']);

export const rouletteName = (n: number): string => (n === 37 ? '00' : String(n));

/** Spins once: the number, and what comes back for each bet (stake included; 0 lost). */
export function spinRoulette(rng: Rng, bets: RouletteBet[]): { n: number; back: number[] } {
  const n = Math.floor(rng.next() * 38); // 0..36, and 37 for 00
  const real = n >= 1 && n <= 36;
  const back = bets.map((b) => {
    const win = (() => {
      switch (b.on) {
        case 'number': return b.n === n ? 36 : 0;
        case 'red': return real && ROULETTE_REDS.has(n) ? 2 : 0;
        case 'black': return real && !ROULETTE_REDS.has(n) ? 2 : 0;
        case 'odd': return real && n % 2 === 1 ? 2 : 0;
        case 'even': return real && n % 2 === 0 ? 2 : 0;
        case 'low': return real && n <= 18 ? 2 : 0;
        case 'high': return real && n >= 19 ? 2 : 0;
        // Columns: the layout's three rows of twelve (1, 4, 7...; 2, 5, 8...; 3, 6, 9...), 2 to 1.
        case 'col1': case 'col2': case 'col3': return real && ((n - 1) % 3) + 1 === Number(b.on.slice(3)) ? 3 : 0;
        default: { const k = Number(b.on.slice(5)); return real && Math.ceil(n / 12) === k ? 3 : 0; }
      }
    })();
    return b.amount * win;
  });
  return { n, back };
}

// ---- Dice: craps and hazard -------------------------------------------------------------------

export interface Dice {
  variant: 'craps' | 'hazard';
  /** Craps: the point (0 on the come-out). Hazard: the caster's main and the chance (0 until set). */
  point: number;
  main: number;
  bet: number;
  /** Craps: on the pass line, or don't pass. */
  side: 'pass' | 'dont';
  last: [number, number] | null;
  said: string;
  /** The last throws' totals, newest first. */
  history: number[];
}

export const newDice = (variant: Dice['variant']): Dice => ({ variant, point: 0, main: 7, bet: 0, side: 'pass', last: null, said: '', history: [] });

/** One roll. Returns what comes back to you (stake included) when the bet is settled, else null. */
export function rollDice(g: Dice, rng: Rng): number | null {
  const a = 1 + Math.floor(rng.next() * 6), b = 1 + Math.floor(rng.next() * 6), s = a + b;
  g.last = [a, b];
  g.history = [s, ...g.history].slice(0, 16);
  const win = (text: string) => { g.said = text; g.point = 0; const back = g.bet * 2; g.bet = 0; return back; };
  const lose = (text: string) => { g.said = text; g.point = 0; g.bet = 0; return 0; };
  const push = (text: string) => { g.said = text; g.point = 0; const back = g.bet; g.bet = 0; return back; };
  if (g.variant === 'craps') {
    const pass = g.side === 'pass';
    if (!g.point) {
      if (s === 7 || s === 11) return pass ? win(`${s}: a natural. Pass wins.`) : lose(`${s}: a natural. Don't pass loses.`);
      if (s === 2 || s === 3) return pass ? lose(`${s}: craps. Pass loses.`) : win(`${s}: craps. Don't pass wins.`);
      if (s === 12) return pass ? lose('12: craps. Pass loses.') : push('12: craps. Don\'t pass pushes.');
      g.point = s; g.said = `The point is ${s}.`; return null;
    }
    if (s === g.point) return pass ? win(`${s}: made the point. Pass wins.`) : lose(`${s}: the point. Don't pass loses.`);
    if (s === 7) return pass ? lose('7 out. Pass loses.') : win('7 out. Don\'t pass wins.');
    g.said = `${s}. Still looking for ${g.point}.`; return null;
  }
  // Hazard: the caster calls a main (5 to 9); on the first throw some totals nick it (win), some throw
  // out (lose), anything else becomes the chance, and then the chance wins and the main loses.
  const m = g.main;
  if (!g.point) {
    const nicks = m === 5 ? [5] : m === 6 ? [6, 12] : m === 7 ? [7, 11] : m === 8 ? [8, 12] : [9];
    const outs = [2, 3, ...(m === 5 || m === 9 ? [11, 12] : m === 7 ? [12] : [11])];
    if (nicks.includes(s)) return win(`${s}: nicked the main. You win.`);
    if (outs.includes(s)) return lose(`${s}: thrown out. You lose.`);
    g.point = s; g.said = `${s} is your chance. Throw it before ${m}.`; return null;
  }
  if (s === g.point) return win(`${s}: the chance. You win.`);
  if (s === m) return lose(`${s}: the main. You lose.`);
  g.said = `${s}. Chance ${g.point}, main ${m}.`; return null;
}

// ---- Slots ------------------------------------------------------------------------------------

export const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍑', '🔔', 'BAR', '7'];
/** How often each symbol comes up on a reel. */
const SLOT_WEIGHTS = [7, 6, 5, 4, 3, 2, 1];
/** Three of a kind pays (times the bet); two cherries pay double. About 89% comes back. */
export const SLOT_PAYS = [10, 15, 20, 30, 50, 100, 250];

export function pullSlots(rng: Rng, bet: number): { reels: number[]; back: number } {
  const total = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
  const reel = () => { let r = rng.next() * total; for (let i = 0; i < SLOT_WEIGHTS.length; i++) { r -= SLOT_WEIGHTS[i]; if (r <= 0) return i; } return 0; };
  const reels = [reel(), reel(), reel()];
  let k = 0;
  if (reels[0] === reels[1] && reels[1] === reels[2]) k = SLOT_PAYS[reels[0]];
  else if (reels.filter((r) => r === 0).length === 2) k = 2;
  return { reels, back: bet * k };
}

// ---- Faro -------------------------------------------------------------------------------------

/** Faro: you stake a rank on the layout; each turn the dealer shows a losing card then a winning
 *  one. Your rank as the winner pays even money, as the loser the bank takes it, both at once (a
 *  split) the bank takes half. */
export interface Faro { box: Card[]; bets: Map<number, number>; turn: [Card, Card] | null; said: string }

export function newFaro(rng: Rng): Faro {
  const d = deck(rng);
  d.pop(); // the soda card, burned
  return { box: d, bets: new Map(), turn: null, said: '' };
}

/** Deals one turn; returns what comes back to you (stakes included) for the bets it settled. */
export function faroTurn(g: Faro, rng: Rng): number {
  if (g.box.length < 3) { const n = newFaro(rng); g.box = n.box; g.said = 'A fresh deck in the box.'; }
  const lose = g.box.pop()!, win = g.box.pop()!;
  g.turn = [lose, win];
  const lr = rank(lose), wr = rank(win);
  let back = 0;
  const notes: string[] = [];
  for (const [r, stake] of [...g.bets]) {
    if (r === lr && r === wr) { back += Math.floor(stake / 2); g.bets.delete(r); notes.push('A split: the bank takes half.'); }
    else if (r === wr) { back += stake * 2; g.bets.delete(r); notes.push(`Your ${cardText(win).slice(0, -1)} wins.`); }
    else if (r === lr) { g.bets.delete(r); notes.push(`Your ${cardText(lose).slice(0, -1)} loses.`); }
  }
  g.said = `${cardText(lose)} loses, ${cardText(win)} wins.${notes.length ? ` ${notes.join(' ')}` : ''}`;
  return back;
}
