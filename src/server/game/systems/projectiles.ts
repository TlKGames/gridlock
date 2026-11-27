// Projectile flight, impacts, grenade fuses, molotov fires and burning.
import { WEAPONS } from '../../../shared/packs';
import { flies } from '../../../shared/sim/kinds';
import { FX } from '../../../shared/protocol';
import { damagePed, damageVehicle, explode, spawnFire } from '../combat/damage';
import { rayVehicle } from '../combat/fire';
import type { Projectile } from '../entities';
import type { World } from '../world';

const G = 9.8;

export function updateProjectiles(w: World, dt: number): void {
  for (const pr of w.projectiles.values()) {
    const spec = WEAPONS[pr.weapon];
    const p = spec.projectile!;
    pr.life -= dt;
    const arc = !!p.arc;
    const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
    if (arc) pr.vz -= G * dt;
    // z is above the ground under it. A lob is carried over the rise or fall of the land (world/
    // terrain.ts), so a throw down a slope carries on and one up it lands short; a straight shot
    // keeps its height over the ground, as a bullet's line does (aim is flat on the map).
    let nz = pr.z + pr.vz * dt + (arc ? w.statics.groundAt(pr.x, pr.y) - w.statics.groundAt(nx, ny) : 0);

    const wall = w.statics.raycast(pr.x, pr.y, nx, ny, Math.max(0.3, nz));
    if (wall) {
      if (arc) {
        // Bounce off walls.
        const hx = pr.x + (nx - pr.x) * wall.t, hy = pr.y + (ny - pr.y) * wall.t;
        if (wall.nx) pr.vx = -pr.vx * 0.4; else pr.vy = -pr.vy * 0.4;
        pr.x = hx + wall.nx * 0.2; pr.y = hy + wall.ny * 0.2;
        if (p.fire) { detonate(w, pr); continue; }
      } else {
        detonate(w, pr, pr.x + (nx - pr.x) * wall.t, pr.y + (ny - pr.y) * wall.t);
        continue;
      }
    } else {
      pr.x = nx; pr.y = ny;
    }

    if (nz <= 0) {
      if (w.map.isWater(pr.x, pr.y)) { w.emit(FX.Splash, Math.round(pr.x), Math.round(pr.y)); w.projectiles.delete(pr.id); continue; }
      if (p.fire || !arc) { detonate(w, pr); continue; }
      nz = 0;
      pr.vz = -pr.vz * 0.35;
      pr.vx *= 0.55; pr.vy *= 0.55;
      if (Math.abs(pr.vz) < 1) pr.vz = 0;
    }
    pr.z = nz;

    if (!arc && contact(w, pr)) { detonate(w, pr); continue; }
    if (p.fuse) {
      pr.fuse -= dt;
      if (pr.fuse <= 0) { detonate(w, pr); continue; }
    }
    if (pr.life <= 0) detonate(w, pr);
  }
}

function contact(w: World, pr: Projectile): boolean {
  if (pr.z > 3.5) {
    // High-flying rockets can still hit helicopters.
    let hit = false;
    w.vehiclesNear(pr.x, pr.y, 8, (v) => {
      if (v.id !== w.peds.get(pr.owner)?.vehicle && flies(v.spec) && Math.abs(v.body.alt - pr.z) < 3
        && rayVehicle(pr.x - pr.vx * 0.05, pr.y - pr.vy * 0.05, pr.vx * 0.1, pr.vy * 0.1, v) !== null) hit = true;
    });
    return hit;
  }
  let hit = false;
  w.pedsNear(pr.x, pr.y, 0.8, (o) => { if (o.id !== pr.owner && !o.dead) hit = true; });
  if (hit) return true;
  const ownVeh = w.peds.get(pr.owner)?.vehicle ?? 0;
  w.vehiclesNear(pr.x, pr.y, 8, (v) => {
    if (v.id === ownVeh || (flies(v.spec) && v.body.alt > 3)) return;
    if (rayVehicle(pr.x - pr.vx * 0.05, pr.y - pr.vy * 0.05, pr.vx * 0.1, pr.vy * 0.1, v) !== null) hit = true;
  });
  return hit;
}

function detonate(w: World, pr: Projectile, x = pr.x, y = pr.y): void {
  const p = WEAPONS[pr.weapon].projectile!;
  w.projectiles.delete(pr.id);
  if (w.map.isWater(x, y)) { w.emit(FX.Splash, Math.round(x), Math.round(y)); return; }
  if (p.fire) {
    w.emit(FX.Boom, Math.round(x * 10) / 10, Math.round(y * 10) / 10, 2);
    for (let k = 0; k < 6; k++) {
      const a = w.rng.next() * Math.PI * 2, d = w.rng.range(0, p.radius * 0.7);
      spawnFire(w, x + Math.cos(a) * d, y + Math.sin(a) * d, w.rng.range(1.4, 2.4), w.rng.range(6, 10), pr.owner);
    }
    return;
  }
  explode(w, x, y, p.radius, p.blast, pr.owner);
}

export function updateFires(w: World, dt: number): void {
  const pulse = Math.floor(w.time * 4) !== Math.floor((w.time - dt) * 4);
  for (const f of w.fires.values()) {
    f.life -= dt;
    if (f.life <= 0) { w.fires.delete(f.id); continue; }
    if (!pulse) continue;
    w.pedsNear(f.x, f.y, f.r + 0.4, (p) => {
      if (p.dead) return;
      p.burning = Math.max(p.burning, 3);
      damagePed(w, p, 4, f.owner, { fire: true });
    });
    w.vehiclesNear(f.x, f.y, f.r + 3, (v) => {
      if (flies(v.spec) && v.body.alt > 2) return;
      if (Math.hypot(v.body.x - f.x, v.body.y - f.y) < f.r + v.spec.width) damageVehicle(w, v, 9, f.owner);
    });
  }
  // Burning peds.
  for (const p of w.peds.values()) {
    if (p.burning <= 0 || p.dead) continue;
    p.burning -= dt;
    if (p.vehicle) { p.burning = 0; continue; }
    if (w.map.isWater(p.body.x, p.body.y)) { p.burning = 0; continue; }
    damagePed(w, p, 13 * dt, p.lastHitBy, { fire: true });
  }
}
