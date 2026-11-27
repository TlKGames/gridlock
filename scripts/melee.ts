// Headless checks of fist fights (server combat/fire.ts melee): a punch lands for real damage, shoves
// the one it hits back (they reel, unable to act, while they slide), three in a row floors them, and
// every blow that lands sends a hit event (its thud, the camera jolt, the swing's arm).
// `npx tsx scripts/melee.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/melee';
const { Room } = await import('../src/server/room');
const { PEDS, RULES, UNARMED, WEAPONS } = await import('../src/shared/packs');
const { FX } = await import('../src/shared/protocol');
const { spawnPed } = await import('../src/server/game/factory');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const room = new Room('MELE', RULES.citySeed);
room.stop();
const pl = room.join('Boxer', { send: () => {}, close: () => {} });
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world;
const me = w.peds.get(pl.pid)!;
me.wi = me.weapons.findIndex((h) => h.w === UNARMED);
const fists = WEAPONS[UNARMED];
const civ = PEDS.findIndex((p) => p.behaviour === 'civilian');
// Out in the open (the middle of a wide street), not against whatever's by the spawn point.
const open = w.city.segs.find((s) => s.axis === 'h' && s.lanes > 1 && s.x1 - s.x0 > 80 && s.x0 > 500)!;
me.body.x = (open.x0 + open.x1) / 2; me.body.y = open.y0;
let mark = spawnPed(w, civ, me.body.x + 1.1, me.body.y, Math.PI);
mark.ai = null; // stands there and takes it
const hp0 = mark.hp;
const fx: number[][] = [];
/** One punch: trigger for a tick facing the mark, then let things play out. */
const punch = (after = 6) => {
  me.aim = Math.atan2(mark.body.y - me.body.y, mark.body.x - me.body.x);
  me.trigger = true; me.fireCd = 0;
  const x0 = mark.body.x;
  // The trigger goes in with the player's input; tryFire runs in the player tick.
  pl.queue.push([0, 0, 0, 0, 0, me.aim, 1, -1]);
  room.tick(); fx.push(...w.fx);
  me.trigger = false;
  const staggered = (mark.stagger ?? 0) > 0;
  for (let i = 0; i < after; i++) { pl.queue.push([0, 0, 0, 0, 0, me.aim, 0, -1]); room.tick(); fx.push(...w.fx); }
  return { moved: Math.hypot(mark.body.x - x0, 0), staggered };
};

const r1 = punch();
check(hp0 - mark.hp >= fists.damage - 0.01, `a punch lands for ${hp0 - mark.hp} (fists: ${fists.damage})`);
check(r1.staggered && r1.moved > 0.4, `it shoves them back ${r1.moved.toFixed(2)} m and they reel`);
check(fx.some((e) => e[0] === FX.Hit && e[1] === me.id && e[2] === mark.id), 'a hit event goes out (thud, jolt)');
check(fx.some((e) => e[0] === FX.Swing && e[1] === me.id), 'and the swing (the arm throws it)');
// Civilians can fall early on a lucky hit. A sparring player takes the full three-hit fist combo.
mark.body.y += 15;
const partner = room.join('Sparring partner', { send: () => {}, close: () => {} });
if (typeof partner === 'string') throw new Error(partner);
room.stop();
mark = w.peds.get(partner.pid)!;
const close = () => { mark.body.x = me.body.x + 1.1; mark.body.y = me.body.y; mark.body.vx = 0; mark.body.vy = 0; };
close(); punch(2);
close(); punch(2); check(mark.down === 0, 'two in a row: still up');
close(); punch(1); check(mark.down > 0, 'the third in a row floors them');
room.leave(partner);
const hits = Math.ceil(PEDS[civ].hp / fists.damage);
check(hits <= 7, `a civilian goes down for good in ${hits} punches (was 12)`);

// From a car the server refuses a shot behind you (even if a client sends one), and takes one out
// of the side window.
{
  const { seatPed, spawnVehicle } = await import('../src/server/game/factory');
  const { vehicleIndex, weaponIndex } = await import('../src/shared/packs');
  const car = spawnVehicle(w, vehicleIndex('sedan'), me.body.x + 20, me.body.y, 0);
  seatPed(w, me, car, 0);
  me.wi = me.weapons.findIndex((h) => h.w === weaponIndex('pistol'));
  const shoot = (aim: number) => {
    const pistol = me.weapons[me.wi];
    const before = pistol.ammo + pistol.clip;
    me.fireCd = 0;
    pl.queue.push([0, 0, 0, 0, 0, aim, 1, -1]); room.tick(); fx.push(...w.fx);
    pl.queue.push([0, 0, 0, 0, 0, aim, 0, -1]); room.tick(); fx.push(...w.fx);
    return pistol.ammo + pistol.clip < before;
  };
  check(!shoot(car.body.angle + Math.PI), 'from a car, a shot behind you is refused');
  check(shoot(car.body.angle + Math.PI / 2), 'and one out of the side window goes off');
}

console.log(failures ? `${failures} check(s) failed` : 'all melee checks passed');
process.exit(failures ? 1 : 0);
