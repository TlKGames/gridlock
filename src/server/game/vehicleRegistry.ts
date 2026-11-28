// The room keeps the registration when a parked vehicle leaves an observer's simulation.
import { randomUUID } from 'node:crypto';
import { rectContains, type Rect } from '../../shared/math';
import type { Census } from './census';
import { LANE_W } from '../../shared/world/cityTypes';
import type { VehicleSpec } from '../../shared/packs/types';
import { SERVICES, VEHICLES } from '../../shared/packs';
import type { Ped, Vehicle } from './entities';
import { spawnVehicle } from './factory';
import type { World } from './world';

type Spot = { x: number; y: number };
export interface Registration {
  vin: string; model: string; color: number; hp: number; angle: number; at: Spot;
  owner: string; parked: Spot; taken: boolean; reported: boolean; disguised: boolean;
  stored?: boolean; slot?: string;
  holder?: string; lastDriver?: string;
}
export const newVin = () => randomUUID();
export function keeper(p: Ped): string | undefined {
  if (p.player) return 'player:' + p.player.ownerKey;
  if (p.resident) return 'house:' + p.resident.household;
}

export class VehicleRegistry {
  private records = new Map<string, Registration>();
  private live = new Map<string, Vehicle>();
  private byOwner = new Map<string, Set<Registration>>();

  private households: number[] = [];
  private districts = new Map<number, number[]>();
  private dealerLots: Rect[] = [];
  private parkingIndices?: Map<string, number>;
  private slots = new Map<string, Registration>();

  constructor(private w: World) {}

  setCensus(census: Census): void {
    const { city } = this.w;
    this.households = census.households.map(h => h.id);
    this.districts.clear();
    for (const h of census.households) {
      const district = city.blocks[city.lots[h.lot].block].district;
      let ids = this.districts.get(district);
      if (!ids) this.districts.set(district, ids = []);
      ids.push(h.id);
    }
    this.dealerLots = city.services.filter(p => SERVICES[p.spec].verb === 'dealer').map(p => city.lots[p.lot].rect);
  }
  liveVehicle(vin: string) { return this.live.get(vin); }
  parkingIndex(x: number, y: number): number | undefined {
    this.parkingIndices ??= new Map(this.w.city.parking.map((spot, i) => [spot.x + ',' + spot.y, i]));
    return this.parkingIndices.get(x + ',' + y);
  }
  atSlot(slot: string) { return this.slots.get(slot); }
  leaveSlot(v: Vehicle): void {
    const r = this.get(v);
    if (r) this.releaseSlot(r);
  }
  private releaseSlot(r: Registration): void {
    if (r.slot) this.slots.delete(r.slot);
    delete r.slot;
  }

