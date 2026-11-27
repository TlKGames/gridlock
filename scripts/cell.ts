// Headless check of the cell phone: a gang texts its number once it trusts you, calls ring and can
// be answered (a job starts, paying more), declined or missed (a text), you can ring a contact for
// work (with a wait before the same one has more), strangers' numbers don't work, and business
// income arrives as a text. `npx tsx scripts/cell.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/cell';
const { Room } = await import('../src/server/room');
const { GANGS, MENTOR_CALLER, MISSIONS, PROPERTIES, RESPECT } = await import('../src/shared/packs');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const [g1, g2, g3] = GANGS;
const msgs: { t: string; [k: string]: unknown }[] = [];
const room = new Room('CELL', 303);
room.stop();
const pl = room.join('Caller', { send: (d) => msgs.push(JSON.parse(d)), close: () => {} }, {
  id: 'cell01', universe: 'bayhaven', name: 'Caller', look: {} as never, created: 1, lastPlayed: 1, cash: 100, bank: 0, garage: [], felonies: {}, deaths: 0,
  respect: { [g1]: RESPECT.cellAt + 5, [g2]: 10 }, met: ['benny'], // Benny's welcome is tested in coop.ts
});
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world;
const ticks = (n: number) => { for (let i = 0; i < n; i++) room.tick(); };
const since = (k: number) => msgs.slice(k);
const texts = (k: number) => since(k).filter((m) => m.t === 'text') as unknown as { from: string; body: string }[];
const calls = (k: number) => since(k).filter((m) => m.t === 'call') as unknown as { gang: string; state: string; text?: string }[];
/** What's said on the line (voiced exchanges: [caller, situation, exchange]). */
const said = (k: number) => since(k).filter((m) => m.t === 'talk').flatMap((m) => (m as unknown as { parts: [string, string, number][] }).parts);

ticks(5);
check(texts(0).length === 0, 'a number you already had on joining is not texted again');
check(room.cell.contacts(pl).join() === g1, 'contacts: gangs that trust you enough');

let k = msgs.length;
pl.respect[g2] = RESPECT.cellAt;
ticks(2);
check(texts(k).some((t) => t.body.includes('Keep this number')), 'earning a gang\'s trust gets its number by text');

// A call rings; answer it and a job starts.
k = msgs.length;
pl.cell.next = 0;
ticks(2);
const ring = calls(k).find((c) => c.state === 'ring');
check(!!ring && room.cell.contacts(pl).includes(ring.gang), 'a contact calls when you are free');
room.cell.answer(pl, true);
check(!!pl.mission && pl.mission.giver === ring?.gang, 'answering starts that gang\'s job');
check(said(k).some(([, s]) => s === MISSIONS[pl.mission!.spec].kind), 'they brief you on the line');
// No calls while working.
k = msgs.length;
pl.cell.next = 0;
ticks(3);
check(!calls(k).some((c) => c.state === 'ring'), 'nobody calls while you are on a job');
room.missions.drop(pl);

// Missed call.
k = msgs.length;
pl.cell.next = 0;
ticks(2);
check(calls(k).some((c) => c.state === 'ring'), 'another call');
ticks(30 * (RESPECT.cellRing + 1));
check(calls(k).some((c) => c.state === 'missed') && texts(k).some((t) => t.body === 'Missed call.'), 'unanswered: missed, with a text');
check(!pl.cell.ringing, 'the phone stops ringing');

// Declined.
pl.cell.next = 0;
ticks(2);
room.cell.answer(pl, false);
check(!pl.mission && !pl.cell.ringing, 'declining starts nothing');

// Dialling.
const before = (pl.mission as unknown) === null;
check(before && room.cell.dial(pl, g1) === null && pl.mission?.giver === g1, 'ringing a contact gets you work');
room.missions.drop(pl);
k = msgs.length;
room.cell.dial(pl, g1);
check(!pl.mission && said(k).some(([, s]) => s === 'nothing'), 'the same contact needs a while before more work');
check(room.cell.dial(pl, g3) !== null, "a gang that doesn't trust you can't be rung");
// Phone jobs pay more: the same job spec's reward range, scaled.
room.missions.offer(pl, g2, 10);
check((pl.mission?.reward ?? 0) >= 10_000, 'phone work pays the cell multiplier');
room.missions.drop(pl);

