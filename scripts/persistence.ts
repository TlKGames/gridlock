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
  // The browser sees the receipt before opening the table. Drop every subsequent packet,
  // including the final save, and restore through the same sanitizer used by a room worker.
  for (const wins of [true, false]) {
    const shooter = seat(reopened, { ...character, cash: 20, bank: 5000 });
    Object.assign(reopened.world.peds.get(shooter.pid)!.body, craps.at);
    const move = (op: string, s?: string, n?: number) =>
      reopened.onMessage(shooter, { t: 'table', op, s, n, table: craps.id });
    move('sit');
    reopened.tick();
    const browser: CharacterSave = { ...character, ...latest };
    assert.ok(browser.crapsReceipt);
    connected = false;
    move('bet', 'pass', 30);
    const rng = reopened.world.rng;
    const next = rng.next;
    try {
      rng.next = () => 0.4; // 3 + 3 establishes the point
      move('roll');
      const dice = wins ? [0.4, 0.4] : [0.4, 0.55]; // six wins, seven loses
      rng.next = () => { assert.ok(dice.length); return dice.shift()!; };
      move('odds', 'pass', 60);
      assert.equal(dice.length, 0);
    } finally {
      rng.next = next;
    }
    assert.equal(shooter.cash, 0);
    assert.equal(shooter.bank, 4930);
    reopened.leave(shooter);
    assert.equal(shooter.cash, wins ? 192 : 0); // 30 + 30 on pass; 60 + 72 on odds
    connected = true;
    const elsewhere = new Room('AWAY', RULES.citySeed);
    const restored = seat(elsewhere, sanitizeCharacter(browser)!);
    assert.equal(restored.bank, shooter.bank);
    assert.equal(restored.cash, shooter.cash);
    assert.equal(latest?.crapsReceipt, undefined, 'restored wallet clears the receipt');
    const secondLogin: CharacterSave = sanitizeCharacter({ ...character, ...latest })!;
    assert.equal(secondLogin.cash, shooter.cash, 'no duplicate payment on the next login');
    assert.equal(sanitizeCharacter(browser)?.cash, shooter.cash, 'retrying an old save is idempotent');
    elsewhere.leave(restored);
  }
  console.log('Unsettled craps wins and losses survive disconnect and cross-room reconnect.');
  console.log('Poker disconnect, legacy migration and independent property ownership passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
