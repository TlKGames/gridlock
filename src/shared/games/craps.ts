// Craps as a casino deals it, at the real payouts (nothing tilted either way). You're the shooter.
// Line bets (pass / don't pass) go down on the come-out; once a point is on you can take odds behind
// them (3-4-5x, paid at true odds) and make come / don't come bets, which travel to their own
// number. Place bets on 4 5 6 8 9 10, hardways, the field and the one-roll bets can go down any time;
// place bets and hardways stay up after they win and are off on the come-out. Place bets, hardways
// and odds can be taken down.
import type { Rng } from '../rng';

export type CrapsKind = 'pass' | 'dont' | 'come' | 'dontcome' | 'place' | 'hard' | 'field' | 'any7' | 'anycraps' | 'yo' | 'aces' | 'twelve' | 'acedeuce';
/** `n`: the number a line or come bet is on (unset till it has one), or the place / hardway number. */
export interface CrapsBet { kind: CrapsKind; n?: number; amount: number; odds: number }
/** `history`: the last rolls' totals, newest first. */
export interface Craps { point: number; bets: CrapsBet[]; last: [number, number] | null; said: string; history: number[] }

export const newCraps = (): Craps => ({ point: 0, bets: [], last: null, said: 'Coming out. Bets on the pass line.', history: [] });

const POINTS = [4, 5, 6, 8, 9, 10];
/** One-roll bets: what they win on and what they pay (to 1). */
const ONE_ROLL: Partial<Record<CrapsKind, { on: number[]; pays: number }>> = {
  any7: { on: [7], pays: 4 }, anycraps: { on: [2, 3, 12], pays: 7 }, yo: { on: [11], pays: 15 },
  aces: { on: [2], pays: 30 }, twelve: { on: [12], pays: 30 }, acedeuce: { on: [3], pays: 15 },
};
const PLACE_PAYS: Record<number, [number, number]> = { 4: [9, 5], 10: [9, 5], 5: [7, 5], 9: [7, 5], 6: [7, 6], 8: [7, 6] };
const ODDS_PAYS: Record<number, [number, number]> = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] };
/** 3-4-5x odds behind pass/come; lay up to 6x behind don't. */
const ODDS_MAX: Record<number, number> = { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };
const pay = (amount: number, [a, b]: [number, number]) => Math.floor((amount * a) / b);
const isDont = (k: CrapsKind) => k === 'dont' || k === 'dontcome';

/** The most odds a line / come bet can take (laying behind a don't: what wins 6x the flat). */
export function oddsRoom(b: CrapsBet): number {
  if (!b.n || !['pass', 'come', 'dont', 'dontcome'].includes(b.kind)) return 0;
  const max = isDont(b.kind) ? Math.ceil((b.amount * 6 * ODDS_PAYS[b.n][0]) / ODDS_PAYS[b.n][1]) : b.amount * ODDS_MAX[b.n];
  return Math.max(0, max - b.odds);
}

/** Can this bet go down now? (The stake's already checked against the table and your money.) */
export function crapsCanBet(g: Craps, kind: CrapsKind, n?: number): string | null {
  if ((kind === 'pass' || kind === 'dont') && g.point) return 'Line bets go down on the come-out.';
  if ((kind === 'come' || kind === 'dontcome') && !g.point) return 'Come bets go down once there\'s a point. Bet the line.';
  if (kind === 'place' && !POINTS.includes(n ?? 0)) return 'Place the 4, 5, 6, 8, 9 or 10.';
  if (kind === 'hard' && ![4, 6, 8, 10].includes(n ?? 0)) return 'Hardways are 4, 6, 8 and 10.';
  return null;
}

/** Puts a bet down (adding to one already there of the same kind and number). */
export function crapsBet(g: Craps, kind: CrapsKind, amount: number, n?: number): void {
  const same = g.bets.find((b) => b.kind === kind && b.n === n && !(['come', 'dontcome'].includes(kind) && b.n !== undefined));
  if (same) same.amount += amount;
  else g.bets.push({ kind, amount, odds: 0, ...(n !== undefined ? { n } : {}) });
}

/** The line or come bet on `n` you can take or lay odds behind (`side` pass/come or dont/dontcome). */
export const oddsTarget = (g: Craps, kind: CrapsKind, n?: number): CrapsBet | undefined =>
  g.bets.find((b) => b.kind === kind && b.n !== undefined && (n === undefined || b.n === n));

/** Takes a place bet, hardway or odds back off the layout: what comes back. */
export function crapsTakeDown(g: Craps, kind: CrapsKind | 'odds', n?: number, of?: CrapsKind): number {
  if (kind === 'odds') {
    const b = oddsTarget(g, of ?? 'pass', n);
    const back = b?.odds ?? 0;
    if (b) b.odds = 0;
    return back;
  }
  if (kind !== 'place' && kind !== 'hard') return 0;
  const i = g.bets.findIndex((b) => b.kind === kind && b.n === n);
  if (i < 0) return 0;
  return g.bets.splice(i, 1)[0].amount;
}

const NAMES: Record<number, string> = { 2: 'Aces', 3: 'Ace-deuce', 11: 'Yo-leven', 12: 'Boxcars' };

