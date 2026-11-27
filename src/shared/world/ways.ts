// Ways at run time: how high the surface is under a point (the ground, a building's floor, an
// elevated railway's viaduct), and what of a viaduct stands on the street (its columns and its
// stations' stair towers).
import type { Box2, Circle2 } from './collision';
import type { City } from './cityTypes';
import { railColumns } from './railgen';
import { groundAt } from './terrain';
import { FLOOR_H, floorOf, isWayStrip, LEVEL_BAND, MAX_FLOORS } from './levels';
import { profileZ, type Way, wayLocal } from './wayTypes';

/** The client's city's ways, for drawing code that only has a position (installed once the city
 *  is built). */
let drawn: Way[] = [];
export function installWays(ways: Way[]): void { drawn = ways; }
/** surfaceZ over the installed ways, on the installed ground (world/terrain.ts: hills in open
 *  country; 0 in a flat world and on upper floors). */
export const heightAt = (x: number, y: number): number => surfaceZ(drawn, x, y) + groundAt(x, y);

/** The way whose strip `f` is, if any. */
export const wayOn = (ways: Way[], f: number): Way | undefined => (isWayStrip(f) ? ways.find((w) => w.strip === f) : undefined);

/** Height of the surface something at (x, y) stands on: the street, a building's floor, a viaduct. */
export function surfaceZ(ways: Way[], x: number, y: number): number {
  const f = floorOf(x);
  if (f === 0) return 0;
  if (f <= MAX_FLOORS) return f * FLOOR_H;
  const w = wayOn(ways, f);
  if (!w) return 0;
  return profileZ(w, wayLocal(w, x - f * LEVEL_BAND, y).a);
}

/** Collision for the ways on the street: an elevated railway's columns and its stations' stair towers. */
export function wayCollision(city: City, isWater: (x: number, y: number) => boolean): { boxes: Box2[]; circles: Circle2[] } {
  const boxes: Box2[] = [], circles: Circle2[] = [];
  const rail = city.railway;
  if (rail && rail.strip) {
    for (const c of railColumns(rail, city.nodes, isWater)) circles.push({ x: c.x, y: c.y, r: 0.35, h: rail.z });
    for (const s of rail.stations) for (const t of s.towers) boxes.push({ ...t, h: 4 });
  }
  return { boxes, circles };
}
