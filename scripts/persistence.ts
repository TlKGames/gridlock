// Exercise a browser disconnect and a legacy room load through the normal room entry points.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CharacterProgress, CharacterSave } from '../src/shared/packs';
import type { S2C } from '../src/shared/protocol';

const dir = mkdtempSync(join(tmpdir(), 'gridlock-saves-'));
process.env.GRIDLOCK_DATA = dir;
const { Room } = await import('../src/server/room');
const { saveRoom, loadRoom, SAVE_VERSION } = await import('../src/server/persist');
const { sanitizeCharacter } = await import('../src/server/characters');
const { RULES, TABLES, UNIVERSE } = await import('../src/shared/packs');
const character = sanitizeCharacter({ name: 'Rook', id: 'rook-one', cash: 5000, universe: UNIVERSE.id })!;
let latest: CharacterProgress | undefined;
let connected = true;
function seat(room: InstanceType<typeof Room>, who?: CharacterSave) {
  const player = room.join('Rook', {
    send(data) {
      const msg: S2C = JSON.parse(data);
      if (connected && msg.t === 'save') latest = msg.p;
    },
    close() {},
  }, who);
  room.stop();
  if (typeof player === 'string') throw new Error(player);
  return player;
}

try {
  saveRoom('TEST', {
    version: SAVE_VERSION, universe: UNIVERSE.id, seed: RULES.citySeed, gameMinutes: 720,
    owners: [[3, 'rook']], profiles: { rook: { cash: 42, garage: [], owned: [3], deaths: 0 } },
  });
  const room = new Room('TEST', RULES.citySeed);
  const pl = seat(room, character);
  assert.deepEqual(pl.owned, [3], 'existing owner keeps legacy property');
  const poker = room.world.city.tables.find((t) => t.host === 'house' && TABLES[t.spec].game === 'holdem')!;
  const ped = room.world.peds.get(pl.pid)!;
  Object.assign(ped.body, poker.at);
  room.onMessage(pl, { t: 'table', op: 'sit', table: poker.id, n: 1000 });
  assert.equal(pl.cash, 4000);
  room.tick();
  assert.equal(latest?.cash, 5000, 'the browser can recover the unplayed stack');
  for (let i = 0; i < 120; i++) room.tick();
  room.persist();
  const saved = latest!;
  connected = false;
  room.leave(pl);
  assert.equal(saved.cash, pl.cash, 'last browser save agrees with server cash-out');
  assert.equal(loadRoom('TEST')?.profiles[pl.ownerKey].cash, pl.cash);
  connected = true;
  const reopened = new Room('TEST', RULES.citySeed);
  const namesake = seat(reopened, { ...character, id: 'rook-two' });
  assert.deepEqual(namesake.owned, [], 'a different character with the same name has no claim');
  reopened.leave(namesake);
  const guest = seat(reopened);
  assert.deepEqual(guest.owned, [], 'a guest cannot inherit the character property');
  reopened.leave(guest);
  const back = seat(reopened, { ...character, ...saved, name: 'Returning Rook' });
  assert.deepEqual(back.owned, [3], 'persistent character ID recovers ownership after a rename and restart');
  assert.equal(back.cash, pl.cash, 'reconnecting restores exactly the refundable balance');
  const craps = reopened.world.city.tables.find((t) => TABLES[t.spec].game === 'craps')!;
  Object.assign(reopened.world.peds.get(back.pid)!.body, craps.at);
  const beforeBet = back.cash;
  reopened.onMessage(back, { t: 'table', op: 'sit', table: craps.id });
  reopened.onMessage(back, { t: 'table', op: 'bet', s: 'place', m: 6, n: 30 });
  assert.equal(back.cash, beforeBet - 30);
  reopened.tick();
  assert.equal(latest?.cash, beforeBet, 'open craps stakes survive a browser save');
  reopened.onMessage(back, { t: 'table', op: 'leave' });
  assert.equal(back.cash, beforeBet, 'leaving craps returns the stake exactly once');
  reopened.leave(back);
  console.log('Poker disconnect, legacy migration and independent property ownership passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
