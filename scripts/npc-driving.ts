import assert from 'node:assert/strict';
import { obbVsObb } from '../src/shared/sim/dynamic';
import { pedIndex, vehicleIndex, weaponIndex } from '../src/shared/packs';
import { stepVehicle } from '../src/shared/sim/physics';
import { cruise, newDrive } from '../src/server/game/ai/driving';
import { mayEnter, commitJunction, nextJunction } from '../src/server/game/ai/junctions';
import { laneOf } from '../src/server/game/ai/route';
import { giveWeapon, removeVehicle, seatPed, spawnPed, spawnVehicle } from '../src/server/game/factory';
import { tryFire } from '../src/server/game/combat/fire';
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

// A blocked outbound lane must not give its waiting driver a veto on the cross street.
w.vehicles.set(first.id, first);
const exit = { x: node.x + node.wv / 2 + 1, y: node.y + 1.8 };
const jam = spawnVehicle(w, first.type, exit.x + 2, exit.y, 0);
w.rebuildHashes();
w.time += 3;
assert(!mayEnter(w, first, node, 'h', exit));
assert(mayEnter(w, later, node, 'v', null), 'cross traffic can leave while the first exit is full');
w.vehicles.delete(jam.id);
w.rebuildHashes();
w.time += 0.25;
assert(!mayEnter(w, first, node, 'h', exit), 'a newly clear approach rejoins behind the waiting driver');

assert(mayEnter(w, first, node, 'h', exit, true), 'a frightened driver takes a clear opening ahead of uncommitted traffic');
assert(!mayEnter(w, later, node, 'v', null), 'the other driver yields to the escaping car');
commitJunction(w, later, node);
assert(!mayEnter(w, first, node, 'h', exit, true), 'panic still respects a committed crossing');

// After unloading, an NPC-owned traffic car retains its VIN without becoming a driverless lane obstruction.
const traffic = driver(lane.sx + 28, lane.sy, 0);
const registration = w.registry.get(traffic.car)!;
traffic.car.authorizedDriver = traffic.ped.id;
w.registry.drive(traffic.ped, traffic.car);
removeVehicle(w, traffic.car, true);
const parked = w.registry.show(registration);
assert.equal(parked.vin, traffic.car.vin);
assert(registration.slot?.startsWith('parking:'));
assert.deepEqual(registration.parked, registration.at);
assert(Math.hypot(parked.body.x - traffic.car.body.x, parked.body.y - traffic.car.body.y) > 1);

// Tick a queue on both sides plus cross traffic from rest through a real four-way junction.
w.vehicles.clear(); w.peds.clear();
const four = w.city.nodes.find(n => n.segs.length === 4 && !n.lights)!;
const queues = four.segs.flatMap(id => {
  const seg = w.city.segs[id];
  const dir = seg.b === four.id ? 1 : -1;
  const l = laneOf(w, seg, dir, 0);
  return [4, 12].map(back => {
    const pair = driver(l.ex - l.hx * back, l.ey - l.hy * back, Math.atan2(l.hy, l.hx));
    return { ...pair, crossed: false };
  });
});
for (let tick = 0; tick < 30 * 45; tick++) {
  w.time += 1/30;
  w.rebuildHashes();
  for (const q of queues) {
    cruise(w, q.car, q.ped, 1/30);
    stepVehicle(q.car.body, q.car.spec, q.car.ctl, 1/30, w.statics, true);
    if (Math.abs(q.car.body.x - four.x) < four.wv/2 && Math.abs(q.car.body.y - four.y) < four.wh/2) q.crossed = true;
  }
}
assert(queues.every(q => q.crossed), 'all eight drivers get a turn through the intersection');

w.vehicles.clear(); w.peds.clear();
const target = driver(lane.sx + 40, lane.sy, 0);
const shooter = spawnPed(w, pedIndex('civilian'), target.car.body.x - 22, lane.sy);
shooter.wi = giveWeapon(shooter, weaponIndex('pistol'), 20);
shooter.trigger = true; shooter.aim = 0;
w.rebuildHashes();
tryFire(w, shooter);
assert(target.car.hp < target.car.spec.hp && target.ped.ai!.panicT > 0, 'a direct hit spooks a driver beyond the close gunfire radius');
cruise(w, target.car, target.ped, 1/30, true);
assert(target.car.ctl.throttle > 0 && !target.car.ctl.handbrake, 'the driver accelerates with a clear escape lane');
console.log('Blocked exits, restored traffic, four-way queues and driver gunfire reactions passed');

// A crooked parked car narrows a one-lane approach. A queue can pass inside
// its lane, and the parked car stays where the owner left it.
w.vehicles.clear(); w.peds.clear();
const narrow = w.city.segs.find(s => s.parking && s.axis === 'h' && s.x1 - s.x0 > 110)!;
const travel = laneOf(w, narrow, 1, 0);
const nose = spawnVehicle(w, vehicleIndex('sedan'), travel.sx + 45, travel.sy + 2.2, -0.33);
const line = [28, 18, 8].map(offset => driver(travel.sx + offset, travel.sy, 0));
for (let tick = 0; tick < 900 && line.some(q => q.car.body.x < nose.body.x + 6); tick++) {
  w.time += 1/30; w.rebuildHashes();
  for (const q of line) {
    cruise(w, q.car, q.ped, 1/30);
    stepVehicle(q.car.body, q.car.spec, q.car.ctl, 1/30, w.statics, true);
    assert(!obbVsObb({ ...nose.body, hl: nose.spec.length/2, hw: nose.spec.width/2 },
      { ...q.car.body, hl: q.car.spec.length/2, hw: q.car.spec.width/2 }), 'pass the protruding car without contact');
  }
}
assert(line.every(q => q.car.body.x > nose.body.x + 5), 'the whole queue advances past the crooked car');

// Leave a stationary car in the selected exit for the entire test. The lead
// driver must pick a free, legal exit without waiting for that car to disappear.
w.vehicles.clear(); w.peds.clear();
const ingress = w.city.segs[four.segs.find(id => w.city.segs[id].lanes === 1)!];
const approach = laneOf(w, ingress, ingress.b === four.id ? 1 : -1, 0);
const front = driver(approach.ex - approach.hx * 4, approach.ey - approach.hy * 4, Math.atan2(approach.hy, approach.hx));
w.rebuildHashes();
cruise(w, front.car, front.ped, 1/30);
const exitPoint = nextJunction(w, front.ped.ai!.drive!)!.exit!;
const outgoing = w.map.nearestSegment(exitPoint.x, exitPoint.y).seg;
const heading = laneOf(w, outgoing, outgoing.a === four.id ? 1 : -1, 0);
spawnVehicle(w, front.car.type, exitPoint.x + heading.hx * 2, exitPoint.y + heading.hy * 2, Math.atan2(heading.hy, heading.hx));
let entered = false, cleared = false;
for (let i = 0; i < 30 * 50 && !cleared; i++) {
  w.time += 1/30; w.rebuildHashes();
  cruise(w, front.car, front.ped, 1/30);
  stepVehicle(front.car.body, front.car.spec, front.car.ctl, 1/30, w.statics, true);
  const inside = Math.abs(front.car.body.x - four.x) < four.wv/2 && Math.abs(front.car.body.y - four.y) < four.wh/2;
  entered ||= inside;
  cleared = entered && !inside;
}
assert(cleared, 'a permanently blocked exit does not strand traffic when a legal alternate is open');
console.log('Curbside queue and blocked-exit recovery passed');
