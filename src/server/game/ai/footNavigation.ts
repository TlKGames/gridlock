// Local foot navigation. Door and lift routing supply the destination. Only search
// for a detour when the next few steps would hit something.
import { obbVsCircle } from '../../../shared/world/shapes';
import { PED_RADIUS } from '../../../shared/sim/physics';
import type { Ped, Vehicle } from '../entities';
import type { World } from '../world';

type Point = { x: number; y: number };
type Step = Point & { parent?: Step; cost: number; rank: number };
type Detour = { goal: Point; steps: Point[]; retry: number };
const detours = new WeakMap<Ped, Detour>();
// Reuse a short, clear stretch for a few simulation ticks. Nearby people are
// still checked every tick, and physics resolves contact on every step.
const checked = new WeakMap<Ped, { x: number; y: number; goal: Point; until: number }>();
const pullAside = new WeakMap<Ped, { spot: Point; until: number }>();
export function resetFootRoute(p: Ped): void {
  detours.delete(p);
  pullAside.delete(p);
  checked.delete(p);
}

function touchesCar(point: Point, v: Vehicle): boolean {
  const b = v.body;
  return !!obbVsCircle(b.x, b.y, Math.cos(b.angle), Math.sin(b.angle), v.spec.length / 2, v.spec.width / 2,
    { ...point, r: PED_RADIUS + 0.08 });
}

// A parked car can cover a pavement waypoint itself. Move that waypoint to a
// reachable edge so the walker can finish this leg and advance to the next.
export function openFootWaypoint(w: World, goal: Point, from: Point): Point {
  let obstacle: Vehicle | undefined;
  w.vehiclesNear(goal.x, goal.y, 12, v => {
    if (v.body.alt < 2 && Math.hypot(v.body.vx, v.body.vy) < 0.5 && touchesCar(goal, v)) obstacle = v;
  });
  if (!obstacle) return goal;
  const { body, spec } = obstacle, c = Math.cos(body.angle), s = Math.sin(body.angle);
  let best = Infinity, result = goal;
  for (const [along, across] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const f = along * (spec.length / 2 + PED_RADIUS + 0.35), r = across * (spec.width / 2 + PED_RADIUS + 0.35);
    const at = { x: body.x + c * f - s * r, y: body.y + s * f + c * r };
    if (w.map.isWater(at.x, at.y) || (!w.map.onRoad(goal.x, goal.y) && w.map.onRoad(at.x, at.y)) ||
        w.statics.resolveCircle({ ...at }, PED_RADIUS)) continue;
    let blocked = false;
    w.vehiclesNear(at.x, at.y, 12, v => { if (v.body.alt < 2 && touchesCar(at, v)) blocked = true; });
    const cost = Math.hypot(at.x - goal.x, at.y - goal.y) + Math.hypot(at.x - from.x, at.y - from.y);
    if (!blocked && cost < best) { best = cost; result = at; }
  }
  return result;
}

function clear(w: World, a: Point, b: Point, sidewalk: boolean, limit = Infinity): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  if (!distance) return true;
  const length = Math.min(limit, distance);
  const cars: Vehicle[] = [];
  w.vehiclesNear(a.x + dx / distance * length / 2, a.y + dy / distance * length / 2, length / 2 + 12, v => {
    if (v.body.alt < 2 && v.spec.movement !== 'boat') cars.push(v);
  });
  const count = Math.ceil(length / PED_RADIUS);
  for (let i = 1; i <= count; i++) {
    const t = length / distance * i / count;
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    if (cars.some(v => touchesCar(point, v)) || w.map.isWater(point.x, point.y) || (sidewalk && w.map.onRoad(point.x, point.y)) ||
        w.statics.resolveCircle(point, PED_RADIUS)) return false;
  }
  return true;
}

const neighbours = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function detour(w: World, start: Point, goal: Point, sidewalk: boolean): Point[] {
  const initial = Math.hypot(start.x - goal.x, start.y - goal.y);
  const open: Step[] = [{ x: start.x, y: start.y, cost: 0, rank: initial }];
  const seen = new Set<string>(['0,0']);
  // A bounded search around the blockage, including steps away from the goal
  // when a long wall or a partition requires walking around its end.
  for (let expanded = 0; expanded < 400 && open.length; expanded++) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].rank < open[best].rank) best = i;
    const current = open.splice(best, 1)[0];
    const distance = Math.hypot(current.x - goal.x, current.y - goal.y);
    if (current.parent && distance < initial + 3 && clear(w, current, goal, sidewalk, 8)) {
      const steps: Point[] = [];
      for (let s: Step | undefined = current; s?.parent; s = s.parent) steps.push(s);
      return steps.reverse();
    }
    for (const [dx, dy] of neighbours) {
      const x = current.x + dx, y = current.y + dy;
      const key = Math.round(x - start.x) + ',' + Math.round(y - start.y);
      if (seen.has(key) || !clear(w, current, { x, y }, sidewalk)) continue;
      seen.add(key);
      const cost = current.cost + Math.hypot(dx, dy);
      open.push({ x, y, cost, rank: cost + 1.4 * Math.hypot(x - goal.x, y - goal.y), parent: current });
    }
  }
  return [];
}