/** One throw: settles what it settles. `back`: what comes back to you (stakes and winnings). */
export function crapsRoll(g: Craps, rng: Rng): { back: number; won: number; lost: number } {
  const a = 1 + Math.floor(rng.next() * 6), b = 1 + Math.floor(rng.next() * 6);
  return crapsSettle(g, a, b);
}

export function crapsSettle(g: Craps, a: number, b: number): { back: number; won: number; lost: number } {
  const s = a + b, hard = a === b, comeOut = !g.point;
  g.last = [a, b];
  g.history = [s, ...(g.history ?? [])].slice(0, 16);
  let back = 0, won = 0, lost = 0;
  const keep: CrapsBet[] = [];
  const winBet = (bet: CrapsBet, winnings: number, stays = false) => { won += winnings; back += winnings + (stays ? 0 : bet.amount); if (stays) keep.push(bet); };
  const loseBet = (bet: CrapsBet) => { lost += bet.amount + bet.odds; };
  for (const bet of g.bets) {
    const one = ONE_ROLL[bet.kind];
    if (one) { if (one.on.includes(s)) winBet(bet, bet.amount * one.pays); else loseBet(bet); continue; }
    switch (bet.kind) {
      case 'field':
        if ([3, 4, 9, 10, 11].includes(s)) winBet(bet, bet.amount);
        else if (s === 2) winBet(bet, bet.amount * 2);
        else if (s === 12) winBet(bet, bet.amount * 3);
        else loseBet(bet);
        break;
      case 'place':
        if (comeOut) keep.push(bet); // off on the come-out
        else if (s === 7) loseBet(bet);
        else if (s === bet.n) winBet(bet, pay(bet.amount, PLACE_PAYS[bet.n]), true);
        else keep.push(bet);
        break;
      case 'hard':
        if (comeOut) keep.push(bet);
        else if (s === 7 || (s === bet.n && !hard)) loseBet(bet);
        else if (s === bet.n) winBet(bet, bet.amount * (bet.n === 4 || bet.n === 10 ? 7 : 9), true);
        else keep.push(bet);
        break;
      case 'pass': case 'come': {
        if (bet.n === undefined) {
          if (s === 7 || s === 11) winBet(bet, bet.amount);
          else if (s === 2 || s === 3 || s === 12) loseBet(bet);
          else { bet.n = s; keep.push(bet); }
        } else {
          // Odds behind a come bet are off on the come-out (they come back); a pass line's work.
          const working = bet.kind === 'pass' || !comeOut;
          if (s === bet.n) { const o = working ? pay(bet.odds, ODDS_PAYS[bet.n]) : 0; won += bet.amount + o; back += 2 * bet.amount + bet.odds + o; }
          else if (s === 7) { lost += bet.amount + (working ? bet.odds : 0); back += working ? 0 : bet.odds; }
          else keep.push(bet);
        }
        break;
      }
      case 'dont': case 'dontcome': {
        if (bet.n === undefined) {
          if (s === 2 || s === 3) winBet(bet, bet.amount);
          else if (s === 12) keep.push(bet); // barred: a push, the bet stays for the next roll
          else if (s === 7 || s === 11) loseBet(bet);
          else { bet.n = s; keep.push(bet); }
        } else if (s === 7) { const o = pay(bet.odds, [ODDS_PAYS[bet.n][1], ODDS_PAYS[bet.n][0]]); won += bet.amount + o; back += 2 * bet.amount + bet.odds + o; }
        else if (s === bet.n) loseBet(bet);
        else keep.push(bet);
        break;
      }
    }
  }
  g.bets = keep;
  // The call, and the puck.
  const name = NAMES[s] ?? (hard && [4, 6, 8, 10].includes(s) ? `${s}, the hard way` : String(s));
  if (comeOut) {
    if (POINTS.includes(s)) { g.point = s; g.said = `${name}. The point is ${s}.`; }
    else g.said = s === 7 || s === 11 ? `${name}. Winner on the pass line.` : `${name}. Craps, line away.`;
  } else if (s === 7) { g.point = 0; g.said = 'Seven out. Line away.'; }
  else if (s === g.point) { g.point = 0; g.said = `${name}. Winner, the point is made.`; }
  else g.said = `${name}. The point is ${g.point}.`;
  return { back, won, lost };
}

function ridesOut(b: CrapsBet): boolean {
  return b.n !== undefined && ['pass', 'come', 'dont', 'dontcome'].includes(b.kind);
}

/** Cash already recoverable without rolling any unsettled contract bets. */
export function crapsRefund(g: Craps): number {
  return g.bets.reduce((sum, b) => ridesOut(b) ? sum : sum + b.amount + b.odds, 0);
}

/** Getting up from the table: what can come down comes back; bets already on a number ride the
 *  dice out (thrown for you) so walking away never beats the odds. */
export function crapsWalkAway(g: Craps, rng: Rng): number {
  let back = crapsRefund(g);
  g.bets = g.bets.filter(ridesOut);
  for (let i = 0; i < 500 && g.bets.length; i++) back += crapsRoll(g, rng).back;
  return back;
}
