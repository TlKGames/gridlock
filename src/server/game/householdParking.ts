// A parked household car has a persistent title even when neither end of its trip is streamed.
import { VEHICLES, ZONES, paletteFor, vehicleIndex } from '../../shared/packs';
import { Rng } from '../../shared/rng';
import { buildingAccess } from './ai/commute';
import { parkingFits } from './ai/parking';
import { scheduledLot, type Census, type Resident } from './census';
import { newVin, type Registration } from './vehicleRegistry';
import type { World } from './world';

const RANGE = 75;
const cell = (x: number, y: number) => x + ':' + y;

export class HouseholdParking {
  readonly driverByVin = new Map<string, Resident>();
  assignDriver(r: Resident, vin: string) {
    r.commuteVin = vin;
    this.driverByVin.set(vin, r);
  }

  private buckets = new Map<string, number[]>();
  private bays = new Map<number, number[]>();

  constructor(private w: World, census: Census) {
    w.city.parking.forEach((s, i) => {
      if (w.registry.dealerAt(s.x, s.y)) return;
      const key = cell(Math.floor(s.x / RANGE), Math.floor(s.y / RANGE));
      const list = this.buckets.get(key) ?? [];
      list.push(i);
      this.buckets.set(key, list);
    });
    if (census.householdParkingSeeded) {
      for (const r of census.residents) if (r.commuteVin && !r.deceased) this.assignDriver(r, r.commuteVin);
      return;
    }
    const assigned = new Set(census.residents.filter(r => r.commuteVin).map(r => r.household));
    for (const r of census.residents) {
      if (r.deceased || !r.job) continue;
      if (r.commuteVin) { this.assignDriver(r, r.commuteVin); continue; }
      if (assigned.has(r.household)) continue;
      const rng = new Rng(w.seed ^ Math.imul(r.household, 0x85ebca6b));
      const owner = 'house:' + r.household;
      const owned = w.registry.owned(owner);
      const existing = [...owned ?? []].find(v => v.slot?.startsWith('parking:') && !v.stored && !v.taken && !v.reported);
      if (!existing && (owned?.size || !rng.chance(0.4))) continue;
      const lot = r.occupiedLot ?? scheduledLot(census, r, w.gameMinutes);
      const zone = w.city.blocks[w.city.lots[lot].block].zone;
      const models = ZONES[zone].parked.filter(e => {
        const spec = VEHICLES[vehicleIndex(e.id)];
        return spec.movement === 'wheels' && !spec.trailer && spec.length < 7;
      });
      if (!existing && !models.length) continue;
      const model = existing?.model ?? rng.weighted(models).id;
      const spec = VEHICLES[vehicleIndex(model)];
      const car = existing ?? { vin: newVin(), model, owner, color: rng.pick(paletteFor(spec.colors)),
        hp: spec.hp, angle: 0, at: { x: 0, y: 0 }, parked: { x: 0, y: 0 }, taken: false, reported: false, disguised: false };
      if (!this.park(car, lot)) continue;
      this.assignDriver(r, car.vin);
      if (!r.walk) r.occupiedLot = lot;
      assigned.add(r.household);
    }
    census.householdParkingSeeded = true;
  }

  private nearby(lot: number) {
    const cached = this.bays.get(lot);
    if (cached) return cached;
    const door = buildingAccess(this.w, lot).entrance;
    const cx = Math.floor(door.x / RANGE), cy = Math.floor(door.y / RANGE);
    const indices: number[] = [];
    const dist = (i: number) => {
      const s = this.w.city.parking[i];
      return (s.x - door.x) ** 2 + (s.y - door.y) ** 2;
    };
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const i of this.buckets.get(cell(x, y)) ?? []) if (dist(i) <= RANGE ** 2) indices.push(i);
    }
    indices.sort((a, b) => dist(a) - dist(b));
    this.bays.set(lot, indices);
    return indices;
  }

  private crowdedCurb(index: number, car: Registration) {
    const bay = this.w.city.parking[index];
    const cx = Math.floor(bay.x / RANGE), cy = Math.floor(bay.y / RANGE);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const other of this.buckets.get(cell(x, y)) ?? []) {
        const s = this.w.city.parking[other];
        if (s.angle !== bay.angle || Math.hypot(s.x - bay.x, s.y - bay.y) >= 12) continue;
        const occupied = this.w.registry.atSlot('parking:' + other);
        if (occupied && occupied !== car) return true;
      }
    }
    return false;
  }

  park(car: Registration, lot: number): boolean {
    if (car.taken || car.reported || car.stored || car.holder || this.w.registry.liveVehicle(car.vin)) return false;
    const spec = VEHICLES[vehicleIndex(car.model)];
    for (const i of this.nearby(lot)) {
      const slot = 'parking:' + i;
      if (car.slot === slot) { car.parkedLot = lot; return true; }
      const bay = this.w.city.parking[i];
      // Leave enough room to swing out of a parallel space even at shift change.
      if (bay.lot === undefined && this.crowdedCurb(i, car)) continue;
      if (this.w.registry.atSlot(slot) || this.w.nearestPlayerDist2(bay.x, bay.y) < 70 ** 2 || !parkingFits(this.w, spec, bay)) continue;
      this.w.registry.parkHousehold(car, i);
      car.parkedLot = lot;
      return true;
    }
    return false;
  }
}
