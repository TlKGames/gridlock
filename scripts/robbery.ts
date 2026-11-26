// Headless check of hold-ups: covering a clerk with a gun gets their hands up and the till out, the
// silent alarm puts you on stars and the record, looking away ends it early, an emptied till has
// nothing until it refills, some clerks fight back, another player's business is robbed from its
// safe, and your own staff or bare fists get nothing. `npx tsx scripts/robbery.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/robbery';
const { Room } = await import('../src/server/room');
const { PROPERTIES, RULES, SERVICES, WEAPONS, weaponIndex } = await import('../src/shared/packs');
const { BTN, EK, PF } = await import('../src/shared/protocol');
const { buildSnapshot } = await import('../src/server/game/systems/snapshot');
const { clearHeat } = await import('../src/server/game/systems/wanted');
type Interior = import('../src/shared/world/interiors').Interior;
type Ped = import('../src/server/game/entities').Ped;

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const room = new Room('ROBB', RULES.citySeed);
room.stop();
const joined = room.join('Robber', { send: () => {}, close: () => {} });
if (typeof joined === 'string') throw new Error(joined);
const pl = joined;
room.stop();
const w = room.world;
const me = w.peds.get(pl.pid)!;
const city = w.city;
const rob = room.robberies;

const kiosks = city.interiors.filter((i) => !i.property && SERVICES[i.place.spec].id === 'gas');
const gasSpec = SERVICES.find((s) => s.id === 'gas')!.robbery!;
let aimAt: Ped | null = null;
let aimAway = false;
let noAimButton = false;

/** Ticks with the robber kept alive and (optionally) aiming at `aimAt`. */
function run(seconds: number, until?: () => boolean): void {
  for (let t = 0; t < seconds * 30; t++) {
    me.hp = me.spec.hp; pl.bustT = 0; // kept alive and free: the police are part of other tests
    const last = [...pl.last] as typeof pl.last;
    if (aimAt) last[5] = Math.atan2(aimAt.body.y - me.body.y, aimAt.body.x - me.body.x) + (aimAway ? 2.5 : 0);
    last[1] = 0; last[2] = 0; last[6] = aimAt && !noAimButton ? BTN.aim : 0;
    pl.last = last;
    room.tick();
    if (until?.()) return;
  }
}
function clerkAt(i: Interior): Ped | undefined {
  return [...w.peds.values()].find((p) => !p.dead && !p.player && p.spec.id === i.clerkArch && Math.hypot(p.body.x - i.clerk.x, p.body.y - i.clerk.y) < 3);
}
/** Walk in (teleport) to a place's counter and wait for its clerk. */
function enter(i: Interior): Ped {
  aimAt = null; aimAway = false;
  clearHeat(pl);
  // Each case starts clean: no police, nobody still after the robber from the last one.
  for (const p of [...w.peds.values()]) if (!p.player && (p.spec.behaviour === 'police' || (p.ai?.task === 'attack' && p.ai.target === me.id))) w.peds.delete(p.id);
  me.body.x = i.counter.x; me.body.y = i.counter.y; me.body.vx = 0; me.body.vy = 0;
  run(8, () => !!clerkAt(i) && clerkAt(i)!.ai?.task === 'stand');
  const c = clerkAt(i);
  if (!c) throw new Error(`no clerk at ${i.place.name}`);
  return c;
}
const pistol = weaponIndex('pistol');
const armPistol = () => { const s = me.weapons.findIndex((h) => h.w === pistol); me.wi = s; me.weapons[s].ammo = 60; me.weapons[s].clip = WEAPONS[pistol].clip; };
armPistol();

// 0. Facing the clerk with a gun out but not aiming (walking up, shopping): nothing happens.
gasSpec.fightBack = 0;
const k1 = kiosks[0];
let c = enter(k1);
aimAt = c; noAimButton = true;
run(2);
check(c.ai?.task === 'stand', 'gun out, facing the clerk, but not aiming: no hold-up');
noAimButton = false;

