import assert from 'node:assert/strict';
import { pedIndex, vehicleIndex } from '../src/shared/packs';
import { stepVehicle } from '../src/shared/sim/physics';
import { cruise, newDrive } from '../src/server/game/ai/driving';
import { mayEnter, commitJunction } from '../src/server/game/ai/junctions';
import { laneOf } from '../src/server/game/ai/route';
import { seatPed, spawnPed, spawnVehicle } from '../src/server/game/factory';
import { Room } from '../src/server/room';

process.env.GRIDLOCK_DATA = 'data-smoke/npc-driving';
const room = new Room('LANE', 1337);
room.stop();
const w = room.world;
const seg = w.city.segs.find(s => s.lanes > 1 && s.axis === 'h' && s.x1 - s.x0 > 90)!;
const lane = laneOf(w, seg, 1, 1);
function driver(x: number, y: number, angle: number) {
  const car = spawnVehicle(w, vehicleIndex('sedan'), x, y, angle);
  const ped = spawnPed(w, pedIndex('civilian'), x, y);
  seatPed(w, ped, car, 0);
  return { car, ped };
}
const { car, ped } = driver(lane.sx + 10, lane.sy + 0.9, 0);
const d = newDrive(w, car);
assert.equal(d.lane, 1, 'start in the occupied outer lane');
ped.ai!.drive = d;
car.body.vx = 16.2;
let brakeTicks = 0;
for (let i = 0; i < 45; i++) {
  w.rebuildHashes();
  cruise(w, car, ped, 1/30);
  if (car.ctl.throttle < 0 || car.ctl.handbrake) brakeTicks++;
  stepVehicle(car.body, car.spec, car.ctl, 1/30, w.statics, true);
}
assert(Math.abs(car.body.y - lane.sy) < 0.35, 'recover lane centre before the next junction');
assert.equal(brakeTicks, 0, 'a slight cruise overshoot needs no brake lights');

// A stopped driver ahead stays in the queue longer than the old forced-pass timer.
const lead = driver(car.body.x + 22, lane.sy, 0);
let heldTicks = 0;
for (let i = 0; i < 600; i++) {
  w.time += 1 / 30;
  w.rebuildHashes();
  cruise(w, car, ped, 1 / 30);
  stepVehicle(car.body, car.spec, car.ctl, 1 / 30, w.statics, true);
  assert.equal(d.reverseT, 0);
  assert.equal(d.bypassT, 0);
  if (i >= 570 && car.ctl.handbrake) heldTicks++;
}
assert(lead.car.body.x - car.body.x > car.spec.length, 'stop behind the leader');
assert.equal(heldTicks, 30, 'steady brake lights at a stop');
w.vehicles.clear();
const node = lane.to;
node.lights = false;
const first = driver(node.x - node.wv/2 - 4, node.y + 1.8, 0).car;
const later = driver(node.x - 1.8, node.y - node.wh/2 - 3, Math.PI/2).car;
w.rebuildHashes();
mayEnter(w, first, node, 'h', null);
w.time += 0.25;
assert(!mayEnter(w, later, node, 'v', null), 'yield to the earlier arrival even when it is stopped');
assert(mayEnter(w, first, node, 'h', null));
commitJunction(w, first, node);
assert(!mayEnter(w, later, node, 'v', null), 'protect the gap from stop line to junction');
w.vehicles.delete(first.id);
w.rebuildHashes();
assert(mayEnter(w, later, node, 'v', null), 'next driver goes once clear');
console.log('NPC lane tracking, cruise braking and junction order passed');
