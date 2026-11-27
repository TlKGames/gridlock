// The craps table on the table screen (hud/tableRoom.ts): the layout drawn as a casino's is (the
// place numbers with the puck, come, field, don't pass bar, pass line, and the centre box of
// hardways and one-roll bets), every part clickable to bet your chip, your chips on their spots;
// and the side's buttons for the same bets, odds and taking bets down. Games: shared/games/craps.ts.
import type { TableView, YouState } from '../../shared/protocol';
import { cashLine, chipGroup, chipOf, type ScreenIn, type TableScreen, type TBtn, type TGroup } from './cardTable';
import { type Act, esc, money as $, type TableSend } from './tableFelt';

type View = NonNullable<TableView['craps']>;
type Bet = View['bets'][number];
const NUMS = [4, 5, 6, 8, 9, 10];
const WORD: Record<number, string> = { 6: 'SIX', 9: 'NINE' };
const PROPS: [string, string, string][] = [['any7', 'Any 7', '4 to 1'], ['anycraps', 'Any craps', '7 to 1'], ['aces', '2', '30 to 1'], ['acedeuce', '3', '15 to 1'], ['yo', '11', '15 to 1'], ['twelve', '12', '30 to 1']];
const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const ODDS_MAX: Record<number, number> = { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };
const LAY: Record<number, number> = { 4: 2, 10: 2, 5: 1.5, 9: 1.5, 6: 1.2, 8: 1.2 };

