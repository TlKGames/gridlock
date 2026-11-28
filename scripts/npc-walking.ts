import assert from 'node:assert/strict';
import { pedIndex, RULES } from '../src/shared/packs';
import { PED_RADIUS } from '../src/shared/sim/physics';
import { World } from '../src/server/game/world';
import { spawnPed } from '../src/server/game/factory';
import { doorOf } from '../src/server/game/ai/doors';
import { moveToward, setTask } from '../src/server/game/ai/tasks';
import { stepPedBody } from '../src/server/game/systems/movement';
import { resolveContacts } from '../src/server/game/systems/contacts';

const w = new World(RULES.citySeed);
const dt = 1 / 30;
const block = w.city.buildings.find((b, id) => b.rect.x1 - b.rect.x0 > 8 && b.rect.x1 - b.rect.x0 < 14 &&
  b.rect.y1 - b.rect.y0 < 16 && !w.city.interiors.some(i => i.building === id))!.rect;
const y = (block.y0 + block.y1) / 2;
const ped = spawnPed(w, pedIndex('tourist'), block.x0 - 1, y);
setTask(ped, 'stand');
const dest = { x: block.x1 + 1, y };
assert(w.statics.raycast(ped.body.x, y, dest.x, y), 'building blocks the direct path');
for (let i = 0; i < 600 && Math.hypot(ped.body.x - dest.x, ped.body.y - y) > 0.3; i++) {
  w.time += dt;
  w.rebuildHashes();
  moveToward(w, ped, dest.x, y, ped.spec.runSpeed, dt);
  stepPedBody(w, ped, dt, ped.spec.runSpeed);
}
assert(Math.hypot(ped.body.x - dest.x, ped.body.y - y) < 0.3, 'runner rounds the building and reaches the far side');

const road = w.city.segs.find(s => s.axis === 'h' && s.x1 - s.x0 > 80)!;
const x = (road.x0 + road.x1) / 2;
const sidewalkY = road.y0 + road.width / 2 + 1.5;
assert(w.map.blockAt(x, sidewalkY));
w.peds.clear();
const a = spawnPed(w, pedIndex('tourist'), x - 5, sidewalkY);
const b = spawnPed(w, pedIndex('tourist'), x + 5, sidewalkY);
setTask(a, 'wander'); setTask(b, 'wander');
let closest = Infinity;
for (let i = 0; i < 150; i++) {
  w.time += dt;
  w.rebuildHashes();
  moveToward(w, a, x + 5, sidewalkY, 2, dt);
  moveToward(w, b, x - 5, sidewalkY, 2, dt);
  for (const p of [a, b]) stepPedBody(w, p, dt, p.spec.runSpeed);
  assert(!w.map.onRoad(a.body.x, a.body.y) && !w.map.onRoad(b.body.x, b.body.y), 'keep to the sidewalk');
  closest = Math.min(closest, Math.hypot(a.body.x - b.body.x, a.body.y - b.body.y));
  w.rebuildHashes(); resolveContacts(w);
}
assert(a.body.x > x + 3 && b.body.x < x - 3, 'both walkers pass and continue');
assert(closest >= 2 * PED_RADIUS - 0.01, 'pass before body contact');
Object.assign(b.body, a.body);
w.rebuildHashes(); resolveContacts(w);
assert(Math.hypot(a.body.x - b.body.x, a.body.y - b.body.y) >= 2 * PED_RADIUS - 0.001, 'coincident pedestrians separate');
// Two people reach a single apartment entrance from opposite sides.
const apartment = w.city.interiors.find(i => i.layout === 'apartments')!;
const door = doorOf(w, apartment);
const atDoor = (out: number) => ({ x: door.x + door.fx * out, y: door.y + door.fy * out });
Object.assign(a.body, atDoor(3)); Object.assign(b.body, atDoor(-3));
setTask(a, 'stand'); setTask(b, 'stand');
const inGoal = atDoor(-3), outGoal = atDoor(3);
for (let i = 0; i < 300; i++) {
  w.time += dt; w.rebuildHashes();
  moveToward(w, a, inGoal.x, inGoal.y, 2, dt);
  moveToward(w, b, outGoal.x, outGoal.y, 2, dt);
  for (const p of [a, b]) stepPedBody(w, p, dt, p.spec.runSpeed);
  w.rebuildHashes(); resolveContacts(w);
}
assert(Math.hypot(a.body.x - inGoal.x, a.body.y - inGoal.y) < 0.3 &&
  Math.hypot(b.body.x - outGoal.x, b.body.y - outGoal.y) < 0.3, 'opposing walkers clear the same doorway');
console.log('Building detour, sidewalk and doorway passing, and overlap recovery passed');
