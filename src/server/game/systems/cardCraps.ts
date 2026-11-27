// A craps table's moves (shared/games/craps.ts runs the game): bets on the layout, odds behind the
// line and come bets, taking bets down, and the throw. Flat bets are held to the table's limits;
// odds go up to 3-4-5x (or lay to win 6x) on top of them, as casinos allow.
import { type Craps, type CrapsKind, crapsBet, crapsCanBet, crapsRoll, crapsTakeDown, oddsRoom, oddsTarget } from '../../../shared/games/craps';
import type { TableView } from '../../../shared/protocol';
import type { Rng } from '../../../shared/rng';

const KINDS = new Set<CrapsKind>(['pass', 'dont', 'come', 'dontcome', 'place', 'hard', 'field', 'any7', 'anycraps', 'yo', 'aces', 'twelve', 'acedeuce']);
const LINE = new Set<CrapsKind>(['pass', 'dont', 'come', 'dontcome']);

export interface CrapsMoney {
  /** Takes a flat bet (checked against the table's limits and your money): the amount or why not. */
  stake: (n: unknown) => number | string;
  /** Takes any amount you have (odds aren't held to the table limit). */
  take: (n: number) => boolean;
  /** Money back to you (winnings and returned stakes). */
  pay: (n: number) => void;
  log: (text: string) => void;
  rng: Rng;
}

export function crapsOp(g: Craps, m: { op: string; n?: number; m?: number; s?: string }, $: CrapsMoney): string | null {
  const n = m.m !== undefined ? Math.round(Number(m.m)) : undefined;
  if (m.op === 'bet') {
    const kind = String(m.s) as CrapsKind;
    if (!KINDS.has(kind)) return 'Not a bet on this layout.';
    const no = crapsCanBet(g, kind, n); if (no) return no;
    const v = $.stake(m.n); if (typeof v === 'string') return v;
    crapsBet(g, kind, v, kind === 'place' || kind === 'hard' ? n : undefined);
    return null;
  }
  if (m.op === 'odds') {
    const of = String(m.s) as CrapsKind;
    if (!LINE.has(of)) return 'Odds go behind a line or come bet.';
    const t = oddsTarget(g, of, n);
    if (!t) return 'There\'s no bet on a number to back.';
    const room = oddsRoom(t);
    const want = Math.min(room, Math.round(Number(m.n)));
    if (!(want > 0)) return 'That bet has all the odds it can take.';
    if (!$.take(want)) return 'Not enough money.';
    t.odds += want;
    return null;
  }
  if (m.op === 'down') {
    const what = String(m.s);
    const back = what.startsWith('odds-') ? crapsTakeDown(g, 'odds', n, what.slice(5) as CrapsKind) : crapsTakeDown(g, what as CrapsKind, n);
    if (!back) return 'Nothing there to take down.';
    $.pay(back);
    return null;
  }
  if (m.op === 'roll') {
    if (!g.bets.length) return 'Put a bet down first.';
    const r = crapsRoll(g, $.rng);
    $.log(g.said);
    if (r.back) $.pay(r.back);
    if (r.won) $.log(`You win $${r.won.toLocaleString('en-US')}.`);
    if (r.lost) $.log(`You lose $${r.lost.toLocaleString('en-US')}.`);
    return null;
  }
  return 'Not a move.';
}

export const crapsView = (g: Craps): NonNullable<TableView['craps']> => ({
  point: g.point, last: g.last, said: g.said, bets: g.bets.map((b) => [b.kind, b.n ?? 0, b.amount, b.odds]), history: g.history,
});
