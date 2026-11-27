// Roulette on the table screen, as online tables run it: pick a chip, click the layout as many times
// and places as you like (straight up on a number, the dozens, the columns, the even-money bets),
// your chips stacked where they lie; Undo, Clear, Rebet (the last spin's chips) and Double; then
// Spin, every chip riding the one ball. The last numbers run along the top; the ball's number is
// marked on the layout and every bet it paid lit. Keys: Space or Enter spins, U undo, X clear, R rebet.
import { ROULETTE_REDS, rouletteName } from '../../shared/games/house';
import { cashLine, chipGroup, chipOf, type ScreenIn, type TableScreen, tableUi } from './cardTable';
import type { TableView } from '../../shared/protocol';
import { type Act, chip, money as $ } from './tableFelt';

const colour = (n: number) => (n === 0 || n === 37 ? 'green' : ROULETTE_REDS.has(n) ? 'red' : 'black');
const OUTSIDE: [string, string, string][] = [['low', '1–18', ''], ['even', 'Even', ''], ['red', '', 'red'], ['black', '', 'black'], ['odd', 'Odd', ''], ['high', '19–36', '']];

export function rouletteScreen(i: ScreenIn): TableScreen {
  const { v, you, send, a } = i;
  const r = v.roulette!;
  const [lo, hi] = v.stakes;
  const bet = chipOf(lo, hi);
  const total = [...tableUi.rBets.values()].reduce((t, x) => t + x, 0);
  const can = you.cash + you.bank;
  const put = (key: string) => () => {
    const now = tableUi.rBets.get(key) ?? 0;
    if (now + bet > hi) return;
    tableUi.rBets.set(key, now + bet);
    tableUi.rUndo.push([key, bet]);
  };
  const undo = () => { const last = tableUi.rUndo.pop(); if (!last) return; const left = (tableUi.rBets.get(last[0]) ?? 0) - last[1]; if (left > 0) tableUi.rBets.set(last[0], left); else tableUi.rBets.delete(last[0]); };
  const clear = () => { tableUi.rBets.clear(); tableUi.rUndo = []; };
  const rebet = () => { clear(); for (const [k, x] of tableUi.rLast) { tableUi.rBets.set(k, x); tableUi.rUndo.push([k, x]); } };
  const double = () => { for (const [k, x] of [...tableUi.rBets]) { const d = Math.min(hi, x * 2); tableUi.rBets.set(k, d); tableUi.rUndo.push([k, d - x]); } };
  const spin = () => {
    if (!tableUi.rBets.size) { if (tableUi.rLast.size) rebet(); else return; }
    const bets = [...tableUi.rBets].map(([k, x]): [string, number, number] => { const [kind, num] = k.split(':'); return [kind, Number(num ?? 0), x]; });
    tableUi.rLast = new Map(tableUi.rBets);
    clear();
    send({ op: 'spin', bets });
  };
  const doubled = [...tableUi.rBets.values()].every((x) => x * 2 <= hi) ? total : 0;
  return {
    title: i.title, sub: `${i.sub} on each bet · American wheel, 0 and 00`, money: cashLine(you), cash: you.cash, log: v.log,
    felt: felt(r, a, put),
    groups: [
      chipGroup(lo, hi),
      { name: total ? `On the layout · ${$(total)}` : 'Click the layout to bet your chip', chips: true, btns: [
        { text: 'Undo', off: !tableUi.rUndo.length, act: undo, key: 'KeyU' },
        { text: 'Clear', off: !tableUi.rBets.size, act: clear, key: 'KeyX' },
        { text: 'Rebet', off: !tableUi.rLast.size, act: rebet, key: 'KeyR' },
        { text: 'Double', off: !tableUi.rBets.size || !doubled || can < total * 2, act: double },
      ] },
    ],
    primary: { text: tableUi.rBets.size ? 'Spin' : tableUi.rLast.size ? 'Rebet and spin' : 'Spin', price: $(total || [...tableUi.rLast.values()].reduce((t, x) => t + x, 0)),
      off: (!tableUi.rBets.size && !tableUi.rLast.size) || can < (total || [...tableUi.rLast.values()].reduce((t, x) => t + x, 0)), act: spin, key: 'Space', tone: 'go' },
  };
}

function felt(r: NonNullable<TableView['roulette']>, a: Act, put: (k: string) => () => void): string {
  const last = r.last;
  const paid = new Set(r.bets.filter(([, , , back]) => back > 0).map(([k, n]) => (k === 'number' ? `number:${n}` : k)));
  const here = (key: string) => {
    const amt = tableUi.rBets.get(key);
    return amt ? chip(amt, 'on') : '';
  };
  const lit = (key: string) => (last >= 0 && paid.has(key) ? ' paid' : '');
  const num = (n: number) => {
    const key = `number:${n}`;
    return `<button class="rc ${colour(n)}${n === last ? ' hit' : ''}${lit(key)}" ${a(put(key))}>${n === last ? '<i class="dolly"></i>' : ''}<span>${rouletteName(n)}</span>${here(key)}</button>`;
  };
  const cell = (key: string, label: string, cls = '') => `<button class="ro ${cls}${lit(key)}" ${a(put(key))}><span>${label}</span>${here(key)}</button>`;
  // Three rows of twelve (3, 6...36 along the top), each ending in its column bet.
  const rows = [3, 2, 1].map((row) => Array.from({ length: 12 }, (_, c) => num(c * 3 + row)).join('') + cell(`col${row}`, '2 to 1', 'col')).join('');
  const ball = last >= 0 ? `<span class="rball ${colour(last)}">${rouletteName(last)}</span>` : '<span class="rball">—</span>';
  const hist = r.history.slice(1, 16).map((n) => `<span class="rh ${colour(n)}">${rouletteName(n)}</span>`).join('');
  const won = r.bets.reduce((t, [, , , back]) => t + back, 0), staked = r.bets.reduce((t, [, , amt]) => t + amt, 0);
  const result = last >= 0 && r.bets.length ? `<span class="rres ${won > staked ? 'good' : ''}">${won > staked ? `Win ${$(won - staked)}` : won ? `Back ${$(won)}` : `Lost ${$(staked)}`}</span>` : '';
  return `<div class="felt roulette"><div class="rtop">${ball}<span class="rhist">${hist}</span>${result}</div>
    <div class="rgrid"><div class="rzero">${num(0)}${num(37)}</div><div class="rnums">${rows}</div></div>
    <div class="rdoz">${cell('dozen1', '1st 12')}${cell('dozen2', '2nd 12')}${cell('dozen3', '3rd 12')}</div>
    <div class="routs">${OUTSIDE.map(([k, label, cls]) => cell(k, label, cls)).join('')}</div></div>`;
}