// The mentor (Benny): his number came with his welcome; ring him and he picks up and tips you off
// about a ringing payphone; blow too many jobs and he won't deal with you.
const mentor = MENTOR_CALLER!;
check(since(0).some((m) => m.t === 'people' && (m as unknown as { ids: string[] }).ids.includes(mentor)), "the mentor's number is in your contacts after his welcome");
k = msgs.length;
check(room.cell.dial(pl, mentor) === null, 'you can ring the mentor');
check(said(k).some(([, s]) => s === 'answer') && texts(k).some((t) => t.body.startsWith('Payphone in')), 'he picks up and points you at a ringing payphone');
pl.blownRun = RESPECT.mentorFedUpAfter;
k = msgs.length;
room.cell.dial(pl, mentor);
check(said(k).some(([, s]) => s === 'refuse') && !said(k).some(([, s]) => s === 'answer'), 'after too many blown jobs he tells you where to go');
pl.blownRun = 0;
// A crewless player gets his nudge when idle; miss it and it's a voicemail.
const loner = room.join('Loner', { send: (d) => msgs.push(JSON.parse(d)), close: () => {} }, {
  id: 'cell02', universe: 'bayhaven', name: 'Loner', look: {} as never, created: 1, lastPlayed: 1, cash: 0, bank: 0, garage: [], felonies: {}, deaths: 0, respect: {}, met: [mentor],
});
if (typeof loner === 'string') throw new Error(loner);
loner.cell.nudgeAt = 0;
k = msgs.length;
ticks(2);
check(loner.cell.ringing === mentor, 'with no crew numbers, the mentor rings when you are idle');
ticks(30 * (RESPECT.cellRing + 1));
check(since(k).some((m) => m.t === 'voicemail' && (m as unknown as { parts: [string, string][] }).parts[0][1] === 'voicemail'), 'missed, he leaves a voicemail');
// Answered, he opens with a greeting and then says there's work.
loner.cell.nudgeAt = 0;
ticks(2);
k = msgs.length;
room.cell.answer(loner, true);
check(said(k).map(([, s]) => s).join() === 'pickup,hello,tip,on_it', 'answered: you pick up, his greeting, he sends you to a payphone, you\'re on it');

// Declining a mentor reminder leaves the actual lead and consumes the repeating idle trigger.
loner.cell.nudgeAt = 0;
ticks(2);
k = msgs.length;
room.onMessage(loner, { t: 'call', accept: false });
room.onMessage(loner, { t: 'call', accept: false });
check(texts(k).filter(t => t.body.startsWith('Payphone in')).length === 1, 'declined reminder texts the location once');
loner.cell.nudgeAt = 0;
ticks(2);
check(!loner.cell.ringing && !loner.mission, 'declining clears the idle reminder without accepting work');

// A newcomer who declines gets the welcome as a text and keeps the contact across a rejoin.
const { sanitizeCharacter } = await import('../src/server/characters');
const fresh = sanitizeCharacter({ id: 'cell03', universe: 'bayhaven', name: 'Newcomer' })!;
const peer = { send: (d: string) => msgs.push(JSON.parse(d)), close: () => {} };
const newcomer = room.join(fresh.name, peer, fresh);
if (typeof newcomer === 'string') throw new Error(newcomer);
newcomer.cell.introAt = 0;
ticks(2);
k = msgs.length;
room.onMessage(newcomer, { t: 'call', accept: false });
check(texts(k).some(t => t.from === 'Benny' && t.body.includes('payphones') && t.body.includes('chop shop')), 'declined welcome summarizes the work and chop shop');
const saved = since(k).find(m => m.t === 'save')!;
const restored = sanitizeCharacter({ ...fresh, ...(saved.p as object) })!;
room.leave(newcomer);
const back = room.join(fresh.name, peer, restored);
if (typeof back === 'string') throw new Error(back);
back.cell.introAt = back.cell.nudgeAt = 0;
ticks(2);
check(!back.cell.ringing && room.cell.people(back).includes(mentor), 'rejoining preserves both dismissed triggers and Benny’s number');
check(room.cell.dial(back, mentor) === null, 'Benny still answers when called');

// Business income reaching the bank at midnight comes with a text from the bank.
const biz = w.city.properties.find((p) => PROPERTIES[p.spec].kind === 'business' && PROPERTIES[p.spec].income > 0)!;
room.econ.owners.set(biz.id, pl.ownerKey);
k = msgs.length;
const hourly = (h: number) => (room.business as unknown as { hourly: (h: number) => void }).hourly(h);
hourly(23); hourly(0);
check(texts(k).some((t) => t.from === 'Harbor Trust' && t.body.includes('Night pickup')), 'business income: a text from the bank');

console.log(failures ? `${failures} check(s) failed` : 'all cell phone checks passed');
process.exit(failures ? 1 : 0);
