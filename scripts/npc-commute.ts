import assert from 'node:assert/strict';
import { angleDiff } from '../src/shared/math';
import { lotLayout, BAY_WIDTH, DRIVE_WIDTH, BAY_DEPTH } from '../src/shared/world/parkingLayout';
import { parkedAngle, parkingFits, chooseCurb } from '../src/server/game/ai/parking';
import { RULES, VEHICLES, pedWith } from '../src/shared/packs';
import { World } from '../src/server/game/world';
import { spawnPed, removePed, spawnVehicle, seatPed } from '../src/server/game/factory';
import { ResidentPool } from '../src/server/game/residentPool';
import { laneOf } from '../src/server/game/ai/route';
import { destination, walkPosition } from '../src/server/game/ai/commute';
import { updateAi } from '../src/server/game/ai/brain';
import { updateNpcPeds, updateVehicles } from '../src/server/game/systems/movement';
import { roomAt } from '../src/server/game/ai/doors';
import type { Resident } from '../src/server/game/census';

const w = new World(RULES.citySeed);
const rows = new Set<number>();
for (const lot of w.city.lots.filter(l => l.use === 'parking')) {
  const a = lotLayout(lot);
  assert(a, 'every striped parcel has a street entrance');
  rows.add(a.rows);
  const bays = w.city.parking.filter(s => s.lot === lot.id);
  assert.equal(bays.length, a.rows * a.count);
  for (const bay of bays) {
    const dx = bay.x - a.x, dy = bay.y - a.y;
    const across = Math.abs(dx * a.fy - dy * a.fx);
    assert(Math.abs(across - (DRIVE_WIDTH + BAY_DEPTH) / 2) < 1e-6, 'bay leaves the aisle clear');
    assert(-(dx * a.fx + dy * a.fy) >= BAY_WIDTH / 2, 'bay lies inside its lot');
  }
}
assert.deepEqual(rows, new Set([1, 2]));
const place = w.city.interiors.find(i => i.clerkArch)!;
const goal = destination(w, place.place.lot);
const home = w.city.buildings.find(b => {
  const other = destination(w, b.lot);
  return other.street.id !== goal.street.id && Math.hypot(other.curb.x - goal.curb.x, other.curb.y - goal.curb.y) > 140 && Math.hypot(other.curb.x - goal.curb.x, other.curb.y - goal.curb.y) < 240;
})!;
const start = destination(w, home.lot);
const r: Resident = { id: 1, household: 1, job: { lot: goal.lot, start: 22 * 60, duration: 480 } };
const census = { addresses: [], households: [{ id: 1, lot: home.lot, unit: 1 }], residents: [r] };
w.gameMinutes = 23 * 60;
let pool = new ResidentPool(w, census);
let p = spawnPed(w, pedWith('civilian'), start.curb.x, start.curb.y);
pool.bind(r, p);
const tick = () => { w.time += 1 / 30; w.rebuildHashes(); updateAi(w, 1 / 30); updateNpcPeds(w, 1 / 30); };
for (let i = 0; i < 50; i++) tick();
pool.checkpoint(p);
assert(r.walk);
const check = walkPosition(w, r.walk)!;
assert(Math.hypot(p.body.x - check.x, p.body.y - check.y) < 0.001);
removePed(w, p);
w.gameMinutes += 2;
const advanced = walkPosition(w, r.walk)!;
assert(Math.hypot(check.x - advanced.x, check.y - advanced.y) > 0.3);
w.nearestPlayerDist2 = () => 1;
w.players.set(1, { } as never);
pool = new ResidentPool(w, census); // Rebuild the runtime indexes as a reopened room would.
pool.resumeWalks();
assert.equal(w.peds.size, 1);
p = [...w.peds.values()][0];
assert.equal(p.resident, r);
for (let i = 0; i < 18000 && p.arrivedAt !== goal.lot; i++) tick();
assert.equal(p.arrivedAt, goal.lot, 'worker reaches entrance');
assert.equal(roomAt(w, p.body.x, p.body.y), place, 'walks through door');
w.gameDay++; w.gameMinutes = 360;
pool.update();
assert.equal(p.commute?.lot, home.lot);
for (let i = 0; i < 18000 && p.arrivedAt !== home.lot; i++) tick();
assert.equal(p.arrivedAt, home.lot, 'walks home after overnight shift');


