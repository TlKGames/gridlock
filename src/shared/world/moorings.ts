// Where boats lie moored: along both banks of the river, clear of the bridges, and here and there
// round the coast. Each mooring is a point on the bank and the way out into the water (a unit
// vector); the boat lies alongside it, parallel to the bank. Worked out from the city alone, so it
// is the same every time; the server keeps the ones a pedestrian can actually step down from.
import { waterfront } from './waterfront';
import type { Rect } from '../math';
import { VEHICLES } from '../packs';
import { type City, LAND0, LAND1 } from './cityTypes';

export interface Mooring { x: number; y: number; nx: number; ny: number; angle: number }

/** Metres between moorings along the river, and round the coast. */
const RIVER_STEP = 170, COAST_STEP = 380;
/** Moorings keep this far from a bridge (m). */
const BRIDGE_CLEAR = 18;

export function moorings(city: City): Mooring[] {
  const out: Mooring[] = [];
  if (!VEHICLES.some(v => v.roles.includes('moored'))) return out;
  const { lo, hi, river } = waterfront(city);
  if (river) {
    const north = river.y0, south = river.y1;
    // The river: alternate banks, skipping anywhere near a bridge.
    let k = 0;
    for (let x = LAND0 + 60; x < LAND1 - 60; x += RIVER_STEP, k++) {
      if (city.railway?.axis === 'v' && Math.abs(x - city.railway.pos) < BRIDGE_CLEAR) continue;
      if (city.bridges.some((b) => x > b.x0 - BRIDGE_CLEAR && x < b.x1 + BRIDGE_CLEAR)) continue;
      out.push(k % 2 ? { x, y: south, nx: 0, ny: -1, angle: Math.PI } : { x, y: north, nx: 0, ny: 1, angle: 0 });
    }
  }
  // The coast: the island's four shores (a landlocked map has none).
  if (city.edge === 'sea') for (let t = LAND0 + 150; t < LAND1 - 150; t += COAST_STEP) {
    out.push({ x: t, y: lo, nx: 0, ny: -1, angle: 0 });
    out.push({ x: t, y: hi, nx: 0, ny: 1, angle: Math.PI });
    if (river && t > river.y0 - BRIDGE_CLEAR && t < river.y1 + BRIDGE_CLEAR) continue;
    out.push({ x: lo, y: t, nx: -1, ny: 0, angle: Math.PI / 2 });
    out.push({ x: hi, y: t, nx: 1, ny: 0, angle: -Math.PI / 2 });
  }
  return out;
}

/** A timber landing alongside the quay. The boat ties up to its outer face. */
export const DOCK_DEPTH = 2.4;
export function dockRect(m: Mooring): Rect {
  const x = m.x + m.nx * DOCK_DEPTH / 2, y = m.y + m.ny * DOCK_DEPTH / 2;
  const hx = m.nx ? DOCK_DEPTH / 2 : 5, hy = m.ny ? DOCK_DEPTH / 2 : 5;
  return { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy };
}