const chipsOf = (bets: Bet[], f: (b: Bet) => boolean) => bets.filter(f);
const stack = (bs: Bet[], tag = '') => bs.map(([, , amt, odds]) => `<span class="cchip">${tag}${$(amt)}${odds ? `<em>+${$(odds)}</em>` : ''}</span>`).join('');
const die = (n: number) => `<span class="tdie">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n - 1].includes(i) ? 'on' : ''}"></i>`).join('')}</span>`;

function crapsFelt(c: View, a: Act, bet: number, send: TableSend): string {
  const b = c.bets;
  const put = (s: string, m?: number) => a(() => send({ op: 'bet', n: bet, s, ...(m !== undefined ? { m } : {}) }));
  const line = (kind: 'pass' | 'dont') => (c.point ? a(() => { const t = b.find(([k, n]) => k === kind && n); if (t) send({ op: 'odds', s: kind, n: bet * (kind === 'dont' ? 2 : 1), m: t[1] }); }) : put(kind));
  const numbers = NUMS.map((n) => `<button class="cnum${c.point === n ? ' point' : ''}" ${put('place', n)}>
    ${c.point === n ? '<i class="cpuck on">ON</i>' : ''}<span class="cword">${WORD[n] ?? n}</span>
    ${stack(chipsOf(b, ([k, m]) => k === 'place' && m === n), 'P ')}${stack(chipsOf(b, ([k, m]) => k === 'come' && m === n), 'C ')}${stack(chipsOf(b, ([k, m]) => k === 'dontcome' && m === n), 'DC ')}</button>`).join('');
  const hard = [6, 10, 8, 4].map((n) => `<button class="cprop" ${put('hard', n)}><span>${die(n / 2)}${die(n / 2)}</span><em>${n === 4 || n === 10 ? '7' : '9'} to 1</em>${stack(chipsOf(b, ([k, m]) => k === 'hard' && m === n))}</button>`).join('');
  const props = PROPS.map(([k, label, pays]) => `<button class="cprop${k === 'any7' || k === 'anycraps' ? ' wide' : ''}" ${put(k)}><span>${label}</span><em>${pays}</em>${stack(chipsOf(b, ([kk]) => kk === k))}</button>`).join('');
  const roll = c.last ? `${die(c.last[0])}${die(c.last[1])}` : '';
  return `<div class="felt crapsfelt">
    <div class="ctop"><div class="cdice">${roll}</div><div class="tsaid">${esc(c.said)}</div>
      <div class="dhist">${c.history.slice(1, 12).map((s) => `<span class="dh${s === 7 ? ' seven' : ''}">${s}</span>`).join('')}</div>${c.point ? '' : '<i class="cpuck">OFF</i>'}</div>
    <div class="clayout"><div class="cmain">
      <div class="cnums"><button class="cdc" ${put('dontcome')}>DON'T<br>COME<br>BAR ⚅⚅${stack(chipsOf(b, ([k, n]) => k === 'dontcome' && !n))}</button>${numbers}</div>
      <button class="cband come" ${put('come')}>COME${stack(chipsOf(b, ([k, n]) => k === 'come' && !n))}</button>
      <button class="cband field" ${put('field')}><span>FIELD</span><span class="cfield"><b>2</b><i>pays double</i> · 3 · 4 · 9 · 10 · 11 · <b>12</b><i>pays triple</i></span>${stack(chipsOf(b, ([k]) => k === 'field'))}</button>
      <button class="cband dont" ${line('dont')}>DON'T PASS BAR ⚅⚅${stack(chipsOf(b, ([k]) => k === 'dont'))}</button>
      <button class="cband pass" ${line('pass')}>PASS LINE${stack(chipsOf(b, ([k]) => k === 'pass'))}</button>
    </div><div class="cbox"><div class="cbox-h">Hardways</div><div class="chard">${hard}</div><div class="cbox-h">One roll</div><div class="cprops">${props}</div></div></div>
    <div class="felt-note">Click the layout to bet ${$(bet)}${c.point ? ' · the line takes odds' : ''}</div></div>`;
}

export function crapsScreen(i: ScreenIn): TableScreen {
  const { v, you, send, a } = i;
  const c = v.craps!;
  const [lo, hi] = v.stakes;
  const bet = chipOf(lo, hi);
  const g = crapsGroups(c, you, bet, send);
  return { title: i.title, sub: i.sub, money: cashLine(you), cash: you.cash, log: v.log, felt: crapsFelt(c, a, bet, send), groups: [chipGroup(lo, hi), ...g.groups], primary: g.primary };
}

function crapsGroups(c: View, you: YouState, bet: number, send: TableSend): { groups: TGroup[]; primary: TBtn } {
  const can = you.cash + you.bank;
  const b = c.bets;
  const on = (s: string, text: string, sub?: string, m?: number): TBtn => ({ text, ...(sub ? { sub } : {}), off: can < bet, act: () => send({ op: 'bet', n: bet, s, ...(m !== undefined ? { m } : {}) }) });
  const groups: TGroup[] = [];
  groups.push(c.point
    ? { name: 'Come bets', btns: [on('come', 'Come', 'Even money'), on('dontcome', 'Don\'t come', 'Even money')] }
    : { name: 'The line', btns: [on('pass', 'Pass line', 'Even money'), on('dont', 'Don\'t pass', 'Even money')] });
  // Odds behind each bet on a number: as much as it can take.
  const odds: TBtn[] = b.filter(([k, n]) => n && ['pass', 'come', 'dont', 'dontcome'].includes(k)).map(([k, n, amt, have]) => {
    const dont = k === 'dont' || k === 'dontcome';
    const max = dont ? Math.ceil(amt * 6 * LAY[n]) : amt * ODDS_MAX[n];
    const room = Math.max(0, max - have);
    const name = { pass: 'Pass', come: 'Come', dont: 'Don\'t pass', dontcome: 'Don\'t come' }[k as 'pass'];
    return { text: `${dont ? 'Lay' : 'Odds'} · ${name} ${n}`, sub: room ? `Up to ${$(room)}` : 'Full odds', off: !room || can < Math.min(room, bet), act: () => send({ op: 'odds', s: k, m: n, n: Math.min(room, can) }) };
  });
  if (odds.length) groups.push({ name: 'Odds · true odds, no house edge', btns: odds });
  groups.push({ name: 'Place bets · 9:5, 7:5, 7:6', chips: true, btns: NUMS.map((n) => on('place', String(n), undefined, n)) });
  groups.push({ name: 'Hardways · stay up till a 7', chips: true, btns: [4, 6, 8, 10].map((n) => on('hard', `Hard ${n}`, undefined, n)) });
  groups.push({ name: 'One roll', btns: [on('field', 'Field', '2 double, 12 triple'), ...PROPS.map(([k, label, pays]) => on(k, label.length < 3 ? `Just ${label}` : label, pays))] });
  const down: TBtn[] = [
    ...b.filter(([k]) => k === 'place' || k === 'hard').map(([k, n, amt]) => ({ text: `${k === 'place' ? 'Place' : 'Hard'} ${n}`, sub: $(amt), act: () => send({ op: 'down', s: k, m: n }) })),
    ...b.filter(([, , , o]) => o).map(([k, n, , o]) => ({ text: `Odds on ${n}`, sub: $(o), act: () => send({ op: 'down', s: `odds-${k}`, m: n }) })),
  ];
  if (down.length) groups.push({ name: 'Take down', btns: down });
  const onTable = b.reduce((s, [, , amt, o]) => s + amt + o, 0);
  return { groups, primary: { text: 'Roll the dice', ...(onTable ? { price: `${$(onTable)} down` } : {}), off: !b.length, act: () => send({ op: 'roll' }), key: 'Space', tone: 'go' } };
}