// Approach on the destination side from cruising speed, stop and finish the trip on foot.
const parkingStreet = goal.parkingStreet!;
const horizontal = parkingStreet.axis === 'h';
const direction = horizontal ? Math.sign(goal.pullOver.y - parkingStreet.y0) : -Math.sign(goal.pullOver.x - parkingStreet.x0);
const angle = horizontal ? (direction > 0 ? 0 : Math.PI) : direction * Math.PI / 2;
const vType = VEHICLES.findIndex(v => v.seats > 0 && v.maxSpeed > 10 && !v.siren && v.roles.includes('traffic'));
assert(vType >= 0);
{
  const lane = laneOf(w, parkingStreet, direction > 0 ? 1 : -1, parkingStreet.lanes - 1);
  const car = spawnVehicle(w, vType, horizontal ? goal.pullOver.x - lane.hx * 15 : lane.sx,
    horizontal ? lane.sy : goal.pullOver.y - lane.hy * 15, angle, -1, { owner: 'house:' + r.household });
  r.commuteVin = car.vin;
  car.body.vx = 4 * Math.cos(angle); car.body.vy = 4 * Math.sin(angle);
  seatPed(w, p, car, 0);
  w.gameMinutes = 1380;
  pool.update();
  for (let i = 0; i < 1500 && p.vehicle; i++) { tick(); updateVehicles(w, 1 / 30); }
  assert.equal(p.vehicle, 0, 'driver stops and gets out at the destination curb');
  const bay = w.city.parking[w.registry.parkingIndex(car.body.x, car.body.y)!];
  assert(bay, 'vehicle finishes centered in its chosen bay');
  assert(goal.publicLot && bay.lot === goal.publicLot.bays[0].spot.lot, 'worker uses the public lot near the job');
  assert(Math.abs(angleDiff(car.body.angle, bay.angle)) <= 0.051, 'driver straightens before leaving the car');
  assert.equal(parkedAngle('00000001', 0.3, 0), 0);
  assert.equal(parkedAngle('00000008', 0.3, 0), 0.05);
  for (let i = 0; i < 3600 && p.arrivedAt !== goal.lot; i++) tick();
  assert.equal(p.arrivedAt, goal.lot);
  w.gameMinutes = 10 * 60;
  for (let i = 0; i < 9000; i++) {
    if (i % 15 === 0) pool.update();
    tick(); updateVehicles(w, 1 / 30);
    if (p.vehicle === car.id && car.departureBay === undefined && w.map.onRoad(car.body.x, car.body.y)) break;
  }
  assert.equal(p.vehicle, car.id, 'worker collects the same car after the shift');
  assert.equal(car.departureBay, undefined);
  assert(w.map.onRoad(car.body.x, car.body.y), 'worker drives out onto the street');
}

console.log('Multi-street overnight round trip, checkpoint resumption, and street-to-stall-to-work return trip passed.');

{
  const street = w.city.segs.find(s => s.parking && s.axis === 'h' && s.x1 - s.x0 > 90)!;
  const angle = 0;
  const car = spawnVehicle(w, vType, street.x0 + 30, street.y0 + 1.8, angle);
  const curbGoal = { ...goal, pullOver: { x: car.body.x + 20, y: car.body.y } };
  const preferred = chooseCurb(w, car, curbGoal)!;
  assert(preferred, 'a driver can approach the nearest open bay');
  spawnVehicle(w, vType, preferred.x, preferred.y, preferred.angle);
  assert(!parkingFits(w, car.spec, preferred, car), 'a just-spawned car occupies its full space before the next hash rebuild');
  const alternate = chooseCurb(w, car, curbGoal)!;
  assert(alternate && Math.hypot(alternate.x - preferred.x, alternate.y - preferred.y) > car.spec.length);
  car.parkingTarget = alternate;
  const queued = spawnVehicle(w, vType, car.body.x - Math.cos(angle) * 7, car.body.y - Math.sin(angle) * 7, angle);
  assert(!parkingFits(w, queued.spec, alternate, queued), 'a second driver cannot take a claimed bay');
}

