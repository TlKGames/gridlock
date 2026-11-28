// Home and work indexes cover the whole room; only nearby, currently scheduled residents spawn.
import { RULES, pedIndex, pedWith } from '../../shared/packs';
import { removePed, seatPed, spawnPed } from './factory';
import { setTask } from './ai/tasks';
import { destination, pickupDestination, checkpointWalk, indoorSpot, resumeRoute, walkPosition, type Destination } from './ai/commute';
import type { Ped } from './entities';
import { assignFamilyNames } from './familyNames';
import type { Census, Resident } from './census';
import { scheduledLot } from './census';
import type { HouseholdParking } from './householdParking';
import type { World } from './world';

const CELL = 120;
const key = (x: number, y: number) => x + ':' + y;

export class ResidentPool {
  private cells = new Map<string, { resident: Resident; lot: number }[]>();
  private destinations = new Map<number, Destination>();
  private occupants = new Set<Resident>();
  private walking = new Set<Resident>();
  private active = new Map<number, number>();

  constructor(private w: World, private census: Census, private parking?: HouseholdParking) {
    assignFamilyNames(census, w.seed);
    for (const resident of census.residents) {
      if (resident.occupiedLot !== undefined) this.occupants.add(resident);
      if (resident.walk) this.walking.add(resident);
      const home = census.households[resident.household - 1].lot;
      this.index(resident, home);
      if (resident.job && resident.job.lot !== home) this.index(resident, resident.job.lot);
    }
  }

  private index(resident: Resident, lot: number): void {
    const r = this.w.city.lots[lot].rect;
    const cell = key(Math.floor((r.x0 + r.x1) / (2 * CELL)), Math.floor((r.y0 + r.y1) / (2 * CELL)));
    let entries = this.cells.get(cell);
    if (!entries) this.cells.set(cell, entries = []);
    entries.push({ resident, lot });
  }

