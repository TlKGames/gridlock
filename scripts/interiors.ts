// Headless check of walk-in places: every one has a door gap a person fits through and a car doesn't,
// walls you can't walk through, a counter you can reach from the door, a clerk, business at the
// counter (the gun shop sells there), and bullets stopped by the walls. `npx tsx scripts/interiors.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/interiors';
const { Room } = await import('../src/server/room');
const { SERVICES, VEHICLES } = await import('../src/shared/packs');
const { stepFoot } = await import('../src/shared/sim/physics');
const { DIR_VEC } = await import('../src/shared/world/cityTypes');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const room = new Room('INTR', 606);
room.stop();
const pl = room.join('Walker', { send: () => {}, close: () => {} });
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world, city = w.city, statics = w.statics;
const me = w.peds.get(pl.pid)!;
check(city.interiors.length >= 20, `walk-in places: ${city.interiors.length}`);
check(city.interiors.every((i) => i.place.counter && i.walls.length >= 5), 'each has a shell and a counter');

check(city.interiors.every((i) => {
  const b = city.lots[i.place.lot].building!.rect;
  const offsets = [i.room.x0 - b.x0, i.room.y0 - b.y0, b.x1 - i.room.x1, b.y1 - i.room.y1];
  return offsets.every((offset) => Math.abs(offset - 0.3) < 1e-6);
}), 'every ground floor reaches all four exterior walls');

/** Walks a person body from a to b in small steps; returns where they end up. */
function walk(from: { x: number; y: number }, to: { x: number; y: number }, seconds = 12): { x: number; y: number } {
  const b = { x: from.x, y: from.y, angle: 0, vx: 0, vy: 0, av: 0, alt: 0 };
  for (let t = 0; t < seconds * 30; t++) {
    const dx = to.x - b.x, dy = to.y - b.y, d = Math.hypot(dx, dy);
    if (d < 0.3) break;
    stepFoot(b, { mx: dx / d, my: dy / d, throttle: 0, steer: 0, handbrake: false, sprint: false, aimAngle: null } as never, 4, 1 / 30, statics);
  }
  return { x: b.x, y: b.y };
}
const inRect = (p: { x: number; y: number }, r: { x0: number; y0: number; x1: number; y1: number }) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

let walkedIn = 0, reached = 0, walled = 0;
for (const i of city.interiors) {
  const door = i.place, c = i.counter;
  const [fx, fy] = DIR_VEC[city.lots[door.lot].front];
  // From outside the door: straight in through the gap, then over to the counter.
  const inside = walk(door, { x: door.x - fx * 2.6, y: door.y - fy * 2.6 });
  if (inRect(inside, i.room)) walkedIn++;
  const at = walk(inside, c);
  if (Math.hypot(at.x - c.x, at.y - c.y) < 1.2) reached++;
  // The other three sides are walls: a ray out from the middle of the room hits each before it leaves.
  const r = i.room, m = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
  const sides = DIR_VEC.filter(([x, y]) => x !== fx || y !== fy);
  if (sides.every(([x, y]) => statics.raycast(m.x, m.y, m.x + x * 40, m.y + y * 40, 1.0))) walled++;
}
check(walkedIn === city.interiors.length, `walk in through the door (${walkedIn}/${city.interiors.length})`);
check(reached >= city.interiors.length - 2, `reach the counter from the door (${reached}/${city.interiors.length})`);
check(walled === city.interiors.length, `walls on the other three sides (${walled}/${city.interiors.length})`);

// A car doesn't fit through the door gap (1.6 m): narrower than any car (motorbikes do fit).
const narrowest = Math.min(...VEHICLES.filter((v) => v.movement === 'wheels').map((v) => v.width));
check(1.6 < narrowest, `door gaps (1.6 m) keep cars out (narrowest car ${narrowest} m)`);

// Bullets: through the door a shot gets in (the walls are checked by the rays above).
const i0 = city.interiors[0];
const throughDoor = statics.raycast(i0.place.x, i0.place.y, (i0.place.x + i0.counter.x) / 2, (i0.place.y + i0.counter.y) / 2, 1);
check(!throughDoor, 'a shot through the door gets in');

// Doing business at the counter: the gun shop sells there.
const gs = city.interiors.find((i) => SERVICES[i.place.spec]?.verb === 'gunshop' && !i.property)!;
me.body.x = gs.counter.x; me.body.y = gs.counter.y;
pl.cash = 10000;
me.armor = 0;
check(room.econ.buy(pl, 'armor', '', gs.place.id) === null && me.armor === 100, 'buying armor at the gun shop counter');

// A clerk turns up behind the counter once a player is near.
me.body.x = gs.place.x; me.body.y = gs.place.y;
for (let t = 0; t < 30 * 3; t++) room.tick();
const clerk = [...w.peds.values()].find((p) => Math.hypot(p.body.x - gs.clerk.x, p.body.y - gs.clerk.y) < 1.5 && !p.player);
check(!!clerk, 'a clerk stands behind the counter');

console.log(failures ? `${failures} check(s) failed` : 'all interior checks passed');
process.exit(failures ? 1 : 0);
