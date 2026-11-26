// Headless check of banking: ATMs and banks exist, deposits and withdrawals work at them (and only
// there), shops take cash first then the bank, the bank survives death, business income lands in
// it, and characters carry it. `npx tsx scripts/bank.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/bank';
const { sanitizeCharacter, progressOf } = await import('../src/server/characters');
const { Room } = await import('../src/server/room');
const { killPed } = await import('../src/server/game/combat/damage');
const { PROPERTIES, RULES, SERVICES } = await import('../src/shared/packs');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const c = sanitizeCharacter({ id: 'bank01', universe: 'bayhaven', name: 'Vault', look: {}, created: 1, lastPlayed: 1, cash: 3000, bank: 500.4, garage: [], felonies: {}, deaths: 0, respect: {} })!;
check(c.bank === 500, 'a character brings its bank balance (cleaned)');

const room = new Room('BANK', 202);
room.stop();
const pl = room.join('ignored', { send: () => {}, close: () => {} }, c);
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world;
const econ = room.econ;
const me = w.peds.get(pl.pid)!;
const banks = w.city.services.filter((s) => SERVICES[s.spec].verb === 'bank');
check(banks.length === 3, `3 banks in the city (found ${banks.length})`);
check(econ.atms.length >= 10, `ATMs beside banks and businesses (${econ.atms.length})`);
check(pl.bank === 500 && pl.cash === 3000, 'joins with cash and bank');

// Away from any ATM: refused.
const atm = econ.atms[0];
me.body.x = atm.x + 30; me.body.y = atm.y;
check(econ.buy(pl, 'deposit', 'all', -1 - atm.id) !== null, 'no banking away from an ATM');
// At the ATM.
me.body.x = atm.x; me.body.y = atm.y;
check(econ.buy(pl, 'deposit', 'all', -1 - atm.id) === null && pl.cash === 0 && pl.bank === 3500, 'deposit all at an ATM');
check(econ.buy(pl, 'withdraw', '99999', -1 - atm.id) !== null && pl.bank === 3500, "can't withdraw more than you have");
check(econ.buy(pl, 'withdraw', '500', -1 - atm.id) === null && pl.cash === 500 && pl.bank === 3000, 'withdraw $500');
check(econ.buy(pl, 'withdraw', '-5', -1 - atm.id) !== null && econ.buy(pl, 'deposit', '1.5', -1 - atm.id) !== null, 'nonsense amounts refused');
// At a bank's counter.
const bank = banks[0];
me.body.x = bank.x; me.body.y = bank.y;
check(econ.buy(pl, 'deposit', '200', bank.id) === null && pl.cash === 300 && pl.bank === 3200, 'deposit at a bank counter');

// Shops: cash first, then the bank.
const shop = w.city.services.find((s) => SERVICES[s.spec].verb === 'gunshop')!;
me.body.x = shop.x; me.body.y = shop.y;
me.armor = 0;
const before = pl.cash + pl.bank;
check(econ.buy(pl, 'armor', '', shop.id) === null && pl.cash === 0 && pl.bank === before - RULES.armorPrice, `armor ($${RULES.armorPrice}) takes the $300 cash, then the bank`);
pl.bank = 10;
check(econ.buy(pl, 'armor', '', shop.id) !== null && pl.bank === 10, 'not enough in both: refused, nothing taken');

// Death costs carried cash, never the bank.
pl.cash = 1000; pl.bank = 5000;
killPed(w, me, null);
check(pl.cash === 1000 - Math.floor(1000 * RULES.deathCashLoss) && pl.bank === 5000, 'dying drops some cash; the bank is untouched');

// Business income: whatever's in the safes at midnight goes to the bank (less the armoured-car fee).
const biz = w.city.properties.find((p) => PROPERTIES[p.spec].kind === 'business' && PROPERTIES[p.spec].income > 0)!;
econ.owners.set(biz.id, pl.ownerKey);
const hourly = (h: number) => (room.business as unknown as { hourly: (h: number) => void }).hourly(h);
room.business.safes.clear(); // a previous run's room save may have left money in them
const b0 = pl.bank, c0 = pl.cash;
hourly(23); hourly(0);
const inc = PROPERTIES[biz.spec].income * 2; // 23:00 and midnight's own hour, then the sweep
check(pl.bank === b0 + inc - Math.round(inc * RULES.safeSweepFee) && pl.cash === c0, 'business income reaches the bank at midnight');
check(progressOf(pl).bank === pl.bank, 'saves carry the bank balance');

console.log(failures ? `${failures} check(s) failed` : 'all bank checks passed');
process.exit(failures ? 1 : 0);
