// Upper floors live off the map: floor f of a building is laid out at x + f * LEVEL_BAND (same y), a
// strip east of the city per floor. Everything spatial (collision, bullets, sight, explosions, who's
// near whom) keeps floors apart for free because they really are far apart; drawing maps them back
// over their building, raised by FLOOR_H per floor. Floor 0 is the street and every ground floor.
import { MAP_SIZE } from './cityTypes';

export const LEVEL_BAND = 2560;
export const FLOOR_H = 3.2;
/** Most floors above the lobby a building gets (the collision grid is sized for them). */
export const MAX_FLOORS = 5;
/** After the floors come the strips raised ways live on (an elevated railway: world/wayTypes.ts),
 *  one per way. */
export const WAY0 = MAX_FLOORS + 1;
export const MAX_WAYS = 3;
/** How far east the world reaches (the collision grid's width). */
export const WORLD_X = MAP_SIZE + LEVEL_BAND * (MAX_FLOORS + MAX_WAYS);

/** Which floor a world x is on (0 = street level; WAY0 and up: a way's strip). */
export const floorOf = (x: number): number => (x < LEVEL_BAND ? 0 : Math.floor(x / LEVEL_BAND));
/** Is this strip a way's (a railway's viaduct), not a building's floor? */
export const isWayStrip = (f: number): boolean => f >= WAY0;

/** Where a point on any floor is over the map, and which floor it's on. */
export function groundOf(x: number, y: number): { x: number; y: number; f: number } {
  const f = floorOf(x);
  return { x: x - f * LEVEL_BAND, y, f };
}

/** A map point lifted onto floor f. */
export const onFloor = (x: number, y: number, f: number): { x: number; y: number } => ({ x: x + f * LEVEL_BAND, y });