// Start with the generated household fleet. Follow one VIN through an unseen shift,
// a save/reload, and a visible departure where the worker must collect it themselves.
{
  const { createCensus, scheduledLot } = await import('../src/server/game/census');
  const { HouseholdParking } = await import('../src/server/game/householdParking');
  const { buildingAccess } = await import('../src/server/game/ai/commute');
  const city = new World(RULES.citySeed);
  const roster = createCensus(city.city, city.seed);
  city.gameMinutes = 180;
  city.registry.setCensus(roster);
  const fleet = new HouseholdParking(city, roster);
  const drivers = [...fleet.driverByVin.values()];
  assert(drivers.length > 0);
  const saved = city.registry.save();
  assert.equal(new Set(saved.map(v => v.slot)).size, saved.length);
  for (const person of drivers) {
    const v = city.registry.find(person.commuteVin!)!;
    const door = buildingAccess(city, person.occupiedLot!).entrance;
    assert.equal(v.owner, 'house:' + person.household);
    assert(Math.hypot(v.at.x - door.x, v.at.y - door.y) <= 75);
  }
  // Old saves use numeric bay IDs. Keep the physical location and owner if the
  // same bay moved in the generated array, and rehome cars whose bay disappeared.
  const [old, shifted] = structuredClone(saved.slice(0, 2));
  old.slot = shifted.slot = 'parking:999999';
  old.at.x += 2.13;
  const restored = new World(city.seed);
  restored.registry.load([old, shifted]);
  for (const car of [old, shifted]) {
    const index = restored.registry.parkingIndex(car.at.x, car.at.y);
    assert(index !== undefined && restored.registry.atSlot('parking:' + index)?.vin === car.vin);
  }
  assert.notEqual(old.slot, shifted.slot);
  const worker = drivers.find(person => {
    const job = person.job!;
    return !buildingAccess(city, job.lot).indoors && scheduledLot(roster, person, city.gameMinutes) !== job.lot;
  })!;
  const vin = worker.commuteVin!;
  const original = city.registry.find(vin)!;
  const oldSlot = original.slot;
  original.taken = true;
  assert.equal(fleet.park(original, worker.job!.lot), false);
  assert.equal(original.slot, oldSlot);
  original.taken = false;
  const manager = new ResidentPool(city, roster, fleet);
  city.gameMinutes = worker.job!.start;
  manager.update();
  assert.equal(worker.occupiedLot, worker.job!.lot);
  assert.notEqual(city.registry.find(vin)!.slot, oldSlot);
  const reopened = new World(city.seed);
  reopened.gameMinutes = city.gameMinutes;
  reopened.registry.load(structuredClone(city.registry.save()));
  reopened.registry.setCensus(roster);
  const fleet2 = new HouseholdParking(reopened, roster);
  assert.equal(reopened.registry.find(vin)!.slot, city.registry.find(vin)!.slot);
  // Simulate an older save whose owner streamed out on the walk from curb to door.
  delete worker.occupiedLot;
  delete reopened.registry.find(vin)!.parkedLot;
  const manager2 = new ResidentPool(reopened, roster, fleet2);
  const car = reopened.registry.find(vin)!;
  const origin = { ...car.at };
  reopened.gameMinutes = (worker.job!.start + worker.job!.duration) % 1440;
  // Only this origin is observed, as in a player waiting outside the workplace.
  reopened.nearestPlayerDist2 = (x, y) => (origin.x - x) ** 2 + (origin.y - y) ** 2;
  reopened.players.set(1, {} as never);
  reopened.registry.show(car);
  for (let i = 0; i < RULES.pedCapPerPlayer; i++) {
    const staff = spawnPed(reopened, pedWith('civilian'), 0, 0);
    staff.persistent = true;
    staff.ai = null;
  }
  for (let frame = 0; frame < 5400; frame++) {
    reopened.time += 1 / 30;
    reopened.gameMinutes = (reopened.gameMinutes + RULES.gameMinutesPerSecond / 30) % 1440;
    reopened.rebuildHashes();
    if (frame % 15 === 0) manager2.update();
    updateAi(reopened, 1 / 30); updateNpcPeds(reopened, 1 / 30); updateVehicles(reopened, 1 / 30);
    const v = reopened.registry.liveVehicle(vin);
    if (v?.seats[0] && Math.hypot(v.body.x - origin.x, v.body.y - origin.y) > 8) break;
  }
  const departed = reopened.registry.liveVehicle(vin)!;
  assert.equal(reopened.peds.get(departed?.seats[0])?.resident?.id, worker.id);
  assert(Math.hypot(departed.body.x - origin.x, departed.body.y - origin.y) > 8);
  console.log(drivers.length + ' household cars checked. Offscreen shift, VIN reload and visible return departure passed.');
}
