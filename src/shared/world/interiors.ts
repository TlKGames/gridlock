// Walk-in ground floors for places whose pack spec names a layout (`interior`). Worked out from the
// city alone, so server physics, client prediction and drawing agree. Each fills its building footprint:
// a shell of walls with a gap at the door (people fit, cars don't), partitions, solid furniture, the counter where you
// do business and the spot where the clerk stands.
import type { Rect } from '../math';
import { INTERIOR_PLANS, type InteriorLayout, PROPERTIES, RULES, SERVICES } from '../packs';
import { DIR_VEC, Dir, type Lot, type Place } from './cityTypes';
import { CORR, floorsFor, type UpperFloor, upperFloors } from './floors';
import { type Stairwell, stairPlan, stairwell } from './stairs';

export type PropKind = 'counter' | 'shelf' | 'table' | 'booth' | 'bar' | 'rack' | 'desk' | 'stool' | 'dance' | 'bench' | 'bars'
  | 'lift' | 'stairs' | 'bed' | 'step' | 'stepDown' | 'rail' | 'nosing' | 'nosingDown' | 'piano' | 'slots';
/** Not solid: drawn on the floor only. */
export const FLAT_PROPS = new Set<PropKind>(['dance', 'stairs', 'step', 'stepDown', 'nosing', 'nosingDown']);
export interface Box { rect: Rect; h: number }
export interface Prop extends Box { kind: PropKind }
export interface Spot { x: number; y: number; angle: number }

export interface Interior {
  place: Place;
  property: boolean;
  building: number;     // index into City.buildings
  layout: InteriorLayout;
  room: Rect;           // the walk-in room (inside the shell)
  /** Wall height: the drawn cutaway and the solid walls agree on it. */
  wallH: number;
  walls: Box[];         // shell (with the door gap) and partitions
  props: Prop[];        // solid furniture (the dance floor is a floor patch, not solid)
  counter: Spot;        // where a customer stands to do business
  clerk: Spot;          // where the clerk stands
  /** Who works the counter (ped archetype id); the clerk by default. */
  clerkArch: string;
  guards: { spot: Spot; arch: string }[];
  /** A strongroom (the bank): its steel door is a gate in the collision world that explosions open. */
  vault?: { door: Rect; room: Rect; cash: { x: number; y: number }[] };
  /** Towers and apartment blocks: where the way between floors starts in the lobby (the elevator,
   *  or the stairwell's landing in an apartment block), and the floors above. */
  lift?: Spot;
  floors: UpperFloor[];
  /** The lift has a floor menu (an elevator, or the stairs of a block too small for a stairwell). */
  elevator?: boolean;
  /** The lobby's stairwell (world/stairs.ts); each floor has its own. */
  stairs?: Stairwell;
}

const T = 0.3, GAP = 1.6, WALL_H = 2.8;
/** The local frame: `a` across the frontage, `d` in from the front wall. */
function frame(lot: Lot) {
  const b = lot.building!.rect, f = lot.front;
  const along = f === Dir.N || f === Dir.S;
  const W = along ? b.x1 - b.x0 : b.y1 - b.y0, D = along ? b.y1 - b.y0 : b.x1 - b.x0;
  const rect = (a0: number, a1: number, d0: number, d1: number): Rect => {
    const [lo, hi] = [Math.min(a0, a1), Math.max(a0, a1)], [n0, n1] = [Math.min(d0, d1), Math.max(d0, d1)];
    switch (f) {
      case Dir.N: return { x0: b.x0 + lo, x1: b.x0 + hi, y0: b.y0 + n0, y1: b.y0 + n1 };
      case Dir.S: return { x0: b.x0 + lo, x1: b.x0 + hi, y0: b.y1 - n1, y1: b.y1 - n0 };
      case Dir.W: return { x0: b.x0 + n0, x1: b.x0 + n1, y0: b.y0 + lo, y1: b.y0 + hi };
      default: return { x0: b.x1 - n1, x1: b.x1 - n0, y0: b.y0 + lo, y1: b.y0 + hi };
    }
  };
  const point = (a: number, d: number): { x: number; y: number } => {
    const r = rect(a, a, d, d);
    return { x: r.x0, y: r.y0 };
  };
  // Facing into the building (from the front wall toward the back), as a world angle.
  const [dx, dy] = DIR_VEC[f];
  const inward = Math.atan2(-dy, -dx);
  return { along, W, D, rect, point, inward, b };
}

