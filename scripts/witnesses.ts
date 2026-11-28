// Report the same theft outside a shop with one civilian behind its wall, then on the pavement.
import assert from 'node:assert/strict';
import { CRIMES, RULES, SERVICES, pedIndex } from '../src/shared/packs';
import { doorOf } from '../src/server/game/ai/doors';
import { onNoise } from '../src/server/game/ai/reactions';
import { spawnPed } from '../src/server/game/factory';
import { crime } from '../src/server/game/systems/wanted';
import { Room } from '../src/server/room';

process.env.GRIDLOCK_DATA = 'data-smoke/witnesses';
const room = new Room('WITN', RULES.citySeed);
room.stop();
const player = room.join('Driver', { send() {}, close() {} });
room.stop();
if (typeof player === 'string') throw new Error(player);
const w = room.world, offender = w.peds.get(player.pid)!;
const shop = w.city.interiors.find(i => !i.property && SERVICES[i.place.spec].verb === 'gunshop')!;
const door = doorOf(w, shop);
const x = door.x - door.fy * 4, y = door.y + door.fx * 4;
offender.body.x = x + door.fx * 3;
offender.body.y = y + door.fy * 3;
const witness = spawnPed(w, pedIndex('tourist'), x - door.fx * 2, y - door.fy * 2);
w.rebuildHashes();
const report = () => crime(w, offender, 'vehicleTheft', offender.body.x, offender.body.y);
report();
assert.equal(player.heat, 0, 'hidden witness cannot identify the thief');

// Noise still reaches the same witness through the wall.
for (let i = 0; i < 20; i++) onNoise(w, offender.body.x, offender.body.y, 45, offender.id, false);
assert(['cower', 'flee'].includes(witness.ai!.task));

witness.body.x = offender.body.x - door.fy * 5;
witness.body.y = offender.body.y + door.fx * 5;
w.rebuildHashes();
report();
assert.equal(player.heat, CRIMES.vehicleTheft.heat / 2, 'visible civilian reports the theft once');
console.log('Civilian sight and noise checks passed');
