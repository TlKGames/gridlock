// Keeps the streets alive around players: ambient peds, traffic, parked cars, and
// the fixed vehicles/guards at services. Despawns what nobody can see.
import { dist2 } from '../../../shared/math';
import { flies } from '../../../shared/sim/kinds';
import { type PedArchetype, PEDS, ROLE_CREWS, RULES, SERVICES, VEHICLES, ZONES, pedIndex, pedWith, vehicleIndex } from '../../../shared/packs';
import type { Ped } from '../entities';
import { removePed, removeVehicle, seatPed, spawnPed, spawnVehicle } from '../factory';
import { setTask } from '../ai/tasks';
import type { World } from '../world';
import { gangCarColor, gangMember, pedPool, turfGang } from '../../../shared/world/gangTurf';
import { laneSpawn, pedSpawn } from './spawnPoints';
import { groundOf } from '../../../shared/world/levels';
import { mooredBoats } from './moorings';

/** Gang rides added to the traffic on turf. */
const GANG_CARS = VEHICLES.filter((v) => v.roles.includes('gang')).map((v) => ({ id: v.id, weight: 2.5 }));

interface FixedSpawn { x: number; y: number; angle: number; type: number; veh: number; readyAt: number }
/** `indoor`: under a roof (a clerk), so it may appear close by; others only out of sight (60 m+). */
interface FixedGuard { x: number; y: number; angle: number; arch: number; ped: number; readyAt: number; indoor?: boolean }

const STANDERS = new Set(['dealer', 'streetwalker', 'guard', 'gang']);

/** The pack's crew for a vehicle type: the first of its roles that ROLE_CREWS lists. */
const roleCrew = (type: number) => {
  const role = VEHICLES[type].roles.find((r) => ROLE_CREWS[r]);
  return role ? ROLE_CREWS[role] : undefined;
};
const BUCKET = 64;

export class Population {
  private fixed: FixedSpawn[] = [];
  private guards: FixedGuard[] = [];
  private spotState = new Map<number, number>();   // parking spot -> vehicle id (0 = rolled empty)
  private spotBuckets = new Map<number, number[]>();
  private timer = 0;

  constructor(private w: World) {
    w.city.parking.forEach((s, i) => {
      const k = Math.floor(s.y / BUCKET) * 64 + Math.floor(s.x / BUCKET);
      let arr = this.spotBuckets.get(k);
      if (!arr) { arr = []; this.spotBuckets.set(k, arr); }
      arr.push(i);
    });
    this.buildFixed();
  }

