// A room: one shared city, up to RULES.maxPlayers players, its own fixed-rate simulation.
import { RADIO, RULES, UNIVERSE, VEHICLES } from '../shared/packs';
import { type C2S, type InputMsg, Mode, PLAYER_COLORS, type S2C, SNAP_EVERY, TICK_HZ } from '../shared/protocol';
import { DT } from '../shared/sim/physics';
import { MAP_SIZE } from '../shared/world/cityTypes';
import { updateAi } from './game/ai/brain';
import type { Player } from './game/entities';
import { removeVehicle, unseatPed } from './game/factory';
import { Missions } from './game/missions/engine';
import { faceTalk } from './game/systems/faceTalk';
import { Cell, newCell } from './game/missions/cell';
import { Business } from './game/systems/business';
import { Robberies } from './game/systems/robbery';
import { Vaults } from './game/systems/vaults';
import { Rounds } from './rounds';
import { resolveContacts } from './game/systems/contacts';
import { StreetFurniture } from './game/systems/breakables';
import { Dispatch } from './game/systems/dispatch';
import { Economy } from './game/systems/economy';
import { updateNpcPeds, updateVehicles } from './game/systems/movement';
import { devTeleport } from './game/systems/ways';
import { updateTrains } from './game/systems/trains';
import { CardTables } from './game/systems/cardTables';
import { dialFriend, meetFriend, sendFriends, updateInvites } from './game/systems/cardInvites';
import { equipStart, makeAvatar, processPlayers } from './game/systems/players';
import { updateFires, updateProjectiles } from './game/systems/projectiles';
import { updateTrailers } from './game/systems/trailers';
import { updateMounts } from './game/systems/mounts';
import { buildSnapshot, playerList } from './game/systems/snapshot';
import { Population } from './game/systems/population';
import { updateWanted } from './game/systems/wanted';
import { createCensus, type Census } from './game/census';
import { World } from './game/world';
import type { CharacterSave } from '../shared/packs';
import { progressOf } from './characters';
import { lastOf, resumeSpot, resumeVehicle } from './resume';
import { loadRoom, type RoomSave, SAVE_VERSION, type SavedProfile, saveRoom } from './persist';

export interface Conn {
  send(data: string): void;
  close(): void;
}

export class Room {
  readonly world: World;
  readonly census: Census;
  private pop: Population;
  private dispatch: Dispatch;
  readonly econ: Economy;
  private profiles: Record<string, SavedProfile>;
  private loop: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private acc = 0;
  private lastT = 0;
  private saveT = 0;
  tickMs = 0;
  emptySince = Date.now();

  constructor(readonly code: string, seed: number, mode?: string) {
    // A save from another city's layout would point property ids at the wrong buildings: skip it.
    const loaded = loadRoom(code);
    const save = loaded && loaded.seed === seed ? loaded : null;
    const w = (this.world = new World(seed));
    this.census = save?.census ?? createCensus(w.city, seed);
    if (save) { w.gameMinutes = save.gameMinutes; w.gameDay = save.gameDay ?? 0; }
    this.profiles = Object.assign(Object.create(null), save?.profiles);
    this.pop = new Population(w, this.census);
    this.dispatch = new Dispatch(w);
    this.econ = new Economy(w);
    this.missions = new Missions(w);
    this.cell = new Cell(w, this.missions);
    this.business = new Business(w, this.econ.owners, this.missions);
    this.econ.business = this.business;
    this.business.onChange = (pl) => this.sendProfile(pl);
    this.vaults = new Vaults(w);
    this.vaults.onChange = () => w.broadcast({ t: 'gates', open: this.vaults.open() } satisfies S2C);
    w.onExplosion = (x, y, r, by) => this.vaults.explosion(x, y, r, by);
    this.robberies = new Robberies(w, this.econ.owners, this.business);
    this.furniture = new StreetFurniture(w);
    this.tables = new CardTables(w, (pl) => this.sendSave(pl));
    for (const [id, amount] of save?.safes ?? []) this.business.safes.set(id, amount);
    this.rounds = new Rounds(save?.mode ?? mode);
    for (const [id, name] of save?.owners ?? []) this.econ.owners.set(id, name);
    this.econ.onChange = () => { this.sendOwners(); this.persist(); for (const pl of w.players.values()) this.sendProfile(pl); };
    w.onKill = (killer, victim) => {
      this.missions.onKill(killer, victim);
      if (killer?.player && victim.player && killer !== victim) killer.player.frags++;
      this.rounds.onKill(w, killer?.player ?? undefined, victim.player ?? undefined);
    };
    w.onCrate = (pl, pk) => this.missions.onCrate(pl, pk);
    w.onFelony = (pl) => this.sendProfile(pl);
    w.earn = (pl, amount) => { pl.cash += amount; pl.earned += amount; };
    w.earnToBank = (pl, amount) => { pl.bank += amount; pl.earned += amount; };
  }

