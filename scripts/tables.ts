// Headless checks of the card and casino tables (world/tables.ts, server systems/cardTables.ts,
// cardPoker.ts, cardInvites.ts): Bayhaven's casino has its games; you play roulette, blackjack and
// slots from your cash; poker deals you in against people sat at the table; a gang's game wants an
// invite, which comes with respect; a friend's game wants meeting them and calling; cheating can get
// you thrown out; calling out an honest man starts a fight. `npx tsx scripts/tables.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/tables';
const { Room } = await import('../src/server/room');
const { RULES, TABLES } = await import('../src/shared/packs');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

// A fresh room each run (a room's save keeps who you've met and been invited by).
const { rmSync } = await import('node:fs');
rmSync('data-smoke/tables', { recursive: true, force: true });
const room = new Room('CARD', RULES.citySeed);
room.stop();
const msgs: { t: string; kind?: string; text?: string; v?: import('../src/shared/protocol').TableView | null; from?: string; body?: string }[] = [];
const pl = room.join('Gambler', { send: (d) => msgs.push(JSON.parse(d)), close: () => {} });
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world;
const me = w.peds.get(pl.pid)!;
const tables = w.city.tables;
const find = (game: string) => tables.find((t) => TABLES[t.spec].game === game && t.host === 'house')!;
const goTo = (t: (typeof tables)[number]) => { me.body.x = t.at.x; me.body.y = t.at.y; me.body.vx = me.body.vy = 0; };
const send = (m: object) => room.onMessage(pl, { t: 'table', ...m } as never);
const ticks = (n: number) => { for (let i = 0; i < n; i++) { goToSeat(); room.tick(); } };
let seat: (typeof tables)[number] | null = null;
const goToSeat = () => { if (seat) { me.body.x = seat.at.x; me.body.y = seat.at.y; } };
const view = () => [...msgs].reverse().find((m) => m.t === 'table')?.v ?? null;

check(['slots', 'roulette', 'craps', 'blackjack', 'holdem'].every((g) => tables.some((t) => TABLES[t.spec].game === g && t.host === 'house')), 'the casino has slots, roulette, craps, blackjack and hold\'em');
check(tables.filter((t) => t.host === 'gang').length >= 2 && tables.filter((t) => t.host === 'friend').length >= 2, `gangs' back rooms (${tables.filter((t) => t.host === 'gang').length}) and friends' games (${tables.filter((t) => t.host === 'friend').length})`);

pl.cash = 5000; pl.bank = 0;
// Roulette: a bet on red.
seat = find('roulette'); goTo(seat);
send({ op: 'sit', table: seat.id }); ticks(1);
const cash0 = pl.cash;
send({ op: 'spin', n: 50, s: 'red' }); ticks(1);
const r = view()?.roulette;
check(!!r && r.last >= 0 && (pl.cash === cash0 - 50 || pl.cash === cash0 + 50), `roulette: ${r?.last}, cash ${cash0} → ${pl.cash}`);
send({ op: 'leave' }); ticks(1);
check(view() === null, 'leaving closes the table');

// Blackjack: a hand, standing.
seat = find('blackjack'); goTo(seat);
send({ op: 'sit', table: seat.id }); ticks(1);
const c1 = pl.cash;
send({ op: 'deal', n: 100 }); ticks(1);
if (view()?.bj?.phase === 'play') { send({ op: 'stand' }); ticks(1); }
const bj = view()?.bj;
check(!!bj && bj.phase === 'done' && [c1 - 100, c1, c1 + 100, c1 + 150].includes(pl.cash), `blackjack: ${bj?.outcome.join(' ')} (${c1} → ${pl.cash})`);
send({ op: 'leave' }); ticks(1);

// Slots.
seat = find('slots'); goTo(seat);
send({ op: 'sit', table: seat.id }); ticks(1);
for (let i = 0; i < 20; i++) { send({ op: 'pull', n: 5 }); ticks(1); }
check(!!view()?.slots?.reels, `slots: 20 pulls, cash now ${pl.cash}`);
send({ op: 'leave' }); ticks(1);

