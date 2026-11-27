// Regression checks for dispatch retries, service crew release, and fixed NPC posts.
import assert from 'node:assert/strict';
import { RULES, pedIndex } from '../src/shared/packs';
import { Room } from '../src/server/room';
import { revive, setTask } from '../src/server/game/ai/tasks';
import { seatPed, spawnPed, unseatPed } from '../src/server/game/factory';
import { Dispatch } from '../src/server/game/systems/dispatch';
import { Population } from '../src/server/game/systems/population';

process.env.GRIDLOCK_DATA = 'data-smoke/npc-services';
const room = new Room('SERV', RULES.citySeed);
room.stop();
const pl = room.join('Observer', { send() {}, close() {} });
room.stop();
if (typeof pl === 'string') throw new Error(pl);
const w = room.world, me = w.peds.get(pl.pid)!;
const shop = w.city.interiors.find(i => i.clerkArch)!;
const { x, y } = shop.clerk;
const dispatch = new Dispatch(w);
const fire = (fx: number, fy: number) => {
  const id = w.id();
  w.fires.set(id, { id, kind: 'fire', x: fx, y: fy, r: 3, life: 30, owner: 0 });
  return id;
};
const squads = (key: string) => [...w.squads.values()].filter(s => s.key === key);
function poll(n = 1) {
  while (n-- > 0) { w.time++; w.rebuildHashes(); dispatch.update(1); }
}
const distant = fire(x + 500, y);
fire(x, y);
fire(x + 1, y);
me.body.x = x; me.body.y = y;
const body = spawnPed(w, pedIndex('civilian'), x, y);
body.dead = true; body.deadT = 4;
// Every lane candidate is too close to a player for this poll.
const distance = w.nearestPlayerDist2;
w.nearestPlayerDist2 = () => 0;
poll();
assert.equal(w.squads.size, 0);
w.nearestPlayerDist2 = distance;
poll(10);
assert.equal(squads('medic').length, 1);
assert.equal(squads('fire').length, 1);
assert.notEqual(squads('fire')[0].incident?.target, distant);
const ambulance = squads('medic')[0], vehicle = w.vehicles.get(ambulance.vehicle)!;
const [driver, partner] = ambulance.members.map(id => w.peds.get(id)!);
unseatPed(w, driver); unseatPed(w, partner);
seatPed(w, partner, vehicle, 0); setTask(partner, 'drive');
setTask(driver, 'revive', body.id);
poll();
assert(w.squads.has(ambulance.id), 'keep the assignment while a medic is working');
body.dead = false; setTask(driver, 'return', vehicle.id);
poll();
assert(!w.squads.has(ambulance.id) && !vehicle.persistent && !driver.persistent && !partner.persistent);

const truck = squads('fire')[0];
for (const id of truck.members) w.peds.get(id)!.dead = true;
poll(10);
assert(!w.squads.has(truck.id) && !w.vehicles.get(truck.vehicle)!.persistent);
assert.equal(squads('fire').length, 1, 'retry an unresolved incident after losing a crew');

const second = fire(x + 40, y);
const queued = fire(x + 80, y);
poll(10);
assert.equal(squads('fire').length, 2);
assert(squads('fire').some(s => s.incident?.target === second));
assert(!squads('fire').some(s => s.incident?.target === queued));
w.fires.delete(second);
const finished = squads('fire').find(s => s.incident?.target === second)!;
setTask(w.peds.get(finished.members[0])!, 'drive');
poll(10);
assert(squads('fire').some(s => s.incident?.target === queued), 'dispatch the queued fire when a slot opens');

const population = new Population(w);
population.update(1);
const clerks = () => [...w.peds.values()].filter(p => p.spec.id === shop.clerkArch && p.ai?.post?.x === x && p.ai.post.y === y);
const clerk = clerks()[0];
assert(clerk);
clerk.dead = true; clerk.deadT = 4;
population.update(1);
driver.body.x = x; driver.body.y = y;
setTask(driver, 'revive', clerk.id);
assert(revive(w, driver, 3));
w.time += 125; population.update(1);
assert.deepEqual(clerks().map(p => p.id), [clerk.id]);
assert.equal(clerk.ai?.task, 'stand');
clerk.dead = true; clerk.deadT = 121;
population.update(1);
assert(!w.peds.has(clerk.id));
assert.equal(clerks().length, 1);
console.log('NPC service and fixed-post checks passed');
