// What a card or casino table's screen (hud/tableRoom.ts) shows: the table on the left and, on the
// right, the stakes, your money and your moves; the moves you make most along the foot, as an online
// table's action bar. Each game builds its own (pokerTable.ts, rouletteTable.ts, houseTables.ts,
// crapsTable.ts); this holds what they share and the screen before you sit down. The server
// (systems/cardTables.ts) runs the game; these only show it and send your moves.
import { FRIENDS, TABLES } from '../../shared/packs';
import type { TableView, YouState } from '../../shared/protocol';
import type { TableSpot } from '../../shared/world/tables';
import { crapsScreen } from './crapsTable';
import { bjScreen, diceScreen, faroScreen, slotsScreen } from './houseTables';
import { pokerScreen } from './pokerTable';
import { rouletteScreen } from './rouletteTable';
import { type Act, joinFelt, money as $, type TableSend } from './tableFelt';

export type { TableSend };

/** A button. `key`: its keyboard shortcut (a KeyboardEvent code); `tone` colours the action bar's. */
export interface TBtn { text: string; sub?: string; price?: string; on?: boolean; off?: boolean; act: () => void; key?: string; tone?: 'fold' | 'call' | 'raise' | 'go' }
/** A slider (a bet size, a buy-in): `label` shows the value beside it; `set` takes the new one. */
export interface TSlider { min: number; max: number; step: number; value: number; label: (v: number) => string; set: (v: number) => void }
/** A set of buttons under a heading; `chips`: small ones in a row (bet sizes, ranks, cards);
 *  `size`: the bet sizing (presets, a slider), drawn beside the action buttons. */
export interface TGroup { name: string; btns: TBtn[]; chips?: boolean; slider?: TSlider; size?: boolean }
export interface TableScreen {
  title: string; sub: string; money: string; felt: string; groups: TGroup[];
  /** The main move (one big button), or the action bar (several side by side). */
  primary?: TBtn;
  bar?: TBtn[];
  log: string[];
  /** Your cash right now (the screen shows what each round won or cost). */
  cash: number;
  /** Getting up now costs you something: asked first. */
  leaveWarn?: string;
  /** Run on the screen's own clock, four times a second (a slot machine's auto-spin). */
  tick?: () => void;
}

/** What you've picked but not sent yet, per game (kept while you're at the table). */
export const tableUi = {
  chip: 0, buyIn: 0, main: 7, rank: 12, discard: new Set<number>(),
  /** Poker: the bet slider; what to do when it comes round to you. */
  raiseTo: 0, pre: '' as '' | 'fold' | 'checkfold' | 'check' | 'callany' | 'call', preCall: 0,
  /** Blackjack: the bet in the circle and the last one. Roulette: chips on the layout, the order
   *  they went down (to undo), the last spin's. Slots: spins left on auto. */
  bjBet: 0, bjLast: 0,
  rBets: new Map<string, number>(), rUndo: [] as [string, number][], rLast: new Map<string, number>(),
  autoSpins: 0, lastPull: 0, spunAt: 0, lastReels: null as number[] | null,
};

/** Chip values for a table's stakes: the smallest bet and a few steps up, never over the top. */
export function chipValues(lo: number, hi: number): number[] {
  const out = [lo, lo * 5, lo * 25, lo * 100].filter((v) => v <= hi);
  return out.length ? out : [lo];
}
export function chipGroup(lo: number, hi: number, name = 'Chip'): TGroup {
  const list = chipValues(lo, hi);
  tableUi.chip = Math.min(tableUi.chip, list.length - 1);
  return { name, chips: true, btns: list.map((v, i) => ({ text: $(v), on: i === tableUi.chip, act: () => { tableUi.chip = i; } })) };
}
export const chipOf = (lo: number, hi: number) => chipValues(lo, hi)[tableUi.chip] ?? lo;
export const isPoker = (game: string) => game === 'holdem' || game === 'draw' || game === 'stud';
export const cashLine = (you: YouState, chips?: number) => [`Cash ${$(you.cash)}`, you.bank > 0 ? `Bank ${$(you.bank)}` : '', chips !== undefined ? `Chips ${$(chips)}` : ''].filter(Boolean).join(' · ');

