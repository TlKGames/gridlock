import assert from 'node:assert/strict';
import { pedIndex, RULES, vehicleIndex } from '../src/shared/packs';
import { stepFoot } from '../src/shared/sim/physics';
import { LANE_W } from '../src/shared/world/cityTypes';
import { doorOf } from '../src/server/game/ai/doors';
import { mayEnter } from '../src/server/game/ai/junctions';
import { onNoise } from '../src/server/game/ai/reactions';
import { laneOf } from '../src/server/game/ai/route';
import { arrest, revive, setTask } from '../src/server/game/ai/tasks';
import { seatPed, spawnPed, spawnVehicle } from '../src/server/game/factory';
import { Room } from '../src/server/room';

process.env.GRIDLOCK_DATA = 'data-smoke/npc-interactions';
const room = new Room('NPCI', RULES.citySeed);
const pl = room.join('Suspect', { send() {}, close() {} });
room.stop();
if (typeof pl === 'string') throw new Error(pl);
const w = room.world, me = w.peds.get(pl.pid)!;
const apartment = w.city.interiors.find(i => i.layout === 'apartments')!;
const door = doorOf(w, apartment);
const spot = (out: number, along = 0) => ({
  x: door.x + out * door.fx - along * door.fy,
  y: door.y + out * door.fy + along * door.fx,
});
const dt = 1 / 30;
const officer = spawnPed(w, pedIndex('cop'), 0, 0);
Object.assign(officer.body, spot(0.55, 2));
Object.assign(me.body, spot(-0.75, 2));
pl.wanted = 1;
setTask(officer, 'arrest', me.id);
arrest(w, officer, dt);
assert.equal(pl.bustT, 0, 'a wall prevents arrest at arm’s length');
assert(Math.hypot(officer.ctl.mx, officer.ctl.my) > 0, 'keep walking toward the door');
Object.assign(officer.body, spot(-0.8, 1));
arrest(w, officer, dt);
assert(pl.bustT > 0, 'an officer beside the suspect can arrest');

const medic = spawnPed(w, pedIndex('paramedic'), 0, 0);
Object.assign(medic.body, spot(1.6, 0.8));
const patient = spawnPed(w, pedIndex('tourist'), 0, 0);
Object.assign(patient.body, spot(-3));
patient.dead = true;
setTask(medic, 'revive', patient.id);
for (let tick = 0; tick < 100; tick++) revive(w, medic, dt);
assert.equal(medic.ai!.workT, 0, 'a doorway waypoint cannot start treatment');
Object.assign(medic.body, spot(0.55, 2));
Object.assign(patient.body, spot(-0.75, 2));
revive(w, medic, dt);
assert.equal(medic.ai!.workT, 0, 'a nearby patient behind a wall is unreachable');
Object.assign(patient.body, spot(-3));
for (let tick = 0; tick < 450 && patient.dead; tick++) {
  revive(w, medic, dt);
  stepFoot(medic.body, medic.ctl, medic.spec.runSpeed, dt, w.statics);
}
assert(patient.revived && Math.hypot(medic.body.x - patient.body.x, medic.body.y - patient.body.y) <= 1.3,
  'medic walks through the door and treats the patient at their side');

w.vehicles.clear();
for (const axis of ['h', 'v'] as const) {
  const seg = w.city.segs.find(s => s.axis === axis && s.lanes > 1 && w.city.nodes[s.a].segs.length >= 3)!;
  const L = laneOf(w, seg, 1, 0), node = w.city.nodes[seg.a];
  const angle = Math.atan2(L.hy, L.hx);
  const car = spawnVehicle(w, vehicleIndex('sedan'), node.x - 22 * L.hx, node.y - 22 * L.hy, angle);
  const other = spawnVehicle(w, vehicleIndex('sedan'), L.sx + 3 * L.hx - L.hy * LANE_W, L.sy + 3 * L.hy + L.hx * LANE_W, angle);
  const enter = () => { w.rebuildHashes(); return mayEnter(w, car, node, axis, { x: L.sx, y: L.sy }); };
  assert(enter(), 'stopped car in the adjacent lane leaves this exit clear');
  other.body.angle += Math.PI / 2;
  other.body.x += L.hy * 0.6; other.body.y -= L.hx * 0.6;
  assert(!enter(), 'a car protruding sideways into the exit still blocks it');
  other.body.x -= L.hy * 0.6; other.body.y += L.hx * 0.6;
  other.body.angle = angle;
  other.body.x += L.hy * LANE_W; other.body.y -= L.hx * LANE_W;
  assert(!enter(), 'a queue in the chosen lane blocks entry');
  w.vehicles.clear();
}

const car = spawnVehicle(w, vehicleIndex('sedan'), door.x, door.y, 0);
const driver = spawnPed(w, pedIndex('tourist'), door.x, door.y);
seatPed(w, driver, car, 0);
w.rebuildHashes();
onNoise(w, car.body.x + 20, car.body.y, 45, me.id, false);
assert.equal(driver.ai!.panicT, 0, 'distant gunfire');
onNoise(w, car.body.x + 4, car.body.y, 45, me.id, false);
assert.equal(driver.ai!.panicT, 3, 'nearby gunfire');
onNoise(w, car.body.x + 4, car.body.y, 45, me.id, true);
onNoise(w, car.body.x + 4, car.body.y, 45, me.id, false);
assert.equal(driver.ai!.panicT, 6, 'gunfire preserves a stronger panic response');
console.log('NPC arrests, paramedic treatment, lane clearance and gunfire reactions passed');
