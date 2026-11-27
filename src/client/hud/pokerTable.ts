// A poker table on the table screen, the way online poker lays one out: everyone round an oval with
// their stack, what they last did and a clock on whoever's thinking; the dealer button; bets in
// front of them; the board, the pot and any side pots in the middle; your cards big at the bottom
// with what you're holding spelled out; the winners lit up at the showdown. The side: a bet slider
// with Min / ½ pot / ¾ pot / Pot / All-in, then Fold / Check-Call / Raise along the foot; while you
// wait, boxes to tick for what to do when it comes round (Check/Fold, Check, Call any); between
// hands, topping your chips up. Keys: F fold, C check or call, R bet or raise.
import { RULES, TABLES } from '../../shared/packs';
import type { TableView } from '../../shared/protocol';
import { bestScore, cardText } from '../../shared/games/cards';
import { cashLine, type ScreenIn, type TableScreen, tableUi, type TBtn, type TGroup } from './cardTable';
import { type Act, clockRing, esc, forgetCards, hand, money as $, pc, type TableSend } from './tableFelt';

type Poker = NonNullable<TableView['poker']>;
const SINGLE = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

/** What a hand is, said the way a dealer says it ("Two pair, Kings and Sevens"). */
export function describe(cards: number[]): string {
  const known = cards.filter((c) => c >= 0);
  if (known.length < 2) return '';
  const s = bestScore(known), cat = Math.floor(s / 13 ** 5), r1 = Math.floor(s / 13 ** 4) % 13, r2 = Math.floor(s / 13 ** 3) % 13;
  switch (cat) {
    case 1: return `Pair of ${PLURAL[r1]}`;
    case 2: return `Two pair, ${PLURAL[r1]} and ${PLURAL[r2]}`;
    case 3: return `Three ${PLURAL[r1]}`;
    case 4: return `Straight, ${SINGLE[r1]} high`;
    case 5: return `Flush, ${SINGLE[r1]} high`;
    case 6: return `Full house, ${PLURAL[r1]} full of ${PLURAL[r2]}`;
    case 7: return `Four ${PLURAL[r1]}`;
    case 8: return r1 === 12 ? 'Royal flush' : `Straight flush, ${SINGLE[r1]} high`;
    default: return `${SINGLE[r1]} high`;
  }
}

/** The hand you're in (the dealer seat and the cards: a new hand starts a new count of cards dealt). */
let handKey = '';

/** Acting for you when it comes round, as you ticked (called on each new view of the table). */
export function autoAct(v: TableView, send: TableSend): void {
  const p = v.poker;
  if (!p) return;
  if (p.between) { tableUi.pre = ''; return; }
  if (!p.yourTurn || !tableUi.pre || p.street === 'draw') return;
  const pre = tableUi.pre;
  tableUi.pre = '';
  if (pre === 'fold') send({ op: 'fold' });
  else if (pre === 'checkfold') send({ op: p.toCall ? 'fold' : 'check' });
  else if (pre === 'check') { if (!p.toCall) send({ op: 'check' }); }
  else if (pre === 'callany') send({ op: p.toCall ? 'call' : 'check' });
  else if (pre === 'call' && p.toCall === tableUi.preCall) send({ op: 'call' });
}

