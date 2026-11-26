// Headless check of businesses: income fills each safe up to its cap (with a text when full), you
// collect it at the door, midnight sweeps what's left to the bank less a fee, gangs lean on places
// (collect blocked; pay off, kill the crew, or lose the safe), and the perks: club meetings, the car
// wash taking your heat off, the warehouse fencing stolen cars. `npx tsx scripts/business.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/business';
const { Room } = await import('../src/server/room');
const { GANGS, PROPERTIES, RULES, RESPECT } = await import('../src/shared/packs');
const { killPed } = await import('../src/server/game/combat/damage');
const { spawnVehicle, seatPed } = await import('../src/server/game/factory');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const msgs: { t: string; from?: string; body?: string }[] = [];
const room = new Room('BIZZ', 404);
room.stop();
const pl = room.join('Owner', { send: (d) => msgs.push(JSON.parse(d)), close: () => {} });
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world, biz = room.business;
const hourly = (h: number) => (biz as unknown as { hourly: (h: number) => void }).hourly(h);
const me = w.peds.get(pl.pid)!;
const own = (perk: string | undefined, income = true) => {
  const p = w.city.properties.find((x) => { const s = PROPERTIES[x.spec]; return s.kind === 'business' && s.perk === perk && (!income || s.income > 0) && !room.econ.owners.has(x.id); })!;
  room.econ.owners.set(p.id, pl.ownerKey);
  pl.owned.push(p.id);
  return p;
};
const texts = (k: number) => msgs.slice(k).filter((m) => m.t === 'text');
const at = (p: { x: number; y: number }) => { me.body.x = p.x; me.body.y = p.y; };

// Safes.
const shop = own(undefined);
const inc = PROPERTIES[shop.spec].income;
hourly(10);
check(biz.safes.get(shop.id) === inc, `an hour of income in the safe ($${inc})`);
let k = msgs.length;
for (let h = 11; h < 11 + RULES.safeHours + 2; h++) hourly(h % 24 || 1);
check(biz.safes.get(shop.id) === inc * RULES.safeHours, 'the safe stops at its cap');
check(texts(k).some((t) => t.body?.includes('safe\'s full')), 'a text when the safe is full');
at(shop);
const cash0 = pl.cash;
check(room.econ.buy(pl, 'collect', '', shop.id) === null && pl.cash === cash0 + inc * RULES.safeHours && biz.safes.get(shop.id) === 0, 'collected at the door, as cash');
hourly(22); hourly(23);
k = msgs.length;
const bank0 = pl.bank;
hourly(0);
const swept = inc * 3, fee = Math.round(swept * RULES.safeSweepFee);
check(pl.bank === bank0 + swept - fee && biz.safes.get(shop.id) === 0, 'midnight: the safe goes to the bank less the fee');
check(texts(k).some((t) => t.from === 'Harbor Trust' && t.body?.includes('Night pickup')), 'with a text from the bank');

// Trouble: pay off.
const gang = GANGS[0];
pl.respect[gang] = 0;
hourly(3);
biz.startTrouble(shop.id, gang, pl);
const t = biz.trouble.get(shop.id)!;
check(t.crew.length === RULES.troubleCrew && t.crew.every((id) => w.peds.get(id)?.persistent), 'a crew turns up at the door');
check(room.econ.buy(pl, 'collect', '', shop.id) !== null, "can't empty the safe with them there");
pl.cash = 100000;
const price = inc * RULES.payoffHours;
check(room.econ.buy(pl, 'payoff', '', shop.id) === null && pl.cash === 100000 - price && !biz.trouble.has(shop.id), `paid them off ($${price})`);
check(pl.respect[gang] === RULES.payoffRespect, 'and they think better of you');
// Trouble: they hit the safe.
biz.safes.set(shop.id, 1234);
biz.startTrouble(shop.id, gang, pl);
biz.trouble.get(shop.id)!.ends = w.time - 1;
k = msgs.length;
biz.update();
check(biz.safes.get(shop.id) === 0 && !biz.trouble.has(shop.id) && texts(k).some((x) => x.body?.includes('cleaned out')), 'left too long: they empty the safe');
// Trouble: deal with them.
biz.startTrouble(shop.id, gang, pl);
for (const id of biz.trouble.get(shop.id)!.crew) killPed(w, w.peds.get(id)!, me);
k = msgs.length;
biz.update();
check(!biz.trouble.has(shop.id) && texts(k).some((x) => x.body?.includes('is yours')), 'dealt with: they back off');

// Club.
const club = own('club');
at(club);
pl.respect[GANGS[1]] = RESPECT.noWorkBelow;
check(room.econ.buy(pl, 'meet', GANGS[1], club.id) === null && pl.mission?.giver === GANGS[1], 'your club: meet a gang, get work');
room.missions.drop(pl);
pl.respect[GANGS[2]] = RESPECT.noWorkBelow - 1;
check(room.econ.buy(pl, 'meet', GANGS[2], club.id) !== null, "a gang that won't work with you won't meet");

// Car wash and warehouse (pads).
const wash = own('wash');
const car = spawnVehicle(w, 1, wash.pad!.x, wash.pad!.y, 0, 3);
seatPed(w, me, car, 0);
pl.wanted = 3; pl.heat = 200;
biz.onPad(pl, car, wash.id);
check(pl.wanted === 0 && pl.heat === 0, 'your car wash takes the heat off');
const ware = own('fence');
const c0 = pl.cash;
biz.onPad(pl, car, ware.id);
check(!w.vehicles.has(car.id) && pl.cash > c0, `your warehouse fences a stolen car (+$${pl.cash - c0})`);

console.log(failures ? `${failures} check(s) failed` : 'all business checks passed');
process.exit(failures ? 1 : 0);
