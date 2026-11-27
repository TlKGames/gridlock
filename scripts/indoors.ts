// Headless check that police can't be shaken off by stepping into a shop: on foot they go in through
// the door (and back out after you), a patrol car drives to the door and its crew goes in, and they
// follow you up a tower's lift. `npx tsx scripts/indoors.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/indoors';
const { Room } = await import('../src/server/room');
const { RULES, SERVICES, pedIndex, vehicleIndex } = await import('../src/shared/packs');
const { spawnPed, spawnVehicle, seatPed } = await import('../src/server/game/factory');
const { setTask } = await import('../src/server/game/ai/tasks');
const { doorOf, roomAt, streetGoal } = await import('../src/server/game/ai/doors');
const { floorOf, groundOf } = await import('../src/shared/world/levels');
type Ped = import('../src/server/game/entities').Ped;

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const room = new Room('INDR', RULES.citySeed);
room.stop();
const joined = room.join('Suspect', { send: () => {}, close: () => {} });
if (typeof joined === 'string') throw new Error(joined);
const pl = joined;
room.stop();
const w = room.world;
const me = w.peds.get(pl.pid)!;
const city = w.city;

const shop = city.interiors.find((i) => SERVICES[i.place.spec]?.verb === 'gunshop' && !i.property)!;
const door = doorOf(w, shop);
/** A spot on the pavement: `out` metres out from the door, `along` metres along the frontage. */
const pavement = (out: number, along: number) => ({ x: door.x + door.fx * out - door.fy * along, y: door.y + door.fy * out + door.fx * along });

/** Runs until `done` or the time's up, keeping the suspect wanted (and not yet busted). */
function chase(seconds: number, done: () => boolean): number {
  for (let t = 0; t < seconds * 30; t++) {
    pl.wanted = Math.max(pl.wanted, 1); pl.heat = Math.max(pl.heat, 30); pl.bustT = 0;
    room.tick();
    if (done()) return t / 30;
  }
  return -1;
}
const near = (c: Ped, m: number) => {
  const a = groundOf(c.body.x, c.body.y), b = groundOf(me.body.x, me.body.y);
  return a.f === b.f && Math.hypot(a.x - b.x, a.y - b.y) < m;
};
const clearCops = () => { for (const p of [...w.peds.values()]) if (!p.player && p.spec.id === 'cop' && !p.vehicle) w.peds.delete(p.id); };

// 1. On foot, in from the street: the suspect stands at the gun shop's counter.
me.body.x = shop.counter.x; me.body.y = shop.counter.y;
const start1 = pavement(3, 12);
const cop = spawnPed(w, pedIndex('cop'), start1.x, start1.y, 0);
setTask(cop, 'arrest', me.id);
let t = chase(25, () => near(cop, 1.8));
check(t >= 0 && roomAt(w, cop.body.x, cop.body.y) === shop, `a cop walks in through the door and reaches you (${t.toFixed(1)} s)`);

// 2. Out again after you: the suspect is back on the street, the cop inside.
clearCops();
const cop2 = spawnPed(w, pedIndex('cop'), shop.counter.x, shop.counter.y, 0);
const away = pavement(3, -12);
me.body.x = away.x; me.body.y = away.y;
setTask(cop2, 'arrest', me.id);
t = chase(25, () => near(cop2, 1.8));
check(t >= 0 && !roomAt(w, cop2.body.x, cop2.body.y), `a cop inside follows you back out (${t.toFixed(1)} s)`);

// 3. A patrol car: it drives to the door, the crew gets out and goes in.
clearCops();
me.body.x = shop.counter.x; me.body.y = shop.counter.y;
const outside = pavement(4, 0);
const node = w.map.nearestNode(outside.x + door.fx * 40 - door.fy * 40, outside.y + door.fy * 40 + door.fx * 40);
const car = spawnVehicle(w, vehicleIndex('police'), node.x, node.y, 0);
const driver = spawnPed(w, pedIndex('cop'), node.x, node.y, 0);
seatPed(w, driver, car, 0);
setTask(driver, 'pursue', me.id);
t = chase(60, () => !driver.vehicle && roomAt(w, driver.body.x, driver.body.y) === shop);
check(t >= 0, `the assigned patrol driver enters the shop (${t.toFixed(1)} s)`);
const parked = Math.hypot(car.body.x - outside.x, car.body.y - outside.y);
check(parked < 15 && Math.hypot(car.body.vx, car.body.vy) < 1, `the car stopped outside the door (${parked.toFixed(1)} m away), not against the wall behind you`);

// 4. Up a tower: the suspect is on floor 2, the cop in the street.
clearCops();
for (const v of [...w.vehicles.values()]) if (v.id === car.id) w.vehicles.delete(v.id);
const tower = city.interiors.find((i) => i.layout === 'tower' && i.floors.length >= 2)!;
const fl = tower.floors[1];
me.body.x = (fl.rect.x0 + fl.rect.x1) / 2; me.body.y = (fl.rect.y0 + fl.rect.y1) / 2;
const street = streetGoal(w, tower.counter.x, tower.counter.y);
const cop4 = spawnPed(w, pedIndex('cop'), street.x + 5, street.y + 5, 0);
setTask(cop4, 'arrest', me.id);
t = chase(45, () => near(cop4, 2));
check(t >= 0 && floorOf(cop4.body.x) === 2, `a cop follows you up the tower to floor 2 (${t.toFixed(1)} s)`);

console.log(failures ? `${failures} check(s) failed` : 'all indoor chase checks passed');
process.exit(failures ? 1 : 0);