  private buildFixed(): void {
    const w = this.w;
    for (const m of mooredBoats(w)) this.fixed.push({ ...m, veh: 0, readyAt: 0 });
    // A clerk behind every walk-in counter (world/interiors.ts), kept like the services' guards.
    for (const i of w.city.interiors) {
      if (i.clerkArch) this.guards.push({ x: i.clerk.x, y: i.clerk.y, angle: i.clerk.angle, arch: pedIndex(i.clerkArch), ped: 0, readyAt: 0, indoor: true });
      for (const g of i.guards) this.guards.push({ x: g.spot.x, y: g.spot.y, angle: g.spot.angle, arch: pedIndex(g.arch), ped: 0, readyAt: 0, indoor: true });
    }
    for (const place of w.city.services) {
      const spec = SERVICES[place.spec];
      const pad = place.pad ?? { x: place.x, y: place.y, angle: 0 };
      if (spec.verb === 'military') {
        const lot = w.city.lots[place.lot];
        const block = w.city.blocks[lot.block];
        const spots = block.lots.map((i) => w.city.lots[i]).filter((l) => l.use === 'pad' || l.use === 'parking')
          .map((l) => ({ x: (l.rect.x0 + l.rect.x1) / 2, y: (l.rect.y0 + l.rect.y1) / 2 }));
        let k = 0;
        for (const s of spec.spawns ?? []) {
          for (let n = 0; n < s.count; n++, k++) {
            const at = spots[k % spots.length] ?? pad;
            const off = Math.floor(k / Math.max(1, spots.length)) * 9 - 4;
            this.fixed.push({ x: at.x + off, y: at.y, angle: -Math.PI / 2, type: vehicleIndex(s.vehicle), veh: 0, readyAt: 0 });
          }
        }
        for (const g of spec.guards ?? []) {
          for (let n = 0; n < g.count; n++) {
            const at = spots[n % Math.max(1, spots.length)] ?? pad;
            this.guards.push({ x: at.x + (n % 2 ? 10 : -10), y: at.y + 6, angle: n * 1.3, arch: pedIndex(g.archetype), ped: 0, readyAt: 0 });
          }
        }
        continue;
      }
      const rx = -Math.sin(pad.angle), ry = Math.cos(pad.angle);
      let k = 0;
      for (const s of spec.spawns ?? []) {
        for (let n = 0; n < s.count; n++, k++) {
          const off = (k - ((spec.spawns!.reduce((a, b) => a + b.count, 0) - 1) / 2)) * (flies(VEHICLES[vehicleIndex(s.vehicle)]) ? 14 : 4.5);
          this.fixed.push({ x: pad.x + rx * off, y: pad.y + ry * off, angle: pad.angle, type: vehicleIndex(s.vehicle), veh: 0, readyAt: 0 });
        }
      }
      for (const g of spec.guards ?? []) {
        for (let n = 0; n < g.count; n++) {
          this.guards.push({ x: place.x + rx * (2 + n * 1.5), y: place.y + ry * (2 + n * 1.5), angle: pad.angle + Math.PI, arch: pedIndex(g.archetype), ped: 0, readyAt: 0 });
        }
      }
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    this.despawn();
    for (const pl of this.w.players.values()) {
      const p = this.w.peds.get(pl.pid);
      if (!p) continue;
      const pos = groundOf(this.w.pedPos(p).x, this.w.pedPos(p).y); // upstairs: the street below
      this.ambientPeds(pos.x, pos.y);
      this.traffic(pos.x, pos.y);
    }
    this.parked();
    this.fixedSpawns();
  }

  private countNear(x: number, y: number, r: number): { peds: number; cars: number } {
    let peds = 0, cars = 0;
    const r2 = r * r;
    // Measured over the ground: riders on a train's viaduct are round here too.
    const d2 = (bx: number, by: number) => { const g = groundOf(bx, by); return dist2(x, y, g.x, g.y); };
    for (const p of this.w.peds.values()) {
      if (!p.player && !p.persistent && !p.dead && !p.vehicle && d2(p.body.x, p.body.y) < r2) peds++;
    }
    for (const v of this.w.vehicles.values()) {
      if (v.seats[0] && !v.persistent && d2(v.body.x, v.body.y) < r2) {
        const d = this.w.peds.get(v.seats[0]);
        if (d && !d.player) cars++;
      }
    }
    return { peds, cars };
  }

  private totals(): { peds: number; cars: number } {
    let cars = 0;
    for (const v of this.w.vehicles.values()) if (v.seats[0]) cars++;
    return { peds: this.w.peds.size, cars };
  }

  private ambientPeds(x: number, y: number): void {
    const w = this.w;
    const zi = w.map.zoneAt(x, y);
    if (zi < 0) return;
    const z = ZONES[zi];
    const want = Math.min(RULES.pedCapPerPlayer, Math.max(4, z.pedDensity * 4.5));
    const have = this.countNear(x, y, 170).peds;
    const cap = Math.min(RULES.pedCap, RULES.pedCapPerPlayer * w.players.size);
    for (let k = 0; k < Math.min(3, want - have) && this.totals().peds < cap; k++) {
      const s = pedSpawn(w, x, y, RULES.spawnRadius[0], RULES.spawnRadius[1]);
      if (!s) continue;
      const arch = pedIndex(w.rng.weighted(pedPool(s.block.zone, s.block.district)).id);
      const spec = PEDS[arch];
      const group = spec.behaviour === 'gang' ? w.rng.int(2, 4) : 1;
      for (let g = 0; g < group; g++) {
        const p = spawnPed(w, arch, s.spot.x + g * 0.9, s.spot.y + g * 0.6, s.spot.angle);
        this.initNpc(p, spec, s.spot, s.block.id);
      }
    }
  }

  private initNpc(p: Ped, spec: PedArchetype, spot: { x: number; y: number; angle: number }, block: number): void {
    const ai = p.ai!;
    ai.block = block;
    if (STANDERS.has(spec.behaviour) && this.w.rng.chance(0.75)) {
      ai.post = { x: p.body.x, y: p.body.y, angle: spot.angle };
      setTask(p, 'stand');
    } else {
      setTask(p, 'wander');
      ai.corner = Math.floor(this.w.rng.next() * 4);
    }
  }

  private driverFor(vehicleType: number, zone: number, gang: string | null): number {
    const spec = VEHICLES[vehicleType];
    const rc = roleCrew(vehicleType);
    if (rc) return pedIndex(rc.driver);
    const z = ZONES[zone];
    if (gang && spec.roles.includes('gang')) return gangMember(gang);
    const civs = z.peds.filter((e) => PEDS[pedIndex(e.id)].behaviour === 'civilian');
    return civs.length ? pedIndex(this.w.rng.weighted(civs).id) : Math.max(0, pedWith('civilian'));
  }

  private traffic(x: number, y: number): void {
    const w = this.w;
    const zi = w.map.zoneAt(x, y);
    if (zi < 0) return;
    const z = ZONES[zi];
    const want = Math.min(RULES.carCapPerPlayer, Math.max(4, z.trafficDensity * 18));
    const have = this.countNear(x, y, 180).cars;
    const cap = Math.min(RULES.carCap, RULES.carCapPerPlayer * w.players.size);
    for (let k = 0; k < Math.min(2, want - have) && this.totals().cars < cap; k++) {
      const s = laneSpawn(w, x, y, RULES.spawnRadius[0] + 10, RULES.spawnRadius[1]);
      if (!s) continue;
      const sz = w.map.zoneAt(s.x, s.y);
      const zone = sz < 0 ? zi : sz;
      // On gang turf the gang's own rides cruise too, in the gang's colours.
      const gang = turfGang(w.map.districtAt(s.x, s.y));
      const pool = gang ? [...ZONES[zone].traffic, ...GANG_CARS] : ZONES[zone].traffic;
      const type = vehicleIndex(w.rng.weighted(pool).id);
      const sp = VEHICLES[type];
      const gangRide = gang && sp.roles.includes('gang');
      const v = spawnVehicle(w, type, s.x, s.y, s.angle, gangRide ? gangCarColor(gang) ?? -1 : -1);
      v.body.vx = Math.cos(s.angle) * 8; v.body.vy = Math.sin(s.angle) * 8;
      const d = spawnPed(w, this.driverFor(type, zone, gang), s.x, s.y, s.angle);
      seatPed(w, d, v, 0);
      setTask(d, 'drive');
      const rc = roleCrew(type);
      if (rc?.partner && v.seats.length > 1 && w.rng.chance(rc.partnerChance ?? 1)) {
        const partner = spawnPed(w, pedIndex(rc.partner), s.x, s.y);
        seatPed(w, partner, v, 1);
        setTask(partner, 'none');
        partner.ai!.crew = rc.crew ? v.id : 0;
      }
      d.ai!.crew = rc?.crew ? v.id : 0;
    }
  }

  private parked(): void {
    const w = this.w;
    const seen = new Set<number>();
    for (const pl of w.players.values()) {
      const p = w.peds.get(pl.pid);
      if (!p) continue;
      const pos = w.pedPos(p);
      const i0 = Math.floor((pos.x - 170) / BUCKET), i1 = Math.floor((pos.x + 170) / BUCKET);
      const j0 = Math.floor((pos.y - 170) / BUCKET), j1 = Math.floor((pos.y + 170) / BUCKET);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        for (const si of this.spotBuckets.get(j * 64 + i) ?? []) seen.add(si);
      }
    }
    for (const si of seen) {
      if (this.spotState.has(si)) continue;
      const s = w.city.parking[si];
      if (w.nearestPlayerDist2(s.x, s.y) < 70 * 70) continue; // don't pop in view
      const z = ZONES[s.zone < 0 ? 0 : s.zone];
      const chance = s.lot !== undefined ? 0.3 : z.parkedDensity * 0.16;
      if (!w.rng.chance(chance) || w.vehicles.size > RULES.vehicleCap) { this.spotState.set(si, 0); continue; }
      const type = vehicleIndex(w.rng.weighted(z.parked).id);
      const gang = turfGang(w.map.districtAt(s.x, s.y));
      const tint = gang && VEHICLES[type].roles.includes('gang') ? gangCarColor(gang) ?? -1 : -1;
      const v = spawnVehicle(w, type, s.x, s.y, s.angle, tint);
      v.spot = si;
      this.spotState.set(si, v.id);
    }
    for (const [si, vid] of this.spotState) {
      if (seen.has(si)) continue;
      this.spotState.delete(si);
      const v = vid ? w.vehicles.get(vid) : undefined;
      if (v && v.spot === si && !v.seats.some((s) => s) && !v.persistent && !v.owner) removeVehicle(w, v);
    }
  }

