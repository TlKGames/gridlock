// Persistent room residents. Unit numbers are logical addresses even in buildings without interiors.
import { PROPERTIES } from '../../shared/packs';
import { Rng } from '../../shared/rng';
import type { City } from '../../shared/world/cityTypes';

export interface Address {
  lot: number;
  homes: number;
  jobs: number;
}

export interface Household {
  id: number;
  lot: number;
  unit: number;
}

export interface Resident {
  id: number;
  household: number;
  job: { lot: number; start: number; duration: number } | null;
}

export interface Census {
  addresses: Address[];
  households: Household[];
  residents: Resident[];
}

export function createCensus(city: City, seed: number): Census {
  // Isolated stream: generating residents must never change streets, traffic, or mission rolls.
  const rng = new Rng(seed ^ 0x4c494645);
  const addresses: Address[] = [];
  const households: Household[] = [];
  const residents: Resident[] = [];
  const jobSlots: number[] = [];
  for (const building of city.buildings) {
    const lot = city.lots[building.lot];
    const property = lot.property === undefined ? undefined : PROPERTIES[lot.property];
    const residential = property ? property.kind === 'home' : lot.service === undefined &&
      (building.kind === 'house' || (building.kind === 'block' && rng.chance(0.45)));
    const homes = residential ? (building.kind === 'house' ? 1 : Math.max(1, Math.min(12, Math.floor(building.h / 3)))) : 0;
    const jobs = residential ? 0 : Math.max(2, Math.min(20, Math.ceil(building.h / 2)));
    addresses.push({ lot: lot.id, homes, jobs });
    for (let j = 0; j < jobs; j++) jobSlots.push(lot.id);
    for (let unit = 1; unit <= homes; unit++) {
      const id = households.length + 1;
      households.push({ id, lot: lot.id, unit });
      const size = rng.int(1, 3);
      for (let member = 0; member < size; member++) {
        residents.push({ id: residents.length + 1, household: id, job: null });
      }
    }
  }
  rng.shuffle(jobSlots);
  for (const person of rng.shuffle([...residents])) {
    if (!jobSlots.length) break;
    if (rng.chance(0.75)) {
      person.job = { lot: jobSlots.pop()!, start: rng.pick([0, 6, 8, 14, 16, 22]) * 60, duration: 480 };
    }
  }
  return { addresses, households, residents };
}

/** Scheduled destination, including shifts spanning midnight. No offscreen tick is required. */
export function scheduledLot(census: Census, resident: Resident, minutes: number): number {
  const job = resident.job;
  if (job && (minutes - job.start + 1440) % 1440 < job.duration) return job.lot;
  return census.households[resident.household - 1].lot;
}
