// What every table screen draws with: playing cards (dealt in with a flick the first time they
// show), chips, money, the empty table before you sit. Each game draws its own felt (pokerTable.ts,
// rouletteTable.ts, houseTables.ts, crapsTable.ts); `a(fn)` gives an element the attribute that runs
// fn when it's clicked (hud/tableRoom.ts).
import { TABLES } from '../../shared/packs';
import { cardText, isRed } from '../../shared/games/cards';
import type { TableSpot } from '../../shared/world/tables';

export type Act = (fn: () => void) => string;
export type TableSend = (m: { op: string; table?: number; n?: number; m?: number; k?: number[]; s?: string; bets?: [string, number, number][] }) => void;

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Cards already on show, by where they lie: a card's first drawing deals it in, later ones don't. */
const shown = new Set<string>();
export const forgetCards = () => shown.clear();

/** A playing card: rank in the corner, the suit large. -1 is face down. `at` names its place on the
 *  table (seat and slot) so it's dealt in once. */
export function pc(c: number, cls = '', attr = '', at = ''): string {
  let deal = '';
  if (at) { const key = `${at}:${c}`; if (!shown.has(key)) { shown.add(key); deal = ' deal'; } }
  if (c < 0) return `<span class="pc back ${cls}${deal}"${attr}></span>`;
  const t = cardText(c), suit = t.slice(-1), rank = t.slice(0, -1);
  return `<span class="pc${isRed(c) ? ' red' : ''} ${cls}${deal}"${attr}><b>${rank}</b><i>${suit}</i><s>${suit}</s></span>`;
}
export const hand = (cs: number[], cls = '', at = '') => `<span class="pcs">${cs.map((c, i) => pc(c, cls, '', at ? `${at}${i}` : '')).join('')}</span>`;

/** A stack of chips with its amount (colour by size, as casino chips go). */
export function chip(n: number, cls = ''): string {
  const tone = n >= 5000 ? 'k5' : n >= 1000 ? 'k1' : n >= 500 ? 'c5' : n >= 100 ? 'c1' : n >= 25 ? 'q' : n >= 5 ? 'f' : 'w';
  return `<span class="tchip ${tone} ${cls}">${money(n)}</span>`;
}

/** Before you sit: the empty table with its game and stakes lettered on the felt. */
export function joinFelt(spot: TableSpot, stakes: string, note: string): string {
  const spec = TABLES[spot.spec];
  return `<div class="felt ${spec.prop === 'slots' ? 'machine' : 'oval'}"><div class="felt-word">${esc(spec.name)}</div><div class="felt-line">${esc(stakes)}</div><div class="felt-note at">${esc(note)}</div></div>`;
}

/** A countdown ring (CSS-animated from where it stands now): someone thinking, the next deal. */
export function clockRing(left: number, total: number): string {
  return `<svg class="tclock" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" style="animation-duration:${total.toFixed(2)}s;animation-delay:-${Math.max(0, total - left).toFixed(2)}s"/></svg>`;
}
