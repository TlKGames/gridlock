// The house games on the table screen, done the way online casinos do them. Blackjack: chips click
// into the bet circle (Clear, Rebet, Double), Deal; then Hit / Stand / Double / Split along the foot
// (H, S, D, P), soft totals shown as "7 / 17", each hand's outcome on the felt. Slots: a bet per
// pull, the reels spinning and stopping left to right, auto-spin (stops on a big win). Faro: click a
// card on the layout to stake it, the casekeeper counting what's out. Hazard: call your main, cast.
import type { TableView } from '../../shared/protocol';
import { SLOT_PAYS, SLOT_SYMBOLS } from '../../shared/games/house';
import { cashLine, chipGroup, chipOf, chipValues, type ScreenIn, type TableScreen, tableUi, type TBtn } from './cardTable';
import { chip, esc, forgetCards, hand, money as $, pc } from './tableFelt';

// ---- Blackjack ---------------------------------------------------------------------------------

/** A hand's total, and whether an ace in it still counts eleven ("7 / 17"). */
function bjTotal(cards: number[]): { hard: number; soft: number | null } {
  let t = 0, aces = 0;
  for (const c of cards) { if (c < 0) continue; const r = c % 13; t += r === 12 ? 11 : r >= 8 ? 10 : r + 2; if (r === 12) aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { hard: aces ? t - 10 : t, soft: aces && t <= 21 ? t : null };
}
const showTotal = (cards: number[]) => { const { hard, soft } = bjTotal(cards); return soft !== null && soft !== hard ? `${hard} / ${soft}` : String(soft ?? hard); };
let bjKey = '';

export function bjScreen(i: ScreenIn): TableScreen {
  const { v, you, send } = i;
  const b = v.bj!;
  const [lo, hi] = v.stakes;
  const can = you.cash + you.bank;
  const key = `${b.dealer[1]}:${b.hands.map((h) => h.cards.slice(0, 2).join(',')).join('|')}`;
  if (b.phase === 'play' && key !== bjKey) { bjKey = key; forgetCards(); }
  let bar: TBtn[] | undefined, primary: TBtn | undefined;
  const groups = [];
  if (b.phase === 'play') {
    const h = b.hands[b.active];
    const two = h?.cards.length === 2;
    const val = (c: number) => Math.min(10, (c % 13) + 2);
    bar = [
      { text: 'Hit', act: () => send({ op: 'hit' }), key: 'KeyH', tone: 'call' },
      { text: 'Stand', act: () => send({ op: 'stand' }), key: 'KeyS', tone: 'fold' },
      ...(two ? [{ text: 'Double', price: $(h.bet), off: can < h.bet, act: () => send({ op: 'double' }), key: 'KeyD', tone: 'raise' as const }] : []),
      ...(two && v.game === 'blackjack' && b.hands.length === 1 && val(h.cards[0]) === val(h.cards[1]) ? [{ text: 'Split', price: $(h.bet), off: can < h.bet, act: () => send({ op: 'split' }), key: 'KeyP', tone: 'raise' as const }] : []),
    ];
  } else {
    const add = (x: number) => () => { tableUi.bjBet = Math.min(hi, tableUi.bjBet + x); };
    groups.push({ name: tableUi.bjBet ? `In the circle · ${$(tableUi.bjBet)}` : 'Click chips into the circle', chips: true,
      btns: chipValues(lo, hi).map((x) => ({ text: `+${$(x)}`, off: tableUi.bjBet + x > hi, act: add(x) })) });
    groups.push({ name: 'Bet', chips: true, btns: [
      { text: 'Clear', off: !tableUi.bjBet, act: () => { tableUi.bjBet = 0; }, key: 'KeyX' },
      { text: 'Rebet', off: !tableUi.bjLast, act: () => { tableUi.bjBet = tableUi.bjLast; }, key: 'KeyR' },
      { text: 'Double', off: !tableUi.bjBet || tableUi.bjBet * 2 > hi, act: () => { tableUi.bjBet *= 2; } },
    ] });
    const amount = tableUi.bjBet || tableUi.bjLast;
    primary = { text: tableUi.bjBet ? 'Deal' : tableUi.bjLast ? 'Rebet and deal' : 'Deal', price: amount ? $(amount) : undefined,
      off: amount < lo || can < amount, act: () => { tableUi.bjLast = amount; tableUi.bjBet = 0; send({ op: 'deal', n: amount }); }, key: 'Space', tone: 'go' };
  }
  return { title: i.title, sub: `${i.sub} · ${v.game === 'blackjack' ? 'blackjack pays 3 to 2, six decks' : 'one deck, no splitting'}`, money: cashLine(you), cash: you.cash, log: v.log, felt: bjFelt(v), groups, bar, primary,
    ...(b.phase === 'play' ? { leaveWarn: 'Leave mid-hand? Your bet\'s lost' } : {}) };
}

function bjFelt(v: TableView): string {
  const b = v.bj!;
  const dealer = `<div class="tdealer"><div class="tname">Dealer${b.dealer.length ? ` · ${b.phase === 'play' ? showTotal(b.dealer) : b.dealerTotal}` : ''}</div>${hand(b.dealer, '', 'd')}</div>`;
  const hands = b.hands.map((h, k) => {
    const out = b.outcome[k] ?? (b.hands.length === 1 ? b.outcome.join(' ') : '');
    const tone = /win|blackjack/i.test(out) ? 'good' : /push/i.test(out) ? '' : out ? 'bad' : '';
    return `<div class="thand${k === b.active && b.phase === 'play' ? ' acting' : ''}">${hand(h.cards, 'big', `h${k}:`)}
      <div class="tname">${b.hands.length > 1 ? `Hand ${k + 1} · ` : ''}${h.cards.length ? showTotal(h.cards) : ''}</div>
      <div class="tcircle">${chip(h.bet)}</div>${out && b.phase !== 'play' ? `<div class="tout ${tone}">${esc(out)}</div>` : ''}</div>`;
  }).join('');
  // Before the first deal: the empty circle with whatever chips you've put in it.
  const dealt = b.hands.some((h) => h.cards.length);
  const circle = dealt ? `<div class="thands">${hands}</div>` : `<div class="thands"><div class="thand"><div class="tcircle empty">${tableUi.bjBet ? chip(tableUi.bjBet) : ''}</div></div></div>`;
  return `<div class="felt half"><div class="felt-arc">${v.game === 'blackjack' ? 'Blackjack pays 3 to 2' : 'Twenty-one'}</div>${dealer}${circle}</div>`;
}

// ---- Slots --------------------------------------------------------------------------------------

export function slotsScreen(i: ScreenIn): TableScreen {
  const { v, you, send } = i;
  const s = v.slots!;
  const [lo, hi] = v.stakes;
  const bet = chipOf(lo, hi);
  const can = you.cash + you.bank;
  if (s.reels && s.reels !== tableUi.lastReels) { tableUi.lastReels = s.reels; tableUi.spunAt = performance.now(); }
  const pull = () => { tableUi.lastPull = performance.now(); send({ op: 'pull', n: bet }); };
  const autoOn = tableUi.autoSpins > 0;
  return {
    title: i.title, sub: i.sub, money: cashLine(you), cash: you.cash, log: v.log, felt: slotsFelt(s, bet),
    groups: [
      chipGroup(lo, hi, 'Bet a pull'),
      { name: autoOn ? `Auto-spin · ${tableUi.autoSpins} left` : 'Auto-spin (stops on a big win)', chips: true, btns: autoOn
        ? [{ text: 'Stop', act: () => { tableUi.autoSpins = 0; }, key: 'KeyX' }]
        : [10, 25, 50].map((n) => ({ text: `${n}`, off: can < bet, act: () => { tableUi.autoSpins = n; tableUi.lastPull = 0; } })) },
    ],
    primary: { text: autoOn ? 'Spinning…' : 'Pull', price: $(bet), off: autoOn || can < bet, act: pull, key: 'Space', tone: 'go' },
    tick: () => {
      if (tableUi.autoSpins <= 0) return;
      // A big win stops it, as the machines do; so does running dry.
      if (s.won >= bet * 20 && performance.now() - tableUi.spunAt < 1500) { tableUi.autoSpins = 0; return; }
      if (performance.now() - tableUi.lastPull < 1500) return;
      if (can < bet) { tableUi.autoSpins = 0; return; }
      tableUi.autoSpins--;
      pull();
    },
  };
}

function slotsFelt(s: NonNullable<TableView['slots']>, bet: number): string {
  // The reels stop one after another, left to right (the screen redraws as each lands).
  const since = performance.now() - tableUi.spunAt;
  const spinning = since < 1100;
  const reels = (s.reels ?? [6, 6, 6]).map((r, k) => `<span class="treel${SLOT_SYMBOLS[r].length > 2 ? ' word' : ''}${since < 450 + k * 300 ? ' spin' : ''}"><b>${SLOT_SYMBOLS[r]}</b></span>`).join('');
  const big = s.won >= bet * 10;
  const win = s.won ? `<div class="twon on${big ? ' big' : ''}">${big ? 'Big win ' : 'Win '}${$(s.won)}</div>` : `<div class="twon">${s.reels ? 'No win' : 'Pull to play'}</div>`;
  return `<div class="felt machine"><div class="tmachine"><div class="treels">${reels}<i class="tline"></i></div>${spinning ? '<div class="twon">&nbsp;</div>' : win}</div>
    <div class="tpay">${SLOT_PAYS.map((k, i) => `<span>${SLOT_SYMBOLS[i]} ${SLOT_SYMBOLS[i]} ${SLOT_SYMBOLS[i]} <b>${k}×</b></span>`).reverse().join('')}<span>${SLOT_SYMBOLS[0]} ${SLOT_SYMBOLS[0]} <b>2×</b></span></div></div>`;
}

// ---- Faro ---------------------------------------------------------------------------------------

export function faroScreen(i: ScreenIn): TableScreen {
  const { v, you, send, a } = i;
  const f = v.faro!;
  const [lo, hi] = v.stakes;
  const bet = chipOf(lo, hi);
  const on = new Map(f.bets);
  const stake = (r: number) => () => send({ op: 'bet', n: bet, m: r });
  // The layout: the spade suit in two rows round the dealer's box, as it was enamelled on the board;
  // under each card the casekeeper's beads, one for each of its rank that's come out.
  const tile = (r: number) => `<button class="frank${on.has(r) ? ' staked' : ''}" ${a(stake(r))}>${pc(r, 'sm')}${on.has(r) ? chip(on.get(r)!) : ''}
    <span class="fcase">${Array.from({ length: 4 }, (_, k) => `<i class="${k < f.dealt[r] ? 'out' : ''}"></i>`).join('')}</span></button>`;
  const top = [5, 4, 3, 2, 1, 0].map(tile).join(''), bottom = [7, 8, 9, 10, 11, 12].map(tile).join('');
  const box = `<div class="fbox"><div class="tname">The box · ${f.left} left</div>${f.turn ? `<div class="fturn"><span><em>Loses</em>${pc(f.turn[0], '', '', `t0:${f.left}`)}</span><span><em>Wins</em>${pc(f.turn[1], '', '', `t1:${f.left}`)}</span></div>` : '<div class="felt-note">No turn yet</div>'}<div class="tsaid">${esc(f.said)}</div></div>`;
  const staked = f.bets.reduce((t, [, x]) => t + x, 0);
  return {
    title: i.title, sub: i.sub, money: cashLine(you), cash: you.cash, log: v.log,
    felt: `<div class="felt faro"><div class="frow">${top}</div><div class="fmid">${tile(6)}${box}</div><div class="frow">${bottom}</div><div class="felt-note">Click a card to stake ${$(bet)} on its rank</div></div>`,
    groups: [chipGroup(lo, hi)],
    primary: { text: 'Deal a turn', price: staked ? `${$(staked)} down` : undefined, act: () => send({ op: 'turn' }), key: 'Space', tone: 'go' },
  };
}

// ---- Hazard -------------------------------------------------------------------------------------

const PIPS = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
export const die = (n: number) => `<span class="tdie">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n - 1].includes(i) ? 'on' : ''}"></i>`).join('')}</span>`;

export function diceScreen(i: ScreenIn): TableScreen {
  const { v, you, send } = i;
  const d = v.dice!;
  const [lo, hi] = v.stakes;
  const bet = chipOf(lo, hi);
  const can = you.cash + you.bank;
  const hist = d.history.slice(0, 12).map((s) => `<span class="dh">${s}</span>`).join('');
  const felt = `<div class="felt dicefelt hazard"><div class="felt-arc">Hazard</div><div class="hboard"><span><em>Main</em>${d.bet ? d.main : tableUi.main}</span><span><em>Chance</em>${d.point || '—'}</span></div>
    <div class="tdice">${d.last ? die(d.last[0]) + die(d.last[1]) : ''}</div><div class="tsaid">${esc(d.said || 'Call your main and cast.')}</div>
    <div class="dhist">${hist}</div></div>`;
  const groups = d.bet ? [] : [chipGroup(lo, hi), { name: 'Your main', chips: true, btns: [5, 6, 7, 8, 9].map((m) => ({ text: String(m), on: tableUi.main === m, act: () => { tableUi.main = m; } })) }];
  const primary: TBtn = d.bet
    ? { text: 'Throw again', price: `${$(d.bet)} down`, act: () => send({ op: 'roll' }), key: 'Space', tone: 'go' }
    : { text: `Cast · main ${tableUi.main}`, price: $(bet), off: can < bet, act: () => { send({ op: 'bet', n: bet, m: tableUi.main }); send({ op: 'roll' }); }, key: 'Space', tone: 'go' };
  return { title: i.title, sub: i.sub, money: cashLine(you), cash: you.cash, log: v.log, felt, groups, primary };
}
