// Dynamic contacts: vehicle-vehicle, vehicle-ped and ped-ped.
import { clamp } from '../../../shared/math';
import { RULES } from '../../../shared/packs';
import { contactImpulse, impactYaw } from '../../../shared/sim/impact';
import { flies, floats } from '../../../shared/sim/kinds';
import { materialOf } from '../../../shared/materials';
import { FX } from '../../../shared/protocol';
import { PED_RADIUS } from '../../../shared/sim/physics';
import { obbVsCircle } from '../../../shared/world/collision';
import { type Hit, type Obb, obbVsObb } from '../../../shared/sim/dynamic';
import { damagePed, damageVehicle } from '../combat/damage';
import type { Vehicle } from '../entities';
import type { World } from '../world';

const box = (v: Vehicle): Obb => ({ x: v.body.x, y: v.body.y, angle: v.body.angle, hl: v.spec.length / 2, hw: v.spec.width / 2 });

const flying = (v: Vehicle) => flies(v.spec) && v.body.alt > 2;
/** Boats only meet boats (and swimmers): a boat passing under a bridge never touches the cars on it. */
const afloat = (v: Vehicle) => floats(v.spec);

export function resolveContacts(w: World): void {
  for (const a of w.vehicles.values()) {
    const A = a.body;
    const reach = a.spec.length / 2 + 7;
    w.vehHash.query(A.x, A.y, reach, (b) => {
      if (b.id <= a.id || flying(a) !== flying(b) || afloat(a) !== afloat(b)) return;
      if (flying(a) && Math.abs(a.body.alt - b.body.alt) > 4) return;
      const h = obbVsObb(box(a), box(b));
      if (h) vehicleHit(w, a, b, h);
    });
    if (flying(a)) continue;
    w.pedHash.query(A.x, A.y, reach, (p) => {
      if (p.vehicle || p.jumpT > 0) return; // hopping peds clear the car
      if (afloat(a) !== w.map.isWater(p.body.x, p.body.y)) return; // boats hit swimmers, cars walkers
      const c = Math.cos(A.angle), s = Math.sin(A.angle);
      const h = obbVsCircle(A.x, A.y, c, s, a.spec.length / 2, a.spec.width / 2, { x: p.body.x, y: p.body.y, r: PED_RADIUS });
      if (!h) return;
      // h pushes the vehicle; the ped goes the other way. Only the car's own speed toward the
      // ped counts: running into a parked car must not floor you.
      const rel = A.vx * -h.nx + A.vy * -h.ny;
      p.body.x -= h.nx * h.depth; p.body.y -= h.ny * h.depth;
      if (p.dead) return;
      if (rel > (p.player ? 7 : 5)) {
        const driver = a.seats[0];
        p.body.vx = A.vx * 0.8 - h.nx * rel * 0.3; p.body.vy = A.vy * 0.8 - h.ny * rel * 0.3;
        p.down = Math.max(p.down, 1.2);
        damagePed(w, p, rel * rel * 0.32 * clamp(a.spec.mass / 1400, 0.4, 3), driver, { vehicle: true });
        A.vx *= 0.97; A.vy *= 0.97;
      } else {
        p.body.vx -= h.nx * 1.5; p.body.vy -= h.ny * 1.5;
      }
    });
  }
  // Peds push each other apart.
  for (const p of w.peds.values()) {
    if (p.vehicle || p.dead) continue;
    w.pedHash.query(p.body.x, p.body.y, 1, (o) => {
      if (o.id <= p.id || o.dead || o.vehicle) return;
      const dx = o.body.x - p.body.x, dy = o.body.y - p.body.y;
      const d2 = dx * dx + dy * dy, min = PED_RADIUS * 2;
      if (d2 >= min * min) return;
      const d = Math.sqrt(d2), push = (min - d) / 2;
      // Spawning at an identical position has no separation normal.
      const nx = d > 0 ? dx / d : Math.cos(p.body.angle + Math.PI / 2);
      const ny = d > 0 ? dy / d : Math.sin(p.body.angle + Math.PI / 2);
      p.body.x -= nx * push; p.body.y -= ny * push;
      o.body.x += nx * push; o.body.y += ny * push;
      w.statics.resolveCircle(p.body, PED_RADIUS);
      w.statics.resolveCircle(o.body, PED_RADIUS);
    });
  }
}

function vehicleHit(w: World, a: Vehicle, b: Vehicle, h: Hit): void {
  let ma = a.spec.mass, mb = b.spec.mass;
  if (a.spec.crushes && !b.spec.crushes) mb *= 0.1;
  if (b.spec.crushes && !a.spec.crushes) ma *= 0.1;
  const ka = mb / (ma + mb), kb = ma / (ma + mb);
  a.body.x += h.nx * h.depth * ka; a.body.y += h.ny * h.depth * ka;
  b.body.x -= h.nx * h.depth * kb; b.body.y -= h.ny * h.depth * kb;
  const vn = (a.body.vx - b.body.vx) * h.nx + (a.body.vy - b.body.vy) * h.ny;
  if (vn >= 0) return;
  const impact = -vn;
  if (afloat(a) || (a.spec.movement === 'wheels' && b.spec.movement === 'wheels')) {
    const impulse = contactImpulse(a.body.vx - b.body.vx, a.body.vy - b.body.vy, h.nx, h.ny, afloat(a));
    a.body.vx += ka * impulse.x; a.body.vy += ka * impulse.y;
    b.body.vx -= kb * impulse.x; b.body.vy -= kb * impulse.y;
    a.body.av += ka * impactYaw(a.body.angle, h.nx, h.ny, impact, a.spec.length);
    b.body.av += kb * impactYaw(b.body.angle, -h.nx, -h.ny, impact, b.spec.length);
  } else {
    const e = 0.25;
    const j = (-(1 + e) * vn) / (1 / ma + 1 / mb);
    a.body.vx += (j / ma) * h.nx; a.body.vy += (j / ma) * h.ny;
    b.body.vx -= (j / mb) * h.nx; b.body.vy -= (j / mb) * h.ny;
    a.body.av += (w.rng.next() - 0.5) * impact * 0.04 * ka;
    b.body.av += (w.rng.next() - 0.5) * impact * 0.04 * kb;
  }
  if (impact > RULES.crashSafe) {
    const base = (impact - RULES.crashSafe) * RULES.crashDamage;
    const da = a.seats[0], db = b.seats[0];
    // Each takes the dent on the side facing the other (the normal points from b towards a).
    damageVehicle(w, a, base * clamp(mb / ma, 0.15, 4) * (b.spec.crushes ? 4 : 1), db, { x: a.body.x - h.nx * 50, y: a.body.y - h.ny * 50 });
    damageVehicle(w, b, base * clamp(ma / mb, 0.15, 4) * (a.spec.crushes ? 4 : 1), da, { x: b.body.x + h.nx * 50, y: b.body.y + h.ny * 50 });
    // Metal on metal strikes sparks (a horse or a wagon doesn't: shared/materials.ts).
    if (impact > 8 && materialOf(a.spec).dents && materialOf(b.spec).dents) w.emit(FX.Spark, Math.round((a.body.x + b.body.x) / 2), Math.round((a.body.y + b.body.y) / 2));
    for (const v of [a, b]) {
      for (const sid of v.seats) {
        const occ = sid ? w.peds.get(sid) : undefined;
        if (occ && impact > 14) damagePed(w, occ, (impact - 14) * (v.spec.openTop ? 6 : 1.5), 0, { vehicle: true });
      }
    }
  }
}