  private fixedSpawns(): void {
    const w = this.w;
    for (const f of this.fixed) {
      const near = w.nearestPlayerDist2(f.x, f.y);
      const v = f.veh ? w.vehicles.get(f.veh) : undefined;
      if (v && dist2(v.body.x, v.body.y, f.x, f.y) > 15 * 15) { f.veh = 0; f.readyAt = w.time + 150; v.spot = -1; continue; }
      if (!v) f.veh = 0;
      if (v && near > 300 * 300 && !v.seats.some((s) => s)) { removeVehicle(w, v); f.veh = 0; continue; }
      if (!f.veh && near < 240 * 240 && near > 60 * 60 && w.time >= f.readyAt) {
        let blocked = false;
        w.vehiclesNear(f.x, f.y, 5, () => { blocked = true; });
        if (blocked) continue;
        const nv = spawnVehicle(w, f.type, f.x, f.y, f.angle);
        nv.spot = -2;
        f.veh = nv.id;
      }
    }
    for (const g of this.guards) {
      const near = w.nearestPlayerDist2(g.x, g.y);
      const p = g.ped ? w.peds.get(g.ped) : undefined;
      if (p && p.dead) { g.ped = 0; g.readyAt = w.time + 120; continue; }
      if (!p) g.ped = 0;
      if (p && near > 300 * 300) { removePed(w, p); g.ped = 0; continue; }
      if (!g.ped && near < 220 * 220 && (g.indoor || near > 60 * 60) && w.time >= g.readyAt) {
        const np = spawnPed(w, g.arch, g.x, g.y, g.angle);
        np.persistent = true;
        np.ai!.post = { x: g.x, y: g.y, angle: g.angle };
        setTask(np, 'stand');
        g.ped = np.id;
      }
    }
  }

