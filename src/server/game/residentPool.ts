// Home and work indexes cover the whole room; only nearby, currently scheduled residents spawn.
import { Rng } from '../../shared/rng';
import { generateName } from '../../shared/packs/characters';
import type { Census, Resident } from './census';
import { scheduledLot } from './census';
import type { World } from './world';

const CELL = 120;
const key = (x: number, y: number) => x + ':' + y;

export class ResidentPool {
  private cells = new Map<string, { resident: Resident; lot: number }[]>();
  private active = new Map<number, number>();

  constructor(private w: World, private census: Census) {
    for (const resident of census.residents) {
      if (!resident.identity) {
        const rng = new Rng(w.seed ^ Math.imul(resident.id, 0x85ebca6b));
        const gender = rng.chance(0.5) ? 'male' : 'female';
        resident.identity = { gender, name: generateName(() => rng.next(), gender) };
      }
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

  nearby(x: number, y: number): Resident | undefined {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    const candidates: Resident[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const { resident, lot } of this.cells.get(key(cx + dx, cy + dy)) ?? []) {
        if (resident.deceased || this.w.peds.has(this.active.get(resident.id) ?? 0)) continue;
        if (scheduledLot(this.census, resident, this.w.gameMinutes) === lot) candidates.push(resident);
      }
    }
    return candidates.length ? this.w.rng.pick(candidates) : undefined;
  }

  bind(resident: Resident, ped: import('./entities').Ped): void {
    this.active.set(resident.id, ped.id);
    resident.archetype = ped.spec.id;
    ped.resident = resident;
    ped.npcName = resident.identity!.name;
  }
}