export function pokerScreen(i: ScreenIn): TableScreen {
  const { v, you, send, a } = i;
  const p = v.poker!;
  const spec = TABLES[i.spot.spec];
  const key = `${p.dealer}:${p.seats[0].cards.join(',')}`;
  if (key !== handKey && p.street !== 'show') { handKey = key; forgetCards(); tableUi.discard.clear(); }
  const groups: TGroup[] = [];
  let bar: TBtn[] | undefined, primary: TBtn | undefined;
  const me = p.seats[0];
  const inHand = !me.folded && !me.out && !p.between;
  if (p.yourTurn && p.street === 'draw') {
    groups.push({ name: 'Click the cards to throw in (three at most; four behind an ace)', chips: true, btns: me.cards.map((c, k) => ({ text: cardText(c), on: tableUi.discard.has(k), act: () => toggle(k) })) });
    primary = { text: tableUi.discard.size ? `Draw ${tableUi.discard.size}` : 'Stand pat', act: () => { send({ op: 'draw', k: [...tableUi.discard] }); tableUi.discard.clear(); }, key: 'KeyC', tone: 'go' };
  } else if (p.yourTurn) {
    const canRaise = p.maxTo > p.minTo || (p.maxTo === p.minTo && p.maxTo > me.bet + p.toCall);
    if (canRaise) {
      tableUi.raiseTo = Math.max(p.minTo, Math.min(p.maxTo, tableUi.raiseTo || p.minTo));
      // A pot-sized raise: call first, then raise by what the pot would be after the call.
      const cur = me.bet + p.toCall;
      const sized = (f: number) => Math.max(p.minTo, Math.min(p.maxTo, Math.round(cur + f * (p.pot + p.toCall))));
      const presets: [string, number][] = [['Min', p.minTo], ['½ pot', sized(0.5)], ['¾ pot', sized(0.75)], ['Pot', sized(1)], ['All in', p.maxTo]];
      // Presets over the slider, beside the action buttons (as online tables lay it out).
      groups.push({
        name: p.toCall ? 'Raise to' : 'Bet', size: true, chips: true,
        btns: presets.filter(([, x], k) => presets.findIndex(([, y]) => y === x) === k).map(([t, x]) => ({ text: t, on: tableUi.raiseTo === x, act: () => { tableUi.raiseTo = x; } })),
        slider: { min: p.minTo, max: p.maxTo, step: Math.max(1, p.big), value: tableUi.raiseTo, label: (x) => $(x), set: (x) => { tableUi.raiseTo = Math.round(x); } },
      });
    }
    const allIn = p.toCall >= v.chips;
    bar = [
      { text: 'Fold', act: () => send({ op: 'fold' }), key: 'KeyF', tone: 'fold' },
      p.toCall ? { text: allIn ? 'Call all in' : 'Call', price: $(Math.min(p.toCall, v.chips)), act: () => send({ op: 'call' }), key: 'KeyC', tone: 'call' }
        : { text: 'Check', act: () => send({ op: 'check' }), key: 'KeyC', tone: 'call' },
      ...(canRaise && !allIn ? [{ text: tableUi.raiseTo >= p.maxTo ? 'All in' : p.toCall ? 'Raise to' : 'Bet', price: $(tableUi.raiseTo), act: () => send({ op: 'raise', n: tableUi.raiseTo }), key: 'KeyR', tone: 'raise' as const }] : []),
    ];
  } else if (inHand) {
    // Waiting your turn: what to do when it comes (cleared if the bet changes under a "Call").
    if (tableUi.pre === 'call' && tableUi.preCall !== callNow(p)) tableUi.pre = '';
    if (tableUi.pre === 'check' && callNow(p) > 0) tableUi.pre = '';
    const c = callNow(p);
    const pick = (k: typeof tableUi.pre) => () => { tableUi.pre = tableUi.pre === k ? '' : k; tableUi.preCall = c; };
    groups.push({ name: 'When it comes to you', btns: c
      ? [{ text: 'Fold', on: tableUi.pre === 'fold', act: pick('fold') }, { text: `Call ${$(c)}`, on: tableUi.pre === 'call', act: pick('call') }, { text: 'Call any', on: tableUi.pre === 'callany', act: pick('callany') }]
      : [{ text: 'Check / Fold', on: tableUi.pre === 'checkfold', act: pick('checkfold') }, { text: 'Check', on: tableUi.pre === 'check', act: pick('check') }, { text: 'Call any', on: tableUi.pre === 'callany', act: pick('callany') }] });
  } else if (p.between && v.chips <= 0) {
    const [blo] = spec.buyIn ?? [spec.stakes[1] * 40];
    primary = { text: 'Buy back in', price: $(blo), off: you.cash + you.bank < blo, act: () => send({ op: 'rebuy' }), key: 'Enter', tone: 'go' };
  } else if (p.between && v.chips < p.topTo) {
    // Between hands: more chips, up to the table's most.
    const room = Math.min(p.topTo - v.chips, you.cash + you.bank);
    if (room > 0) {
      tableUi.buyIn = Math.max(1, Math.min(room, tableUi.buyIn || room));
      groups.push({ name: 'Top up your chips', btns: [{ text: 'Add', price: $(tableUi.buyIn), act: () => send({ op: 'topup', n: tableUi.buyIn }) }],
        slider: { min: Math.min(room, p.big), max: room, step: Math.max(1, p.big), value: tableUi.buyIn, label: (x) => $(x), set: (x) => { tableUi.buyIn = x; } } });
    }
  }
  if (v.cheats?.length && RULES.cardCheats) {
    const C: Record<string, string> = { peek: 'Peek at your neighbours', ace: 'Slip in an ace', stack: 'Stack the deck (your deal)' };
    const btns = v.cheats.filter((c) => C[c]).map((c) => ({ text: C[c], act: () => send({ op: 'cheat', s: c }) }));
    if (btns.length) groups.push({ name: 'Cheat · if they see it…', btns });
    if (v.cheats.includes('callout')) {
      const who = p.seats.map((s, k) => ({ s, k })).filter(({ s, k }) => k > 0 && !s.out);
      if (who.length) groups.push({ name: 'Call out a cheat · wrong, and it\'s a gunfight', chips: true, btns: who.map(({ s, k }) => ({ text: s.name, act: () => send({ op: 'callout', n: k }) })) });
    }
  }
  return {
    // (What you're worth at the table: your cash and your chips, so a pot won shows as a win.)
    title: i.title, sub: i.sub, money: cashLine(you, v.chips), felt: felt(v, a), groups, bar, primary, log: v.log, cash: you.cash + v.chips,
    ...(inHand ? { leaveWarn: 'Leave mid-hand? You fold' } : {}),
  };
}