  readonly missions: Missions;
  readonly cell: Cell;
  readonly business: Business;
  readonly vaults: Vaults;
  readonly robberies: Robberies;
  readonly furniture: StreetFurniture;
  readonly rounds: Rounds;
  /** Card and casino tables (systems/cardTables.ts). */
  readonly tables: CardTables;

  get size(): number {
    return this.world.players.size;
  }

  names(): string[] {
    return [...this.world.players.values()].map((p) => p.name);
  }

  /** Joins a guest (name only) or a saved character, whose progress follows them between rooms. */
  join(name: string, conn: Conn, character?: CharacterSave): Player | string {
    const w = this.world;
    if (character) name = character.name;
    if (w.players.size >= RULES.maxPlayers) return 'Room is full.';
    if ([...w.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) return 'That name is already playing in this room.';
    const legacyName = name.toLowerCase();
    const key = character ? `character:${character.id}` : `guest:${legacyName}`;
    // Older rooms recorded only a display name. Bind that entry once on the first matching join.
    if (this.profiles[legacyName]) {
      this.profiles[key] ??= this.profiles[legacyName];
      delete this.profiles[legacyName];
    }
    for (const [id, owner] of this.econ.owners) {
      if (owner === legacyName) this.econ.owners.set(id, key);
    }
    const roomProf = this.profiles[key];
    const c = character;
    const prof: SavedProfile = c
      ? { cash: c.cash, bank: c.bank, garage: c.garage, owned: roomProf?.owned ?? [], felonies: c.felonies, deaths: c.deaths, respect: c.respect, met: c.met }
      : roomProf ?? { cash: RULES.startCash, garage: [], owned: [], felonies: {}, deaths: 0 };
    const used = new Set([...w.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const pl: Player = {
      id: w.id(), name, ownerKey: key, color, pid: 0, mode: Mode.Foot, queue: [], last: [0, 0, 0, 0, 0, 0, 0, -1], ack: 0,
      cash: prof.cash, bank: prof.bank ?? 0, felonies: { ...(prof.felonies ?? {}) }, felonyCd: {}, deaths: prof.deaths, heat: 0, wanted: 0, seenT: 0, lethal: false,
      respawnT: 0, garage: [...prof.garage].filter((v) => v < VEHICLES.length), owned: [...this.econ.owners].filter(([, owner]) => owner === key).map(([id]) => id),
      garageCar: 0, ping: 0, send: (m) => conn.send(JSON.stringify(m)), sendRaw: (s) => conn.send(s),
      spawnCdT: 0, bustT: 0, lastPlace: -1, gunCrimeT: -9, seenCheckT: 0, sent: new Map(), snapCount: 0,
      respect: { ...(prof.respect ?? {}) }, met: new Set(prof.met ?? []), mission: null, boothCd: new Map(), blownRun: 0, cell: newCell(w, prof.respect ?? {}), frags: 0, earned: 0, itTime: 0,
      ...(character ? { character: { id: character.id }, look: character.look } : {}),
    };
    // Characters pick up where they left off (any room: it's the same city); others at the hospital.
    const resume = resumeSpot(w, character?.last);
    const spawn = resume ?? this.spawnPoint(pl);
    const ped = makeAvatar(w, pl, spawn.x, spawn.y);
    equipStart(ped);
    if (resume) { ped.body.angle = resume.angle; resumeVehicle(w, pl, ped, resume); }
    w.players.set(pl.id, pl);
    pl.send({ t: 'welcome', id: pl.id, room: this.code, seed: w.seed, maxPlayers: RULES.maxPlayers } satisfies S2C);
    this.sendSave(pl);
    this.sendProfile(pl);
    this.sendOwners();
    pl.send(this.rounds.modeMsg());
    pl.send({ t: 'gates', open: this.vaults.open() } satisfies S2C);
    this.furniture.sendTo(pl);
    sendFriends(pl);
    w.notify('info', `${name} joined`);
    this.start();
    return pl;
  }

  /** New players meet at the hospital nearest the city centre; owners start at home. */
  private spawnPoint(pl: Player): { x: number; y: number } {
    const w = this.world;
    const home = pl.owned.map((id) => w.city.properties[id]).find((p) => p.verb === 'home');
    if (home) return home;
    const hospitals = w.city.services.filter((s) => s.verb === 'hospital');
    const c = MAP_SIZE / 2;
    hospitals.sort((a, b) => Math.hypot(a.x - c, a.y - c) - Math.hypot(b.x - c, b.y - c));
    return hospitals[0] ?? this.anyRoad(c);
  }

  /** A universe with no hospital: the road junction nearest the middle of the map. */
  private anyRoad(c: number): { x: number; y: number } {
    const n = this.world.map.nearestNode(c, c);
    return { x: n.x, y: n.y };
  }

  leave(pl: Player): void {
    const w = this.world;
    this.tables.leave(pl); // cashed out first, so it's saved
    this.storeProfile(pl);
    this.missions.drop(pl);
    const p = w.peds.get(pl.pid);
    if (p) {
      if (p.vehicle) unseatPed(w, p, false);
      w.peds.delete(p.id);
    }
    const car = pl.garageCar ? w.vehicles.get(pl.garageCar) : undefined;
    if (car && !car.seats.some((s) => s)) removeVehicle(w, car);
    w.players.delete(pl.id);
    w.notify('info', `${pl.name} left`);
    this.persist();
    if (!w.players.size) { this.emptySince = Date.now(); this.stop(); }
  }

  onMessage(pl: Player, msg: C2S): void {
    switch (msg.t) {
      case 'in':
        for (const i of msg.i) if (Array.isArray(i) && i.length === 8 && i.every((n) => typeof n === 'number' && Number.isFinite(n))) pl.queue.push(sanitize(i));
        if (pl.queue.length > 30) pl.queue.splice(0, pl.queue.length - 30);
        break;
      case 'buy': {
        const err = this.econ.buy(pl, msg.kind, String(msg.id), Number(msg.place));
        if (err) pl.send({ t: 'msg', kind: 'warn', text: err } satisfies S2C);
        else this.sendProfile(pl);
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 160).trim();
        // Dev only (npm run dev sets GRIDLOCK_DEV): "/tp x y" puts you (and your vehicle) there.
        const tp = process.env.GRIDLOCK_DEV ? /^\/tp\s+(-?[\d.]+)\s+(-?[\d.]+)$/.exec(text) : null;
        if (tp) { devTeleport(this.world, pl, Number(tp[1]), Number(tp[2])); break; }
        // Dev only: "/cash n" sets your cash (testing the tables and shops).
        const cash = process.env.GRIDLOCK_DEV ? /^\/cash\s+(\d+)$/.exec(text) : null;
        if (cash) { pl.cash = Math.min(10_000_000, Number(cash[1])); break; }
        if (text) this.world.broadcast({ t: 'msg', kind: 'chat', text: `${pl.name}: ${text}` } satisfies S2C);
        break;
      }
      case 'job': {
        const err = this.missions.answer(pl, Number(msg.booth));
        if (err) pl.send({ t: 'msg', kind: 'warn', text: err } satisfies S2C);
        break;
      }
      case 'call':
        if (RULES.cellPhone && pl.cell.ringing) {
          this.cell.answer(pl, !!msg.accept);
          this.sendSave(pl);
        }
        break;
      case 'talk': {
        const err = faceTalk(this.world, this.missions, pl, Number(msg.ped));
        if (err) pl.send({ t: 'msg', kind: 'info', text: err } satisfies S2C);
        break;
      }
      case 'table': {
        if (msg.op === 'meet') meetFriend(this.world, pl, Number(msg.table));
        else this.tables.handle(pl, msg);
        break;
      }
      case 'dial': {
        if (!RULES.cellPhone) break;
        // A friend with a card game (systems/cardInvites.ts).
        if (String(msg.gang).startsWith('friend:')) { dialFriend(this.world, pl, String(msg.gang).slice(7)); break; }
        const err = this.cell.dial(pl, String(msg.gang));
        if (err) pl.send({ t: 'msg', kind: 'warn', text: err } satisfies S2C);
        break;
      }
      case 'ping':
        pl.send({ t: 'pong', ts: msg.ts, st: Math.round(this.world.time * 1000) } satisfies S2C);
        break;
      case 'radio': {
        // Driver or passenger: it's the car's radio, so everybody riding in it hears the change.
        const w = this.world, vid = w.peds.get(pl.pid)?.vehicle ?? 0, v = w.vehicles.get(vid);
        const station = Number(msg.station);
        if (!v || !Number.isInteger(station) || station < -1 || station >= RADIO.length) break;
        v.radio = station;
        for (const o of w.players.values()) {
          if (o !== pl && w.peds.get(o.pid)?.vehicle === vid) o.send({ t: 'radio', vid, station } satisfies S2C);
        }
        break;
      }
      case 'waypoint': {
        // Your map waypoint, shared with whoever rides with you (sent in the player list).
        const at = Array.isArray(msg.at) ? msg.at.map(Number) : null;
        pl.waypoint = at && at.length === 2 && at.every((v) => Number.isFinite(v) && v >= 0 && v <= MAP_SIZE) ? [Math.round(at[0]), Math.round(at[1])] : null;
        break;
      }
    }
  }

  private sendProfile(pl: Player): void {
    pl.send({ t: 'profile', p: { garage: pl.garage, owned: pl.owned, felonies: pl.felonies, ...this.business.profileOf(pl) } } satisfies S2C);
  }

  private sendOwners(): void {
    const names = new Map([...this.world.players.values()].map((p) => [p.ownerKey, p.name]));
    this.world.broadcast({ t: 'owners', list: this.econ.ownerList((key) => names.get(key) ?? this.profiles[key]?.name ?? key) } satisfies S2C);
  }

  private storeProfile(pl: Player): void {
    this.profiles[pl.ownerKey] = { name: pl.name, cash: this.savedCash(pl), bank: pl.bank, garage: pl.garage, owned: pl.owned, felonies: pl.felonies, deaths: pl.deaths, respect: pl.respect, met: [...pl.met] };
    this.sendSave(pl);
  }

  /** Characters live in the player's browser: send their progress there to be saved. */
  private savedCash(pl: Player): number {
    return pl.cash + this.tables.refund(pl);
  }

  private sendSave(pl: Player): void {
    if (pl.character) pl.send({ t: 'save', id: pl.character.id, p: { ...progressOf(pl), crapsReceipt: this.tables.checkpoint(pl), cash: this.savedCash(pl), last: lastOf(this.world, pl, this.code) } } satisfies S2C);
  }

  persist(): void {
    this.pop.checkpoint();
    for (const pl of this.world.players.values()) this.storeProfile(pl);
    const save: RoomSave = { census: this.census, version: SAVE_VERSION, universe: UNIVERSE.id, seed: this.world.seed, mode: this.rounds.mode.id, gameMinutes: this.world.gameMinutes, gameDay: this.world.gameDay, owners: [...this.econ.owners.entries()], safes: [...this.business.safes.entries()], profiles: this.profiles };
    saveRoom(this.code, save);
  }

  start(): void {
    if (this.loop) return;
    this.lastT = performance.now();
    this.acc = 0;
    this.loop = setInterval(() => this.frame(), 1000 / TICK_HZ / 2);
  }

  stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private frame(): void {
    const now = performance.now();
    this.acc += now - this.lastT;
    this.lastT = now;
    const step = 1000 / TICK_HZ;
    let n = 0;
    while (this.acc >= step && n < 4) {
      this.acc -= step;
      n++;
      const t0 = performance.now();
      this.tick();
      this.tickMs = this.tickMs * 0.95 + (performance.now() - t0) * 0.05;
    }
    if (this.acc > step * 8) this.acc = 0;
  }

  tick(): void {
    const w = this.world;
    w.time += DT;
    w.gameMinutes += RULES.gameMinutesPerSecond * DT;
    if (w.gameMinutes >= 1440) { w.gameMinutes -= 1440; w.gameDay++; }
    w.rebuildHashes();
    processPlayers(w, DT);
    updateAi(w, DT);
    updateNpcPeds(w, DT);
    updateMounts(w, DT);
    updateVehicles(w, DT);
    updateTrains(w, DT);
    w.rebuildHashes();
    resolveContacts(w);
    this.furniture.update(DT);
    updateTrailers(w, DT);
    updateProjectiles(w, DT);
    updateFires(w, DT);
    updateWanted(w, DT);
    this.dispatch.update(DT);
    this.pop.update(DT);
    this.econ.update();
    this.missions.update();
    if (RULES.cellPhone) this.cell.update();
    this.business.update();
    this.vaults.update();
    this.robberies.update();
    this.tables.update(DT);
    updateInvites(w, DT, (t) => this.tables.inUse(t));
    this.tickCount++;
    if (this.tickCount % TICK_HZ === 0) this.rounds.check(w);
    this.rounds.tick(w, DT);
    if (this.tickCount % SNAP_EVERY === 0) {
      for (const pl of w.players.values()) pl.sendRaw(JSON.stringify(buildSnapshot(w, pl)));
      w.fx = [];
    }
    if (this.tickCount % TICK_HZ === 0) w.broadcast({ t: 'players', list: playerList(w) } satisfies S2C);
    this.saveT += DT;
    if (this.saveT > 30) { this.saveT = 0; this.persist(); }
    // Characters' browsers get their progress every few seconds (a closed tab loses at most that).
    if (this.tickCount % (TICK_HZ * 4) === 0) for (const pl of w.players.values()) this.sendSave(pl);
  }
}

function sanitize(i: number[]): InputMsg {
  const c = (v: number) => Math.max(-1, Math.min(1, v));
  return [i[0], c(i[1]), c(i[2]), c(i[3]), c(i[4]), i[5], i[6] | 0, i[7] | 0];
}