function build(place: Place, property: boolean, building: number, lot: Lot, layout: InteriorLayout): Interior | null {
  const F = frame(lot);
  const plan = INTERIOR_PLANS[layout];
  if (F.W < 7 || F.D < 6 || (plan && (F.W < plan.w || F.D < plan.d))) return null;
  const doorA = F.along ? place.x - F.b.x0 : place.y - F.b.y0;
  const a0 = 0, a1 = F.W, Dr = F.D;
  if (doorA - GAP / 2 < a0 + T || doorA + GAP / 2 > a1 - T) return null;
  const walls: Box[] = [], props: Prop[] = [];
  const h = lot.building!.h;
  const wall = (aa0: number, aa1: number, d0: number, d1: number, wh = h) => { if (aa1 - aa0 > 0.05 && d1 - d0 > 0.05) walls.push({ rect: F.rect(aa0, aa1, d0, d1), h: wh }); };
  const prop = (kind: PropKind, aa0: number, aa1: number, d0: number, d1: number, ph: number) => props.push({ kind, rect: F.rect(aa0, aa1, d0, d1), h: ph });
  // Shell: the front wall with the door gap, the sides, the back.
  wall(a0, doorA - GAP / 2, 0, T);
  wall(doorA + GAP / 2, a1, 0, T);
  wall(a0, a0 + T, 0, Dr);
  wall(a1 - T, a1, 0, Dr);
  wall(a0, a1, Dr - T, Dr);
  const ia0 = a0 + T, ia1 = a1 - T, iD = Dr - T; // inside faces
  const front = F.inward + Math.PI; // facing the street
  if (plan) {
    // Keep the casino aisles aligned with the entrance. Other plans anchor their
    // secure rooms at the back. Fixtures and door gaps keep their designed sizes.
    const left = Math.max(0, Math.min(F.W - plan.w, doorA - plan.w / 2));
    const backOffset = layout === 'casino' ? 0 : F.D - plan.d;
    const R = (r: [number, number, number, number]) => F.rect(left + r[0], left + r[1], backOffset + r[2], backOffset + r[3]);
    const P = (p: [number, number], face: number): Spot => ({ ...F.point(left + p[0], backOffset + p[1]), angle: face });
    for (const { r, h } of plan.walls) {
      const lo = r[0] <= T ? ia0 : left + r[0];
      const hi = r[1] >= plan.w - T ? ia1 : left + r[1];
      const end = r[3] >= plan.d - T ? iD : backOffset + r[3];
      wall(lo, hi, backOffset + r[2], end, h ?? WALL_H);
    }
    for (const p of plan.props) props.push({ kind: p.kind, rect: R(p.r), h: p.h });
    return {
      place, property, building, layout, room: F.rect(ia0, ia1, T, iD), wallH: WALL_H, walls, props,
      counter: P(plan.counter, F.inward), clerk: P(plan.clerk, front), clerkArch: plan.clerkArch ?? RULES.clerk,
      guards: (plan.guards ?? []).map((g) => ({ spot: P(g.at, front), arch: g.arch })),
      ...(plan.vault ? { vault: { door: R(plan.vault.door), room: F.rect(left + plan.vault.room[0], plan.vault.room[1] >= plan.w - T ? ia1 : left + plan.vault.room[1], backOffset + plan.vault.room[2], backOffset + plan.vault.room[3]), cash: plan.vault.cash.map((c) => F.point(left + c[0], backOffset + c[1])) } } : {}),
      floors: [],
    };
  }
  const at = (a: number, d: number, face: number): Spot => ({ ...F.point(a, d), angle: face });
  if (layout === 'tower' || layout === 'apartments') {
    // A lobby: the reception desk (towers) or mailboxes (apartments), the elevator bank at the back
    // in the middle (towers), a stairwell beside it (world/stairs.ts), and the floors above
    // (world/floors.ts). A block too small for a stairwell keeps its stairs as a floor menu.
    const am = (ia0 + ia1) / 2;
    const tower = layout === 'tower';
    const n = floorsFor(h);
    const plan = stairPlan(ia0, ia1, iD, am - CORR / 2, am + CORR / 2);
    const stairs = plan ? stairwell(plan, 0, n, F.rect, F.point, F.inward, (s0, s1, e0, e1, wh) => wall(s0, s1, e0, e1, wh), prop) : undefined;
    if (tower || !stairs) prop(tower ? 'lift' : 'stairs', am - 1.0, am + 1.0, iD - 1.0, iD, tower ? WALL_H : 0.05);
    // The mailboxes go on the wall the stairwell isn't against.
    const boxesRight = !!plan && plan.door > 0 && plan.d0 - T < 4.4;
    let counter: Spot, clerk: Spot;
    if (tower) {
      prop('counter', ia1 - 4.6, ia1 - 0.6, 3, 3.8, 1.1);
      prop('bench', ia0 + 0.5, ia0 + 1.0, 2, 4.6, 0.5);
      counter = at(ia1 - 2.6, 2.1, F.inward);
      clerk = at(ia1 - 2.6, 4.6, front);
    } else {
      if (boxesRight) { prop('shelf', ia1 - 0.4, ia1, 2, 4, 1.6); counter = at(ia1 - 1.2, 3, F.inward + Math.PI / 2); } // mailboxes
      else { prop('shelf', ia0, ia0 + 0.4, 2, 4, 1.6); counter = at(ia0 + 1.2, 3, F.inward - Math.PI / 2); }
      clerk = counter;
    }
    return {
      place, property, building, layout, room: F.rect(ia0, ia1, T, iD), wallH: WALL_H, walls, props, counter, clerk,
      clerkArch: tower ? RULES.clerk : '', guards: [],
      lift: tower || !stairs ? at(am, iD - 1.8, front) : stairs.landing,
      floors: upperFloors(layout, n, ia0, ia1, T, iD, F.rect, F.point, front, plan, F.inward),
      ...(tower || !stairs ? { elevator: true } : {}),
      ...(stairs ? { stairs } : {}),
    };
  }
  // A back room behind a partition when the room is deep enough (door gap on the far side from the counter).
  const back = layout !== 'kiosk' && Dr >= 11 ? iD - 3.6 : iD;
  const backDoor = ia0 + 1.2;
  if (back < iD) {
    wall(ia0, backDoor, back - T / 2, back + T / 2, WALL_H);
    wall(backDoor + 1.2, ia1, back - T / 2, back + T / 2, WALL_H);
  }
  let counter: Spot, clerk: Spot;
  if (layout === 'shop' || layout === 'kiosk') {
    // Counter across the right of the room, aisle on the left to the back room; shelves on the left wall.
    const cd = Math.min(back - 2.4, Math.max(3.2, (back) * 0.55));
    const c0 = ia0 + (ia1 - ia0) * 0.42, c1 = ia1;
    prop('counter', c0, c1, cd, cd + 0.8, 1.05);
    const cm = (c0 + c1) / 2;
    counter = at(cm, cd - 0.9, F.inward);
    clerk = at(cm, cd + 1.4, front);
    for (let d = 1.6; d + 1.8 <= cd - 0.6; d += 2.4) prop('shelf', ia0, ia0 + 0.7, d, d + 1.8, 1.8);
    if (ia1 - ia0 >= 9) for (let d = 1.8; d + 1.6 <= cd - 1.2; d += 2.6) prop('shelf', ia0 + 2.4, ia0 + 3.2, d, d + 1.6, 1.5);
  } else if (layout === 'diner') {
    // Booths along the front wall either side of the door, a long counter with stools mid-room.
    for (let a = ia0 + 0.2; a + 1.7 <= ia1 - 0.2; a += 2.4) {
      if (a + 1.7 > doorA - GAP / 2 - 0.4 && a < doorA + GAP / 2 + 0.4) continue;
      prop('booth', a, a + 1.7, T + 0.15, T + 1.55, 1.0);
    }
    const cd = Math.max(4.2, back * 0.6);
    const c0 = ia0 + 2.6, c1 = ia1 - 0.4;
    prop('counter', c0, c1, cd, cd + 0.8, 1.05);
    for (let a = c0 + 0.5; a < c1 - 0.3; a += 1.1) prop('stool', a - 0.2, a + 0.2, cd - 0.65, cd - 0.25, 0.7);
    counter = at((c0 + c1) / 2, cd - 1.0, F.inward);
    clerk = at((c0 + c1) / 2, cd + 1.4, front);
  } else if (layout === 'club') {
    // Bar along the right wall, dance floor in the middle, booths along the left.
    const b0 = 2.2, b1 = Math.max(b0 + 3, back - 1.4);
    prop('bar', ia1 - 2.6, ia1 - 1.8, b0, b1, 1.1);
    for (let d = 2; d + 1.6 <= back - 0.6; d += 2.4) prop('booth', ia0 + 0.15, ia0 + 1.45, d, d + 1.6, 1.0);
    const m0 = ia0 + 2.6, m1 = ia1 - 3.4;
    if (m1 - m0 > 3) prop('dance', m0, m1, 2.6, Math.max(4, back - 2.2), 0.04);
    counter = at(ia1 - 3.5, (b0 + b1) / 2, F.inward + Math.PI / 2);
    clerk = at(ia1 - 0.9, (b0 + b1) / 2, F.inward - Math.PI / 2);
  } else if (layout === 'saloon') {
    // A bar-room: the bar down the right wall with the bottles behind it, card tables and chairs
    // across the floor, a piano against the left wall.
    const b0 = 2.0, b1 = Math.max(b0 + 3, back - 1.2);
    prop('bar', ia1 - 2.6, ia1 - 1.8, b0, b1, 1.1);
    prop('shelf', ia1 - 0.6, ia1 - 0.1, b0, b1, 1.9);
    for (let a = ia0 + 1.6; a + 1.2 <= ia1 - 4.0; a += 3.0) {
      for (let d = 2.6; d + 1.2 <= back - 0.8; d += 3.0) {
        if (d < 4 && a + 1.2 > doorA - GAP / 2 - 0.6 && a < doorA + GAP / 2 + 0.6) continue; // keep the door clear
        prop('table', a, a + 1.2, d, d + 1.2, 0.75);
        prop('stool', a + 0.4, a + 0.8, d - 0.55, d - 0.15, 0.5);
        prop('stool', a + 0.4, a + 0.8, d + 1.35, d + 1.75, 0.5);
      }
    }
    if (back > 6) prop('piano', ia0 + 0.15, ia0 + 0.85, back - 2.6, back - 0.8, 1.3);
    counter = at(ia1 - 3.5, (b0 + b1) / 2, F.inward + Math.PI / 2);
    clerk = at(ia1 - 1.2, (b0 + b1) / 2, F.inward - Math.PI / 2);
  } else {
    // Warehouse: racks in rows, an office desk near the door.
    for (let a = ia0 + 3.4; a + 1.0 <= ia1 - 1.6; a += 3.4) {
      if (a + 1 > doorA - 1.6 && a < doorA + 1.6) continue;
      prop('rack', a, a + 1.0, 3.2, Math.max(4.5, back - 1.6), 2.6);
    }
    prop('desk', ia0 + 0.6, ia0 + 2.6, 1.4, 2.2, 0.8);
    counter = at(ia0 + 1.6, 3.0, front + Math.PI);
    clerk = at(ia0 + 1.6, 0.9 + T, F.inward);
  }
  return { place, property, building, layout, room: F.rect(ia0, ia1, T, iD), wallH: WALL_H, walls, props, counter, clerk, clerkArch: RULES.clerk, guards: [], floors: [] };
}

/** Every walk-in place in the city. */
export function interiorsOf(city: { lots: Lot[]; buildings: { lot: number }[]; services: Place[]; properties: Place[] }): Interior[] {
  const out: Interior[] = [];
  const bIndex = new Map(city.buildings.map((b, i) => [b.lot, i]));
  const add = (place: Place, property: boolean, layout: InteriorLayout | undefined) => {
    const lot = city.lots[place.lot];
    if (!layout || !lot?.building || lot.front < 0) return;
    const i = build(place, property, bIndex.get(lot.id) ?? -1, lot, layout);
    if (i && i.building >= 0) out.push(i);
  };
  for (const s of city.services) add(s, false, SERVICES[s.spec].interior);
  for (const p of city.properties) add(p, true, PROPERTIES[p.spec].interior);
  return out;
}
