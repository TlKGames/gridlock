import assert from 'node:assert/strict';
import { parkingFits, chooseCurb } from '../src/server/game/ai/parking';
import { RULES, VEHICLES, pedWith } from '../src/shared/packs';
import { World } from '../src/server/game/world';
import { spawnPed, removePed, spawnVehicle, seatPed } from '../src/server/game/factory';
import { ResidentPool } from '../src/server/game/residentPool';
import { destination, walkPosition } from '../src/server/game/ai/commute';
import { updateAi } from '../src/server/game/ai/brain';
import { updateNpcPeds, updateVehicles } from '../src/server/game/systems/movement';
import { roomAt } from '../src/server/game/ai/doors';
import type { Resident } from '../src/server/game/census';

const w = new World(RULES.citySeed);
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
  const car = spawnVehicle(w, vType, goal.pullOver.x - Math.cos(angle) * 15, goal.pullOver.y - Math.sin(angle) * 15, angle);
  car.body.vx = 4 * Math.cos(angle); car.body.vy = 4 * Math.sin(angle);
  seatPed(w, p, car, 0);
  w.gameMinutes = 1380;
  pool.update();
  for (let i = 0; i < 1500 && p.vehicle; i++) { tick(); updateVehicles(w, 1 / 30); }
  assert.equal(p.vehicle, 0, 'driver stops and gets out at the destination curb');
  for (let i = 0; i < 3600 && p.arrivedAt !== goal.lot; i++) tick();
  assert.equal(p.arrivedAt, goal.lot);
}

console.log('Multi-street overnight round trip, checkpoint resumption, and curb-to-door arrival passed.');

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
