// Headless checks of boats: moored along the river and the coast where you can step down into them
// from the bank, they drive on water only (land is a wall, they go under bridges without touching
// the traffic on them), they float where a car sinks, and you can only get out at the shore.
// `npx tsx scripts/boats.ts`
export {};
process.env.GRIDLOCK_DATA = 'data-smoke/boats';
const { Room } = await import('../src/server/room');
const { RULES, VEHICLES, vehicleIndex } = await import('../src/shared/packs');
const { BTN, Mode } = await import('../src/shared/protocol');
const { seatPed, spawnVehicle } = await import('../src/server/game/factory');
const { mooredBoats } = await import('../src/server/game/systems/moorings');
const { DOCK_DEPTH, moorings } = await import('../src/shared/world/moorings');
const { Breakables } = await import('../src/shared/world/breakables');
const { afloat } = await import('../src/shared/sim/boat');

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const room = new Room('BOAT', RULES.citySeed);
room.stop();
const msgs: { t: string; [k: string]: unknown }[] = [];
const pl = room.join('Skipper', { send: (s: string) => msgs.push(JSON.parse(s)), close: () => {} });
if (typeof pl === 'string') throw new Error(pl);
room.stop();
const w = room.world;
const p = w.peds.get(pl.pid)!;
let seq = 1;
/** Ticks with the player's controls held: [throttle, steer, buttons]. */
const drive = (n: number, throttle = 0, steer = 0, btn = 0) => {
  for (let i = 0; i < n; i++) { pl.queue.push([seq++, 0, 0, throttle, steer, 0, i === 0 ? btn : btn & ~BTN.enter, -1]); p.hp = Math.max(p.hp, 1); room.tick(); }
};

// Moorings: enough of them, every boat afloat, firm ground beside each.
const moored = mooredBoats(w);
const kinds = new Set(moored.map((m) => VEHICLES[m.type].id));
check(moored.length >= 8, `${moored.length} moorings along the river and the coast (${[...kinds].join(', ')})`);
check(moored.every((m) => afloat({ x: m.x, y: m.y, angle: m.angle, vx: 0, vy: 0, av: 0, alt: 0 }, VEHICLES[m.type], w.statics)), 'every moored boat is afloat');

// Walk up to one on the river and the boat is there when you arrive.
const river = w.map.river!; // Bayhaven has its river
const m = moored.find((q) => q.y > river.y0 - 5 && q.y < river.y1 + 5)!;
const sign = m.y < (river.y0 + river.y1) / 2 ? 1 : -1;
const bankY = (sign > 0 ? river.y0 : river.y1) + sign * (DOCK_DEPTH - 0.45);
check(new Breakables(w.city).list.every(p => !w.map.isWater(p.x, p.y)), 'all street furniture stands on dry ground');
check(moorings(w.city).every(site => {
  for (let d = -0.4; d < DOCK_DEPTH; d += 0.25) {
    const x = site.x + site.nx * d, y = site.y + site.ny * d;
    if (w.map.isWater(x, y) || w.statics.boatWater(x, y)) return false;
  }
  return true;
}), 'all docks connect to dry land and exclude hulls across their decks');
p.body.x = m.x; p.body.y = bankY + (m.y < (river.y0 + river.y1) / 2 ? -80 : 80);
drive(40);
p.body.x = m.x; p.body.y = bankY;
drive(3);
const boat = [...w.vehicles.values()].find((v) => v.spec.movement === 'boat' && Math.hypot(v.body.x - m.x, v.body.y - m.y) < 3);
check(!!boat, `a ${boat?.spec.name ?? 'boat'} lies moored at the bank`);
if (!boat) { console.log(`${failures} check(s) failed`); process.exit(1); }

// Step down into it from the bank.
drive(1, 0, 0, BTN.enter);
check(p.vehicle === boat.id, 'step down into it from the bank (the action key)');
pl.mode = Mode.Driver;
// Getting out at the bank puts you back on dry ground.
drive(1, 0, 0, BTN.enter);
check(!p.vehicle && !w.map.isWater(p.body.x, p.body.y), 'getting out beside the bank: back on dry ground');
drive(1, 0, 0, BTN.enter);
check(p.vehicle === boat.id, 'and back in');
pl.mode = Mode.Driver;

// Out into the river and along it: open water, so no getting out; it floats.
const away = boat.body.y < (river.y0 + river.y1) / 2 ? 1 : -1;
boat.body.angle = away > 0 ? Math.PI / 2 : -Math.PI / 2;
drive(25, 0.6);
boat.body.angle = 0; boat.body.vx = 0; boat.body.vy = 0;
drive(60, 1);
check(Math.hypot(boat.body.vx, boat.body.vy) > 8 && w.statics.boatWater(boat.body.x, boat.body.y),`under way on the river at ${Math.hypot(boat.body.vx, boat.body.vy).toFixed(1)} m/s`);
drive(20, 0, 0, 0);
drive(1, 0, 0, BTN.enter);
check(p.vehicle === boat.id, 'out on open water you can\'t get out');
check(boat.sinkT === 0 && w.vehicles.has(boat.id), 'it floats (a car would be sinking)');

// The bank is a wall: steer straight at it and it stops at the edge, still afloat.
boat.body.angle = away > 0 ? -Math.PI / 2 : Math.PI / 2; boat.body.vx = 0; boat.body.vy = 0;
drive(120, 1);
check(afloat(boat.body, boat.spec, w.statics) && w.statics.boatWater(boat.body.x, boat.body.y),
  `driven at the bank, it runs aground against it and stays in the water (y ${boat.body.y.toFixed(1)}, banks ${river.y0.toFixed(1)}..${river.y1.toFixed(1)}, angle ${boat.body.angle.toFixed(2)})`);

// Under a bridge: through it along the river, without touching a car parked on the deck.
const br = w.city.bridges[0];
const car = spawnVehicle(w, vehicleIndex('sedan'), (br.x0 + br.x1) / 2, (br.y0 + br.y1) / 2, Math.PI / 2);
boat.body.x = br.x0 - 30; boat.body.y = (river.y0 + river.y1) / 2; boat.body.angle = 0; boat.body.vx = 6; boat.body.vy = 0;
const carAt = { x: car.body.x, y: car.body.y };
drive(150, 0.7);
check(boat.body.x > br.x1 + 5, `goes under the bridge (x ${boat.body.x.toFixed(0)} past ${br.x1.toFixed(0)})`);
check(Math.hypot(car.body.x - carAt.x, car.body.y - carAt.y) < 0.1 && boat.hp === boat.spec.hp, 'and never touches the car on the deck');

// A car driven into the river sinks; the boat beside it doesn't.
const sinker = spawnVehicle(w, vehicleIndex('sedan'), boat.body.x + 15, boat.body.y, 0);
drive(30 * 4);
check(!w.vehicles.has(sinker.id) && w.vehicles.has(boat.id), 'a car in the river sinks; the boat floats on');

// Coast back to the bank and get out.
seatPed(w, p, boat, 0);
boat.body.x = m.x; boat.body.y = m.y; boat.body.angle = m.angle; boat.body.vx = 0; boat.body.vy = 0;
drive(1, 0, 0, BTN.enter);
check(!p.vehicle && !w.map.isWater(p.body.x, p.body.y), 'pulled up at the bank: out onto dry ground');

console.log(failures ? `${failures} check(s) failed` : 'all boat checks passed');
process.exit(failures ? 1 : 0);