export function footDirection(w: World, p: Ped, goal: Point, speed: number): Point {
  const b = p.body, ai = p.ai!;
  const sidewalk = ai.task === 'wander' && ai.crossing !== 'walking' && !w.map.onRoad(b.x, b.y);
  const yieldSpot = pullAside.get(p);
  if (yieldSpot && w.time < yieldSpot.until) {
    const dx = yieldSpot.spot.x - b.x, dy = yieldSpot.spot.y - b.y, d = Math.hypot(dx, dy);
    if (d < 0.15) return { x: 0, y: 0 };
    if (clear(w, b, yieldSpot.spot, sidewalk)) return { x: dx / d, y: dy / d };
  }
  if (yieldSpot) pullAside.delete(p);
  let plan = detours.get(p);
  if (plan && Math.hypot(goal.x - plan.goal.x, goal.y - plan.goal.y) > 3) {
    detours.delete(p);
    plan = undefined;
  }
  while (plan?.steps.length && Math.hypot(plan.steps[0].x - b.x, plan.steps[0].y - b.y) < 0.25) plan.steps.shift();
  let target = plan?.steps[0] ?? goal;
  const recent = checked.get(p);
  const reuse = target === goal && recent && w.time < recent.until &&
    Math.hypot(goal.x - recent.goal.x, goal.y - recent.goal.y) < 0.15 &&
    Math.hypot(b.x - recent.x, b.y - recent.y) < 0.8;
  if (!reuse && !clear(w, b, target, sidewalk, 2)) {
    if (!plan || w.time >= plan.retry) {
      plan = { goal, steps: detour(w, b, goal, sidewalk), retry: w.time + 0.65 };
      detours.set(p, plan);
    }
    target = plan.steps[0] ?? b;
    checked.delete(p);
  } else if (!reuse && target === goal) {
    checked.set(p, { x: b.x, y: b.y, goal, until: w.time + 0.15 });
  }
  const dx = target.x - b.x, dy = target.y - b.y, length = Math.hypot(dx, dy);
  if (!length) return { x: 0, y: 0 };
  const mx = dx / length, my = dy / length;
  const look = Math.min(2.4, 0.9 + speed * 0.35, Math.hypot(goal.x - b.x, goal.y - b.y));
  let near = Infinity, side = 1, neighbourId = 0;
  w.pedsNear(b.x, b.y, look + 1, other => {
    if (other === p || other.dead || other.vehicle || (other.id === ai.target && (ai.task === 'attack' || ai.task === 'arrest'))) return;
    const rx = other.body.x - b.x, ry = other.body.y - b.y;
    const along = rx * mx + ry * my, across = ry * mx - rx * my;
    if (along <= 0 || along > look || along >= near || Math.abs(across) >= 2 * PED_RADIUS + 0.15) return;
    near = along; neighbourId = other.id;
    // Head-on walkers both keep to their own right.
    side = across < 0.15 ? 1 : -1;
  });
  if (near === Infinity) return { x: mx, y: my };
  const norm = Math.hypot(1, 1.2);
  for (const turn of [side, -side]) {
    const x = (mx - turn * my * 1.2) / norm, y = (my + turn * mx * 1.2) / norm;
    const step = { x: b.x + x, y: b.y + y };
    if (!clear(w, b, step, sidewalk)) continue;
    let occupied = false;
    w.pedsNear(step.x, step.y, 2 * PED_RADIUS, other => {
      if (other !== p && !other.dead && !other.vehicle && other.id !== neighbourId) occupied = true;
    });
    if (!occupied) return { x, y };
  }
  // Opposing walkers in a narrow doorway can't both sidestep. One gives
  // ground until there is space to pass, using a stable tie-break.
  if (p.id > neighbourId) {
    for (const sign of [side, -side]) {
      const spot = { x: b.x - 0.8 * mx - sign * my, y: b.y - 0.8 * my + sign * mx };
      if (clear(w, b, spot, sidewalk)) {
        pullAside.set(p, { spot, until: w.time + 1.3 + 1.3 / speed });
        return { x: 0, y: 0 };
      }
    }
    if (clear(w, b, { x: b.x - mx, y: b.y - my }, sidewalk)) return { x: -0.65 * mx, y: -0.65 * my };
  }
  return { x: 0, y: 0 };
}