// Hold'em: buy in, people sat round, play by checking/calling a few hands.
pl.cash = 20000;
seat = find('holdem'); goTo(seat);
send({ op: 'sit', table: seat.id, n: 1000 }); ticks(2);
const pv = view()?.poker;
check(!!pv && pv.seats.length >= 4 && pl.cash === 19000, `hold'em: sat down with $1,000 against ${pv ? pv.seats.length - 1 : 0}`);
const sat = pv ? pv.seats.length - 1 : 0;
let hands = 0, lastStreet = '';
for (let i = 0; i < 30 * 120 && hands < 4; i++) {
  ticks(1);
  const v = view()?.poker;
  if (!v) break;
  if (v.street === 'show' && lastStreet !== 'show') hands++;
  lastStreet = v.street;
  if (v.between && view()!.chips <= 0) send({ op: 'rebuy' });
  if (v.yourTurn) send({ op: v.toCall ? 'call' : 'check' });
}
check(hands >= 3, `${hands} hands played at a human pace`);
ticks(2); // (the last move's view arrives on the next tick)
const onTable = view()?.chips ?? 0, inPocket = pl.cash;
send({ op: 'leave' }); ticks(1);
check(pl.cash === inPocket + onTable, `leaving cashes your chips out ($${onTable.toLocaleString('en-US')})`);
void sat;

// A gang's game: no invite, no seat; respect brings a text; then you're in.
const gt = tables.find((t) => t.host === 'gang')!;
pl.cash = 200000;
seat = gt; goTo(gt);
const before = msgs.length;
send({ op: 'sit', table: gt.id, n: 20000 }); ticks(1);
if (process.env.DEBUG) console.log('  said:', msgs.slice(before).filter((m) => m.t === 'msg').map((m) => m.text).join(' | '), 'view:', !!view(), 'met:', [...pl.met].join(','), 'respect:', JSON.stringify(pl.respect));
check(view() === null && msgs.slice(before).some((m) => m.text?.includes('invite')), 'a gang\'s back room: "Private game. You need an invite."');
pl.respect[gt.gang!] = RULES.cardInviteRespect + 5;
ticks(70);
check(msgs.some((m) => m.t === 'text' && m.body?.includes('game in the back')), 'respect enough, and the gang texts you an invite');
check(msgs.some((m) => m.t === 'friends' && (m as { games?: string[] }).games?.includes(gt.gang!)), 'and their game goes on your map');
{
  const { cardVenues } = await import('../src/shared/world/tables');
  const vs = cardVenues(w.city);
  check(vs.some((v) => v.pinned && v.games.length >= 5) && vs.some((v) => v.host === 'gang') && vs.some((v) => v.host === 'friend'),
    `card venues for the map: ${vs.length} (${vs.map((v) => `${v.name}: ${v.games.join('/')}`).slice(0, 3).join('; ')}...)`);
}
send({ op: 'sit', table: gt.id, n: 20000 }); ticks(2);
check(!!view()?.poker, 'invited, you sit down at their game');
send({ op: 'leave' }); ticks(1);

// A friend: meet at their place, call, sit down.
const ft = tables.find((t) => t.host === 'friend')!;
seat = ft; goTo(ft);
ticks(70);
send({ op: 'sit', table: ft.id, n: 100 }); ticks(1);
check(view() === null, 'a stranger\'s yard game: not before you\'ve met them');
room.onMessage(pl, { t: 'table', op: 'meet', table: ft.id } as never); ticks(1);
check(msgs.some((m) => m.t === 'friends'), 'meeting them puts them in your phone');
for (let k = 0; k < 6 && !view(); k++) { room.onMessage(pl, { t: 'dial', gang: `friend:${ft.friend}` } as never); ticks(1); send({ op: 'sit', table: ft.id, n: 100 }); ticks(2); }
check(!!view()?.poker, 'after a call, their game\'s on and you sit in');
// Cheating at a friend's: sooner or later they see it and throw you out.
let thrown = false;
pl.cash += 5000;
for (let k = 0; k < 1200 && !thrown; k++) {
  ticks(10);
  const v = view();
  if (!v) { thrown = true; break; }
  if (v.cheats?.includes('ace')) send({ op: 'cheat', s: 'ace' });
  else if (v.cheats?.includes('peek')) send({ op: 'cheat', s: 'peek' });
  if (v.poker?.between && v.chips <= 0) send({ op: 'rebuy' });
  if (v.poker?.yourTurn) send({ op: 'call' });
  if (!view()) thrown = true;
}
check(thrown && pl.met.has(`sore:${ft.friend}`), 'cheating at a friend\'s table: caught, thrown out, and they\'re done with you');

console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
