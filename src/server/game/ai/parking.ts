// A curb manoeuvre needs space for the whole vehicle between its lane and the curb.
import { obbVsObb, type Obb } from '../../../shared/sim/dynamic';
import type { VehicleSpec } from '../../../shared/packs/types';
import { angleDiff } from '../../../shared/math';
import type { Vehicle } from '../entities';
import type { World } from '../world';
import { curbSpots } from '../../../shared/world/city';
import type { ParkSpot, Segment } from '../../../shared/world/cityTypes';
import type { Destination } from './commute';

const curbByStreet = new WeakMap<Segment, ParkSpot[]>();
type Pose = { x: number; y: number; angle: number };

export function parkingFits(w: World, spec: VehicleSpec, pose: Pose, self?: Vehicle): boolean {
  const footprint: Obb = { ...pose, hl: spec.length / 2 + 0.35, hw: spec.width / 2 + 0.15 };
  if (w.statics.resolveObb({ ...pose }, footprint.hl, footprint.hw)) return false;
  // The live collection includes cars placed earlier in the same population tick.
  for (const other of w.vehicles.values()) {
    if (other === self || other.body.alt > 2) continue;
    for (const at of [other.body, other.parkingTarget]) {
      if (!at || Math.abs(at.x - pose.x) + Math.abs(at.y - pose.y) > (spec.length + other.spec.length + 4)) continue;
      if (obbVsObb(footprint, { ...at, hl: other.spec.length / 2, hw: other.spec.width / 2 })) return false;
    }
  }
  return true;
}

function clearParkingApproach(w: World, v: Vehicle, pose: Pose): boolean {
  const b = v.body, dx = pose.x - b.x, dy = pose.y - b.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const heading = Math.atan2(dy, dx);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const angle = i === steps ? pose.angle : b.angle + angleDiff(b.angle, heading) * Math.min(1, 3 * t);
    if (!parkingFits(w, v.spec, { x: b.x + dx * t, y: b.y + dy * t, angle }, v)) return false;
  }
  return true;
}

export function chooseCurb(w: World, v: Vehicle, goal: Destination) {
  const b = v.body;
  const current = v.parkingTarget;
  if (current?.lot === goal.lot && clearParkingApproach(w, v, current)) return current;
  const { seg } = w.map.nearestSegment(b.x, b.y);
  if (!seg.parking) return;
  let spots = curbByStreet.get(seg);
  if (!spots) {
    spots = curbSpots([seg], w.city.nodes);
    curbByStreet.set(seg, spots);
  }
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const candidates = spots.filter(spot => {
    const dx = spot.x - b.x, dy = spot.y - b.y;
    const ahead = dx * c + dy * s;
    return ahead > 4 && ahead < 22 && Math.abs(angleDiff(b.angle, spot.angle)) < 0.7;
  });
  const distance = (p: Pose) => Math.hypot(p.x - goal.pullOver.x, p.y - goal.pullOver.y);
  for (const spot of candidates.sort((a, b) => distance(a) - distance(b))) {
    const i = w.registry.parkingIndex(spot.x, spot.y);
    if (i !== undefined && w.registry.atSlot('parking:' + i)) continue;
    if (clearParkingApproach(w, v, spot)) return { ...spot, lot: goal.lot };
  }
}