  private despawn(): void {
    const w = this.w;
    const far2 = RULES.despawnRadius * RULES.despawnRadius;
    for (const v of w.vehicles.values()) {
      if (v.owner || v.persistent) continue;
      if (v.seats.some((s) => s && w.peds.get(s)?.player)) continue;
      const near = w.nearestPlayerDist2(v.body.x, v.body.y);
      const unseen = near > 90 * 90;
      // Wrecks clear once out of view after 25 s (and after 2 min regardless, unless right by you).
      const wreckGone = v.wrecked && ((v.wreckT > 25 && unseen) || (v.wreckT > 120 && near > 35 * 35));
      // Abandoned or hopelessly stuck cars on the street clear once nobody's looking.
      const stalled = v.spot < 0 && v.spot !== -2 && v.idleT > 25 && unseen;
      if (wreckGone || stalled || (near > far2 && v.spot < 0 && v.spot !== -2)) removeVehicle(w, v);
    }
    for (const p of w.peds.values()) {
      if (p.player || p.persistent || p.vehicle) continue;
      const near = w.nearestPlayerDist2(p.body.x, p.body.y);
      if (near > far2 || (p.dead && p.deadT > 75 && near > 50 * 50) || (p.dead && p.deadT > 180)) removePed(w, p);
    }
  }
}