  nearby(x: number, y: number, eligible?: (r: Resident) => boolean): Resident | undefined {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    const candidates: Resident[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const { resident, lot } of this.cells.get(key(cx + dx, cy + dy)) ?? []) {
        if (resident.deceased || resident.occupiedLot !== undefined || this.walking.has(resident) || this.w.peds.has(this.active.get(resident.id) ?? 0)) continue;
        if ((!eligible || eligible(resident)) && scheduledLot(this.census, resident, this.w.gameMinutes) === lot) candidates.push(resident);
      }
    }
    return candidates.length ? this.w.rng.pick(candidates) : undefined;
  }

  checkpoint(ped: Ped): void {
    if (!ped.resident) return;
    if (ped.resident.occupiedLot !== undefined) this.occupants.add(ped.resident);
    delete ped.resident.walk;
    if (ped.collectingVin && ped.commute) {
      ped.resident.occupiedLot = ped.commute.lot;
      this.occupants.add(ped.resident);
    } else checkpointWalk(this.w, ped);
    if (ped.resident.walk) this.walking.add(ped.resident);
    else this.walking.delete(ped.resident);
  }

  resumeWalks(): void {
    const w = this.w;
    for (const r of this.walking) {
      if (w.peds.has(this.active.get(r.id) ?? 0)) continue;
      const pos = r.walk && !r.deceased && scheduledLot(this.census, r, w.gameMinutes) === r.walk.lot
        ? walkPosition(w, r.walk) : null;
      if (!pos) {
        if (!r.deceased && r.walk && scheduledLot(this.census, r, w.gameMinutes) === r.walk.lot) {
          r.occupiedLot = r.walk.lot;
          this.occupants.add(r);
        }
        delete r.walk;
        this.walking.delete(r);
        continue;
      }
      if (w.peds.size >= Math.min(RULES.pedCap, w.players.size * RULES.pedCapPerPlayer)) continue;
      if (w.nearestPlayerDist2(pos.x, pos.y) > RULES.spawnRadius[1] ** 2 || w.map.isWater(pos.x, pos.y)) continue;
      const probe = { ...pos };
      if (w.statics.resolveCircle(probe, 0.4)) continue;
      const arch = pedIndex(r.archetype!);
      const ped = spawnPed(w, arch, pos.x, pos.y);
      const steps = r.walk!.points.slice(pos.index);
      const crossing = !!steps[0]?.cross && w.map.onRoad(pos.x, pos.y);
      this.bind(r, ped);
      resumeRoute(ped, steps, crossing);
      setTask(ped, 'wander');
    }
  }

  private goal(lot: number): Destination {
    let goal = this.destinations.get(lot);
    if (!goal) { goal = destination(this.w, lot); this.destinations.set(lot, goal); }
    return goal;
  }

  private nearLot(lot: number): boolean {
    const rect = this.w.city.lots[lot].rect;
    return this.w.nearestPlayerDist2((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2) < (RULES.spawnRadius[1] + 30) ** 2;
  }

  private nextParkingUpdate = 0;
  update(): void {
    if (this.parking && this.w.time >= this.nextParkingUpdate) {
      this.nextParkingUpdate = this.w.time + 3;
      for (const r of this.parking.driverByVin.values()) {
        if (r.deceased || r.walk || this.w.peds.has(this.active.get(r.id) ?? 0)) continue;
        const lot = scheduledLot(this.census, r, this.w.gameMinutes);
        if (r.occupiedLot === lot) continue;
        const car = this.w.registry.find(r.commuteVin!);
        if (r.occupiedLot !== undefined && this.nearLot(r.occupiedLot)) continue;
        if (car && this.w.nearestPlayerDist2(car.parked.x, car.parked.y) < RULES.spawnRadius[1] ** 2) continue;
        // The resident can travel without a missing or impounded vehicle.
        if (!car || car.taken || car.reported || car.stored || this.parking.park(car, lot)) {
          r.occupiedLot = lot;
          this.occupants.add(r);
        }
      }
    }
    for (const r of this.occupants) {
      if (this.w.peds.has(this.active.get(r.id) ?? 0)) continue;
      const old = r.occupiedLot;
      if (old === undefined || r.deceased) { this.occupants.delete(r); continue; }
      const due = scheduledLot(this.census, r, this.w.gameMinutes) !== old;
      if (r.commuteVin && !this.nearLot(old)) continue;
      const goal = this.goal(old);
      const near = this.w.nearestPlayerDist2(goal.entrance.x, goal.entrance.y) < RULES.spawnRadius[1] ** 2;
      if (!near && due && !r.commuteVin) { delete r.occupiedLot; this.occupants.delete(r); continue; }
      if (!near || (!due && !goal.indoors)) continue;
      if (this.w.peds.size >= Math.min(RULES.pedCap, this.w.players.size * RULES.pedCapPerPlayer)) continue;
      const at = goal.indoors ? indoorSpot(this.w, goal, r.id) : goal.entrance;
      const arch = r.archetype ? pedIndex(r.archetype) : pedWith('civilian');
      const ped = spawnPed(this.w, arch, at.x, at.y);
      this.bind(r, ped);
      if (!due) { ped.arrivedAt = old; r.occupiedLot = old; }
      setTask(ped, 'wander');
    }
    for (const [id, pid] of this.active) {
      const ped = this.w.peds.get(pid);
      if (!ped?.resident) { this.active.delete(id); continue; }
      if (ped.collectingVin && !ped.dead && !ped.vehicle && ped.ai?.task === 'wander') {
        const r = this.w.registry.find(ped.collectingVin);
        if (r && Math.hypot(ped.body.x - r.parked.x, ped.body.y - r.parked.y) >= 4) continue;
        if (r) {
          this.w.registry.checkSpot(ped);
          const actual = this.w.registry.location(r);
          if (Math.hypot(actual.x - ped.body.x, actual.y - ped.body.y) < 6) {
            const car = this.w.registry.show(r);
            if (!car.wrecked && !car.seats[0]) { seatPed(this.w, ped, car, 0); setTask(ped, 'drive'); }
          }
        }
        ped.arrivedAt = undefined;
        if (ped.resident) delete ped.resident.occupiedLot;
        ped.collectingVin = undefined;
        ped.commute = undefined;
      }
      this.assign(ped, ped.resident);
      if (!ped.dead && !ped.vehicle && ped.ai?.task === 'wander' && ped.commute && !ped.commute.indoors &&
          ped.arrivedAt === ped.commute.lot && ped.resident.occupiedLot === ped.arrivedAt) {
        this.checkpoint(ped);
        removePed(this.w, ped);
        this.active.delete(id);
      }
    }
  }

  private assign(ped: Ped, resident: Resident): void {
    if (!resident.job) return;
    const lot = scheduledLot(this.census, resident, this.w.gameMinutes);
    if (ped.commute?.lot === lot) return;
    const previous = resident.occupiedLot ?? ped.arrivedAt;
    delete resident.occupiedLot;
    this.occupants.delete(resident);
    const goal = this.goal(lot);
    ped.commute = goal.indoors ? { ...goal, entrance: indoorSpot(this.w, goal, resident.id) } : goal;
    ped.arrivedAt = undefined;
    if (!ped.vehicle && previous !== undefined && previous !== lot) {
      for (const car of this.w.registry.owned('house:' + resident.household) ?? []) {
        const driver = this.parking?.driverByVin.get(car.vin);
        if ((driver && driver !== resident) || (resident.commuteVin && resident.commuteVin !== car.vin)) continue;
        if (car.stored || car.reported || (car.holder === car.owner) || Math.hypot(car.parked.x - ped.body.x, car.parked.y - ped.body.y) > 100) continue;
        ped.collectingVin = car.vin;
        ped.commute = pickupDestination(this.w, previous, car.parked);
        break;
      }
    }
  }

  bind(resident: Resident, ped: Ped): void {
    this.walking.delete(resident);
    delete resident.walk;
    this.assign(ped, resident);
    this.active.set(resident.id, ped.id);
    resident.archetype = ped.spec.id;
    ped.resident = resident;
    ped.npcName = resident.identity!.name;
  }
}