function toggle(k: number): void { if (tableUi.discard.has(k)) tableUi.discard.delete(k); else tableUi.discard.add(k); }
/** What it'd cost you to call right now (the biggest bet out, less yours). */
const callNow = (p: Poker) => Math.max(0, ...p.seats.map((s) => s.bet)) - p.seats[0].bet;

function felt(v: TableView, a: Act): string {
  const p = v.poker!;
  const n = p.seats.length;
  const drawing = p.yourTurn && p.street === 'draw';
  const winners = new Map((p.result ?? []).map((r) => [r.seat, r]));
  const seats = p.seats.map((s, k) => {
    const th = Math.PI / 2 + (k * 2 * Math.PI) / n;
    const x = 50 + 42 * Math.cos(th), y = 50 + 39 * Math.sin(th);
    const bx = 50 + 25 * Math.cos(th), by = 50 + 21 * Math.sin(th);
    // The dealer button: in front of the seat, off to one side of its bet.
    const dx = 50 + 25 * Math.cos(th + 0.5), dy = 50 + 20 * Math.sin(th + 0.5);
    const peek = v.peeked?.find(([seat]) => seat === k)?.[1];
    const shown = peek ?? s.cards;
    const acting = k === p.acting && !p.between;
    const win = winners.get(k);
    const cards = s.folded && k !== 0 ? '' : k === 0 && drawing
      ? `<span class="pcs">${shown.map((c, j) => pc(c, `${tableUi.discard.has(j) ? 'thrown' : ''} pick`, ` ${a(() => toggle(j))}`)).join('')}</span>`
      : hand(shown, k === 0 ? 'big' : 'sm', `s${k}:`);
    const badge = win ? `<i class="tlast win">Wins ${$(win.won)}</i>` : s.last ? `<i class="tlast ${lastTone(s.last)}">${esc(lastText(s.last))}</i>` : '';
    const initial = (k === 0 ? 'You' : s.name).slice(0, 1);
    return `<div class="tseat${k === 0 ? ' you' : ''}${acting ? ' acting' : ''}${s.folded || s.out ? ' dim' : ''}${win ? ' winner' : ''}" style="left:${x}%;top:${y}%">
      <div class="tcards">${cards}</div>
      <div class="tpod"><span class="tav">${esc(initial)}${acting && p.clock ? clockRing(p.clock[0], p.clock[1]) : ''}</span><span class="tid"><b>${esc(k === 0 ? 'You' : s.name)}</b><em>${s.out ? 'Out' : s.allIn ? 'All in' : $(s.stack)}</em></span></div>
      ${badge}${(k === 0 && !s.folded && s.cards.length) || (win && win.hand) ? `<div class="tstrength">${esc(describe([...shown, ...p.board]))}</div>` : ''}
    </div>
    ${s.bet ? `<div class="tbet" style="left:${bx}%;top:${by}%">${chipStack(s.bet)}</div>` : ''}
    ${k === p.dealer ? `<i class="dbtn" style="left:${dx}%;top:${dy}%">D</i>` : ''}`;
  }).join('');
  const board = p.board.length || p.street === 'flop' || v.game === 'holdem'
    ? `<div class="tboard">${Array.from({ length: v.game === 'holdem' ? 5 : 0 }, (_, j) => (p.board[j] !== undefined ? pc(p.board[j], '', '', `b${j}`) : '<span class="pc slot"></span>')).join('')}</div>` : '';
  const potLine = p.pots.length > 1 ? `Main ${$(p.pots[0])} · ${p.pots.slice(1).map((x, j) => `Side${p.pots.length > 2 ? ` ${j + 1}` : ''} ${$(x)}`).join(' · ')}` : p.pot ? `Pot ${$(p.pot)}` : '';
  // At the showdown, who won what with what, under the pot (the hand said in full where it was seen).
  const mine = winners.get(0);
  const said = (r: { seat: number; hand: string }) => (r.hand ? describe([...p.seats[r.seat].cards, ...p.board]) || r.hand : '');
  const banner = p.result && p.between ? `<div class="tbanner${mine ? ' good' : ''}">${mine ? `You win ${$(mine.won)}${said(mine) ? ` · ${esc(said(mine))}` : ''}` : esc(p.result.map((r) => `${p.seats[r.seat].name} wins ${$(r.won)}${said(r) ? ` · ${said(r)}` : ''}`).join(' · '))}</div>` : '';
  const centre = `<div class="tcentre">${board}<div class="tpot">${potLine}</div>${banner || `<div class="tstreet">${esc(streetName(p.street, v.game))}${p.between && p.clock ? ' · next hand' : ''}</div>`}</div>`;
  return `<div class="felt oval poker">${centre}${seats}</div>`;
}

const streetName = (s: string, game: string) => ({ pre: game === 'holdem' ? 'Pre-flop' : game === 'stud' ? 'Second street' : 'First round', flop: 'Flop', turn: 'Turn', river: 'River', show: 'Showdown', draw: 'The draw', second: 'Second round', s3: 'Third street', s4: 'Fourth street', s5: 'Fifth street', idle: '' } as Record<string, string>)[s] ?? s;
const lastTone = (t: string) => (t === 'Fold' ? 'fold' : /^(Raise|Bet|All in)/.test(t) ? 'raise' : /^(Call|Check)/.test(t) ? 'call' : '');
const lastText = (t: string) => t.replace(/(\d{4,})/g, (d) => Number(d).toLocaleString('en-US'));

/** A bet in front of a seat: a little stack of chips and its amount. */
function chipStack(n: number): string {
  const h = Math.min(5, 1 + Math.floor(Math.log10(Math.max(1, n))));
  return `<span class="tstack">${'<i></i>'.repeat(h)}</span><b>${$(n)}</b>`;
}