  private index(r: Registration): void {
    if (r.slot) this.slots.set(r.slot, r);
    this.records.set(r.vin, r);
    let list = this.byOwner.get(r.owner);
    if (!list) this.byOwner.set(r.owner, list = new Set());
    list.add(r);
  }
  dealerAt(x: number, y: number) { return this.dealerLots.some(lot => rectContains(lot, x, y)); }
  parkHousehold(r: Registration, index: number): void {
    this.releaseSlot(r);
    const { x, y, angle } = this.w.city.parking[index];
    Object.assign(r, { at: { x, y }, parked: { x, y }, angle, slot: 'parking:' + index });
    this.index(r);
  }
  owned(owner: string) { return this.byOwner.get(owner); }
  get(v: Vehicle) { return this.records.get(v.vin); }
  find(vin: string) { return this.records.get(vin); }
  registerSpawn(v: Vehicle, owner?: string, slot?: string): void {
    if (this.get(v)) return;
    const { x, y, angle } = v.body;
    if (!owner) {
      if (v.spec.movement !== 'wheels' || !this.households.length || this.dealerAt(x, y)) return;
      const pool = this.districts.get(this.w.map.districtAt(x, y)) ?? this.households;
      owner = 'house:' + pool[parseInt(v.vin.slice(0, 8), 16) % pool.length];
    }
    this.index({ vin: v.vin, owner, slot, model: v.spec.id, at: { x, y }, parked: { x, y }, angle,
      hp: v.hp, color: v.color, taken: false, reported: false, disguised: false });
    this.live.set(v.vin, v);
  }
  drive(p: Ped, v: Vehicle): void {
    const r = this.get(v);
    if (!r) return;
    if (p.player && r.owner === keeper(p)) v.owner = p.player.id;
    this.releaseSlot(r);
    r.holder = v.authorizedDriver === p.id ? r.owner : keeper(p);
    r.lastDriver = r.holder;
    if (r.holder === r.owner) {
      r.reported = r.taken = r.disguised = false;
    } else r.taken = true;
  }
  exit(p: Ped, v: Vehicle): void {
    const r = this.get(v);
    if (!r || p.seat !== 0) return;
    const spot = v.parkingTarget;
    if (spot && Math.hypot(v.body.x - spot.x, v.body.y - spot.y) < 1.2) {
      const i = this.parkingIndex(spot.x, spot.y);
      if (i !== undefined && !this.atSlot('parking:' + i)) {
        r.slot = 'parking:' + i;
        this.slots.set(r.slot, r);
        v.spot = i;
      }
    }
    if (r.holder === r.owner) r.parked = { x: v.body.x, y: v.body.y };
    r.holder = undefined;
  }
  location(r: Registration): Spot { return this.live.get(r.vin)?.body ?? r.at; }
  checkSpot(p: Ped): void {
    const owner = keeper(p);
    if (!owner || p.vehicle || p.dead || p.down > 0) return;
    for (const r of this.owned(owner) ?? []) {
      if (!r.taken || r.reported || Math.hypot(p.body.x - r.parked.x, p.body.y - r.parked.y) > 6) continue;
      const actual = this.live.get(r.vin)?.body ?? r.at;
      if (Math.hypot(actual.x - r.parked.x, actual.y - r.parked.y) < 10) continue;
      r.reported = true;
      if (p.player) this.w.notify('info', 'Your vehicle is missing. Theft reported to police.', p.player);
    }
  }
  respray(v: Vehicle): void {
    const r = this.get(v);
    if (r?.taken) r.disguised = true;
  }
  hot(p: Ped, v: Vehicle): boolean {
    const r = this.get(v);
    return !!r?.reported && !r.disguised && r.owner !== keeper(p) && v.seats[0] === p.id;
  }
  private capture(v: Vehicle, r: Registration): void {
    r.at = { x: v.body.x, y: v.body.y };
    r.color = v.color; r.hp = v.hp; r.angle = v.body.angle;
  }
  remove(v: Vehicle, unload: boolean): void {
    const r = this.get(v);
    if (!r) return;
    this.live.delete(v.vin);
    if (unload && !v.wrecked) {
      this.capture(v, r);
      if (!r.taken && r.holder === r.owner) r.parked = { ...r.at };
      r.holder = undefined;
      this.parkReturningTraffic(r, v.spec);
    } else {
      this.releaseSlot(r);
      this.records.delete(r.vin);
      this.byOwner.get(r.owner)?.delete(r);
    }
  }
  save(): Registration[] {
    for (const [vin, v] of this.live) this.capture(v, this.records.get(vin)!);
    return [...this.records.values()].filter(r => r.hp > 0);
  }
  load(records: Registration[]): void {
    for (const r of records) if (VEHICLES.some(v => v.id === r.model)) {
      if (!r.taken && r.holder === r.owner) r.parked = { ...r.at };
      r.holder = undefined;
      this.index(r);
    }
    // Reserve the original saved bays first, then repair older in-lane registrations.
    for (const r of this.records.values()) {
      const spec = VEHICLES.find(s => s.id === r.model)!;
      this.parkReturningTraffic(r, spec);
    }
  }
  // Traffic drivers are unloaded with their cars. When the car next streams in alone,
  // finish the offscreen trip in a parking space instead of leaving it in a travel lane.
  private parkReturningTraffic(r: Registration, spec: VehicleSpec): void {
    if (r.stored || r.slot || r.taken || r.lastDriver !== r.owner || !r.owner.startsWith('house:') || spec.movement !== 'wheels') return;
    const { x, y } = r.at;
    if (!this.w.map.onRoad(x, y)) return;
    const { seg, d } = this.w.map.nearestSegment(x, y);
    if (d > seg.lanes * LANE_W) return;
    const length = spec.length + (spec.trailer?.length ?? 0);
    let best = Infinity, index = -1;
    for (const [i, spot] of this.w.city.parking.entries()) {
      const distance = (spot.x - x) ** 2 + (spot.y - y) ** 2;
      if (distance >= best || this.slots.has('parking:' + i)) continue;
      const pose = { x: spot.x, y: spot.y, angle: spot.angle };
      if (this.w.statics.resolveObb(pose, length / 2, spec.width / 2)) continue;
      let occupied = false;
      for (const other of this.w.vehicles.values()) {
        if (Math.hypot(other.body.x - spot.x, other.body.y - spot.y) < (other.spec.length + length) / 2) {
          occupied = true; break;
        }
      }
      if (!occupied) { best = distance; index = i; }
    }
    if (index < 0) return;
    const spot = this.w.city.parking[index];
    r.at = { x: spot.x, y: spot.y };
    r.parked = { ...r.at };
    r.angle = spot.angle;
    r.slot = 'parking:' + index;
    this.slots.set(r.slot, r);
  }
  show(r: Registration): Vehicle {
    delete r.stored;
    const live = this.live.get(r.vin);
    if (live) return live;
    const type = VEHICLES.findIndex(s => s.id === r.model);
    const v = spawnVehicle(this.w, type, r.at.x, r.at.y, r.angle, r.color, { vin: r.vin });
    v.hp = r.hp;
    this.live.set(v.vin, v);
    return v;
  }
  update(): void {
    const owners = new Map([...this.w.players.values()].map(pl => ['player:' + pl.ownerKey, pl.id]));
    for (const r of this.records.values()) {
      const v = this.live.get(r.vin);
      if (v && r.owner.startsWith('player:')) v.owner = owners.get(r.owner) ?? 0;
      if (!r.stored && !r.slot && !v && this.w.nearestPlayerDist2(r.at.x, r.at.y) < 85 ** 2) this.show(r);
    }
    for (const p of this.w.peds.values()) this.checkSpot(p);
  }
}
