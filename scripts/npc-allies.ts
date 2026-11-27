// A clerk can call local security without recruiting civilian witnesses into combat.
import assert from 'node:assert/strict';
import { onAttacked } from '../src/server/game/ai/reactions';
import { setTask } from '../src/server/game/ai/tasks';
import { spawnPed } from '../src/server/game/factory';
import { World } from '../src/server/game/world';
import { installUniverse, pedIndex } from '../src/shared/packs';
import { loadUniverse } from '../src/universes';

for (const [id, civilian, member] of [
  ['bayhaven', 'tourist', 'v22_soldier'],
  ['redrock', 'rancher', 'dry_creek_rider'],
] as const) {
  installUniverse(await loadUniverse(id));
  const w = new World(1337);
  const spawn = (arch: string, x: number) => spawnPed(w, pedIndex(arch), x, 100);
  const attacker = spawn('player', 100);
  const clerk = spawn('clerk', 101);
  const guard = spawn('guard', 106);
  const witness = spawn(civilian, 108);
  const distantGuard = spawn('guard', 135);
  setTask(witness, 'wander');
  w.rebuildHashes();
  onAttacked(w, clerk, attacker);
  assert.equal(witness.ai!.task, 'wander', id);
  assert.equal(witness.ai!.enemy, 0, id);
  for (const defender of [clerk, guard]) {
    assert.equal(defender.ai!.task, 'attack', id);
    assert.equal(defender.ai!.target, attacker.id, id);
  }
  assert.equal(distantGuard.ai!.enemy, 0, id);

  const gangster = spawn(member, 200);
  const ally = spawn(member, 205);
  w.rebuildHashes();
  onAttacked(w, gangster, attacker);
  assert.equal(ally.ai!.task, 'attack', id);
  assert.equal(ally.ai!.target, attacker.id, id);
  console.log(id, 'clerk, guard, bystander, and gang retaliation checks passed');
}
