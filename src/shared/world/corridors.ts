// Where an elevated railway runs: through the middle of a row of blocks on a corridor of its own,
// never over a street, the way a city builds one (Chicago's L over its alleys): the land is taken
// from the blocks, whose buildings then back onto it. A corridor is a line of the grid with no street
// on it (roadgen.ts genGraph), put halfway between two streets; the lines beyond are pushed out so a
// block's worth of depth is left either side. Done before any block is laid out.
import { LAND1, MAP_SIZE, type RoadLine } from './cityTypes';
import { PLATFORM_HALF } from './railgen';
import { WORLD } from './worldSpec';

/** Kerb to corridor: the depth of the blocks either side of one. */
const BACK = 30;
/** An elevated railway's strip: the viaduct and its platforms, an alley under them. */
export const RAIL_CORRIDOR_W = 2 * PLATFORM_HALF + 4;
const MIN_GAP = 46;

/** Inserts an elevated WORLD.railway's corridor into the lines. Returns the river's row, moved if
 *  the corridor went in before it. */
export function insertCorridors(xs: RoadLine[], ys: RoadLine[], riverRow: number): number {
  const rail = WORLD.railway;
  if (!rail || rail.style !== 'elevated') return riverRow;
  // Horizontal corridors are rows of ys (an east-west line has a y); vertical ones, of xs.
  const lines = rail.axis === 'h' ? ys : xs;
  const river = rail.axis === 'h' ? riverRow : -1;
  const at = insertOne(lines, rail.at, RAIL_CORRIDOR_W, river);
  return at >= 0 && river >= 0 && at <= riverRow ? riverRow + 1 : riverRow;
}

/** Puts the corridor in the gap nearest `at` (a fraction of the map): its index, or -1. */
function insertOne(lines: RoadLine[], at: number, width: number, riverRow: number): number {
  let g = -1, bd = Infinity;
  for (let k = 1; k + 1 < lines.length - 1; k++) {
    // Not the river, nor beside it.
    if (riverRow >= 0 && k >= riverRow - 1 && k <= riverRow + 1) continue;
    const d = Math.abs((lines[k].pos + lines[k + 1].pos) / 2 / MAP_SIZE - at);
    if (d < bd) { bd = d; g = k; }
  }
  if (g < 0) return -1;
  const a = lines[g], b = lines[g + 1];
  const need = a.width / 2 + BACK + width + BACK + b.width / 2;
  const short = Math.max(0, need - (b.pos - a.pos));
  for (let k = g + 1; k < lines.length; k++) lines[k].pos += short;
  const pos = a.pos + a.width / 2 + BACK + width / 2 + (b.pos - a.pos - need) / 2;
  lines.splice(g + 1, 0, { pos, width, lanes: 0, parking: false, arterial: true, rail: true });
  // The map's edge road stays at the edge; streets pushed too near it go.
  const edge = lines[lines.length - 1];
  edge.pos = LAND1 - 8;
  while (lines.length > 2 && lines[lines.length - 2].pos > edge.pos - MIN_GAP && !lines[lines.length - 2].rail) lines.splice(lines.length - 2, 1);
  return g + 1;
}