export function stakesOf(spot: TableSpot): string {
  const spec = TABLES[spot.spec];
  if (!isPoker(spec.game)) return spec.prop === 'slots' ? `${$(spec.stakes[0])} to ${$(spec.stakes[1])} a pull` : `Bets ${$(spec.stakes[0])} to ${$(spec.stakes[1])}`;
  return spec.game === 'holdem' ? `No-limit hold'em · blinds ${$(spec.stakes[0])}/${$(spec.stakes[1])}` : `Ante ${$(spec.stakes[0])}, bets from ${$(spec.stakes[1])}`;
}

/** Before you sit down: the game, its stakes, your buy-in. */
export function joinScreen(spot: TableSpot, you: YouState, met: (key: string) => boolean, send: TableSend): TableScreen {
  const spec = TABLES[spot.spec];
  const stakes = stakesOf(spot);
  const friend = spot.friend ? FRIENDS.find((f) => f.id === spot.friend) : undefined;
  const note = spot.host === 'gang' ? 'A private game. Invite only.' : friend ? `${friend.name}'s game, when it's on.` : spec.prop === 'slots' ? 'One-armed bandit' : spec.players ? `${spec.players} players at the table` : 'The dealer\'s waiting';
  const base = { title: spot.name, sub: stakes, money: cashLine(you), felt: joinFelt(spot, stakes, note), log: [], cash: you.cash };
  if (friend && !met(`friend:${friend.id}`)) {
    return { ...base, groups: [], primary: { text: `Say hello to ${friend.name}`, act: () => send({ op: 'meet', table: spot.id }) } };
  }
  const can = you.cash + you.bank;
  if (isPoker(spec.game)) {
    const [lo, hi] = spec.buyIn ?? [spec.stakes[1] * 40, spec.stakes[1] * 100];
    const top = Math.max(lo, Math.min(hi, can));
    if (!tableUi.buyIn || tableUi.buyIn < lo || tableUi.buyIn > top) tableUi.buyIn = Math.min(top, Math.max(lo, Math.round((lo + hi) / 2 / lo) * lo));
    const want = tableUi.buyIn;
    return {
      ...base,
      groups: [{ name: `Buy-in · ${$(lo)} to ${$(hi)}`, btns: [], size: true, slider: { min: lo, max: Math.max(lo, top), step: Math.max(1, Math.round(lo / 10)), value: want, label: (v) => $(v), set: (v) => { tableUi.buyIn = v; } } }],
      primary: { text: 'Sit down', price: $(want), off: can < want, act: () => send({ op: 'sit', table: spot.id, n: tableUi.buyIn }), key: 'Enter' },
    };
  }
  return { ...base, groups: [], primary: { text: spec.prop === 'slots' ? 'Play this machine' : 'Take a seat', act: () => send({ op: 'sit', table: spot.id }) } };
}

/** At the table. */
export function tableScreen(spot: TableSpot, v: TableView, you: YouState, send: TableSend, a: Act): TableScreen {
  const base = { title: spot.name, sub: stakesOf(spot), you, send, a, spot, v };
  if (v.poker) return pokerScreen(base);
  if (v.roulette) return rouletteScreen(base);
  if (v.craps) return crapsScreen(base);
  if (v.bj) return bjScreen(base);
  if (v.slots) return slotsScreen(base);
  if (v.faro) return faroScreen(base);
  return diceScreen(base);
}

/** What each game's screen is built from. */
export interface ScreenIn { title: string; sub: string; you: YouState; send: TableSend; a: Act; spot: TableSpot; v: TableView }