// 1. A full hold-up at a gas kiosk (no fight-back this time).
const cash0 = pl.cash;
aimAt = c;
run(1.5);
check(c.ai?.task === 'surrender', 'covering the clerk: hands go up');
pl.sent = new Map(); // a full snapshot: everything sent in full, not "unchanged since last time"
const snap = buildSnapshot(w, pl);
const sent = snap.t === 's' ? snap.e.find((d) => d[0] === c.id && d[1] === EK.Ped) : undefined;
check(!!sent && (sent[6] & PF.hands) !== 0, 'clients are told (hands-up flag)');
run(RULES.robSeconds + 2);
const got = pl.cash - cash0;
check(Math.abs(got - gasSpec.till) <= 10, `the till comes out while you keep them covered (+$${got} of $${gasSpec.till})`);
check(pl.wanted >= RULES.robWanted, `the silent alarm: wanted ${pl.wanted} (at least ${RULES.robWanted})`);
check((pl.felonies.robbery ?? 0) >= 1, 'armed robbery on the record');
check(c.ai?.task !== 'surrender', 'the clerk lowers their hands once it is over');

// 2. Straight back to the same counter: the till's empty.
c = enter(k1);
const cash1 = pl.cash;
aimAt = c;
run(4);
check(pl.cash - cash1 < gasSpec.till * 0.05, `an emptied till gives next to nothing (+$${pl.cash - cash1}, what's refilled since)`);

// 3. Looking away partway lets them stop.
const k2 = kiosks[1];
c = enter(k2);
const cash2 = pl.cash;
aimAt = c;
run(RULES.robStart + 3);
aimAway = true;
run(RULES.robGrace + 3);
const part = pl.cash - cash2;
check(part > 0 && part < gasSpec.till * 0.7, `looking away ends it early (+$${part})`);
check(!rob.holdUps.size, 'no hold-up left running');

// 4. A clerk who fights back.
gasSpec.fightBack = 1;
const k3 = kiosks[2];
c = enter(k3);
aimAt = c;
let fought = false;
run(3, () => (fought = c.ai?.task === 'attack'));
check(fought && c.weapons.some((h) => WEAPONS[h.w].kind !== 'melee'), `some clerks go for a gun instead (task ${c.ai?.task})`);
gasSpec.fightBack = 0.1;
w.peds.delete(c.id);

// 5. Another player's business: robbed from its safe, not a till.
const store = city.interiors.find((i) => i.property && PROPERTIES[i.place.spec].id === 'corner_store')!;
const storeSpec = PROPERTIES.find((p) => p.id === 'corner_store')!.robbery!;
storeSpec.fightBack = 0;
room.econ.owners.set(store.place.id, 'rival');
room.business.safes.set(store.place.id, 300);
c = enter(store);
const cash3 = pl.cash;
aimAt = c;
run(RULES.robSeconds);
check(pl.cash - cash3 === 300 && (room.business.safes.get(store.place.id) ?? 0) === 0, `a rival's store: the safe's $300 comes out (+$${pl.cash - cash3})`);

// 6. Your own place: your staff don't put their hands up.
room.econ.owners.set(store.place.id, pl.ownerKey);
room.business.safes.set(store.place.id, 300);
c = enter(store);
aimAt = c;
run(2);
check(c.ai?.task !== 'surrender' && (room.business.safes.get(store.place.id) ?? 0) === 300, 'your own business: nothing happens');

// 7. Bare fists don't hold anyone up.
room.econ.owners.delete(store.place.id);
c = enter(k2);
me.wi = me.weapons.findIndex((h) => WEAPONS[h.w].kind === 'melee');
if (me.wi < 0) { me.weapons.unshift({ w: weaponIndex('fists'), ammo: 0, clip: 0 }); me.wi = 0; }
aimAt = c;
run(2);
check(c.ai?.task !== 'surrender', 'fists: no hold-up');

// 8. The till fills up again.
const before = (rob as unknown as { tills: Map<number, number> }).tills.get(city.interiors.indexOf(k1)) ?? gasSpec.till;
run(20);
const after = (rob as unknown as { tills: Map<number, number> }).tills.get(city.interiors.indexOf(k1)) ?? gasSpec.till;
check(after > before, `an emptied till refills over time ($${Math.round(before)} -> $${Math.round(after)})`);

console.log(failures ? `${failures} check(s) failed` : 'all robbery checks passed');
process.exit(failures ? 1 : 0);
