import assert from 'node:assert/strict';
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
const horizontal = goal.street.axis === 'h';
const direction = horizontal ? Math.sign(goal.curb.y - goal.street.y0) : -Math.sign(goal.curb.x - goal.street.x0);
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
