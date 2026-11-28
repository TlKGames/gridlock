// Exercise the legacy roster, shared activation across two players, and hover metadata on seat changes.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAME_PARTS, RULES } from '../src/shared/packs';
import { FULL_SNAP_EVERY } from '../src/shared/protocol';
import { EntityStore } from '../src/client/net/entities';
import { buildSnapshot } from '../src/server/game/systems/snapshot';
import { removePed, seatPed, unseatPed } from '../src/server/game/factory';

const dir = mkdtempSync(join(tmpdir(), 'gridlock-life-'));
process.env.GRIDLOCK_DATA = dir;
const { Room } = await import('../src/server/room');
const room = new Room('LIFE', RULES.citySeed);
try {
  const conn = { send() {}, close() {} };
  const p = room.join('First', conn), q = room.join('Second', conn);
  room.stop();
  if (typeof p === 'string' || typeof q === 'string') throw Error('join failed');
  const w = room.world;
  for (let i = 0; i < 180; i++) room.tick();
  const live = [...w.peds.values()].filter(ped => ped.resident);
  assert.equal(new Set(live.map(ped => ped.resident!.id)).size, live.length);
  assert.ok(live.some(ped => !ped.vehicle));
  const driver = live.find(ped => ped.vehicle)!;
  const car = w.vehicles.get(driver.vehicle)!;
  const npc = driver.resident!;
  const name = npc.identity!.name;
  assert.ok(NAME_PARTS[npc.identity!.gender].includes(name.split(' ')[0]));
  for (const player of [p, q]) {
    Object.assign(w.peds.get(player.pid)!.body, { x: car.body.x, y: car.body.y });
    player.snapCount = FULL_SNAP_EVERY;
  }
  const views = new Map([[p.id, new EntityStore()], [q.id, new EntityStore()]]);
  function names(player: import('../src/server/game/entities').Player) {
    w.rebuildHashes();
    const snap = buildSnapshot(w, player);
    assert.ok(snap.t === 's');
    const view = views.get(player.id)!;
    view.ingest(snap.st, snap.e, snap.k, snap.names);
    return new Map([...view.all.values()].map(e => [e.id, e.npcName]));
  }
  assert.equal(names(p).get(car.id), name);
  assert.equal(names(q).get(car.id), name);
  unseatPed(w, driver, true);
  const outside = names(p);
  assert.equal(outside.get(car.id), '');
  assert.equal(outside.get(driver.id), name);
  seatPed(w, driver, car, 0);
  assert.equal(names(p).get(car.id), name);
  removePed(w, driver);
  room.persist();
  const reopened = new Room('LIFE', RULES.citySeed);
  const saved = reopened.census.residents.find(r => r.id === npc.id)!;
  assert.deepEqual(saved.identity, npc.identity);
  assert.equal(saved.archetype, npc.archetype);
  console.log('Resident pedestrians, drivers, two-player uniqueness, hover names and save/reload passed');
} finally {
  room.stop();
  rmSync(dir, { recursive: true, force: true });
}

// Pick the rendered mesh, including the depth of a closed building shell.
const THREE = await import('three');
const { NpcPicker } = await import('../src/client/render/npcPicker');
const { EK } = await import('../src/shared/protocol');
const store = new EntityStore();
store.ingest(0, [[1, EK.Ped, 0, 0, 0, 0]], [], [[1, 'Test Resident']]);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.z = 5;
camera.updateMatrixWorld();
const root = new THREE.Group();
new THREE.Scene().add(root);
const box = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
root.add(new THREE.Mesh(box, material));
root.updateMatrixWorld();
const picker = new NpcPicker();
const meshes = new Map([[1, { root }]]);
const shell = new THREE.InstancedMesh(box, material, 1);
shell.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 2));
assert.equal(picker.pick(camera, 0, 0, store, meshes, new Map(), []), 'Test Resident');
assert.equal(picker.pick(camera, 0.9, 0, store, meshes, new Map(), []), '');
assert.equal(picker.pick(camera, 0, 0, store, meshes, new Map(), [shell]), '');
