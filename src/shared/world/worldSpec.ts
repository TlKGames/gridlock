// The installed universe's map settings (Universe.world over these defaults: Bayhaven's island).
// Set by installUniverse before any game code loads, so modules may size their grids from them at
// load time. MAP_SIZE / LAND0 / LAND1 are re-exported by cityTypes.ts.
import type { WorldSpec } from '../packs/types';

export const DEFAULT_WORLD: WorldSpec = {
  size: 2048,
  margin: 80,
  edge: 'sea',
  river: { at: 0.6, width: 76 },
  spacing: { near: 74, far: 134 },
  arterialEvery: 4,
  ground: '#b7b4ab',
  modern: true,
};

/** The world spec in force. */
export const WORLD: WorldSpec = { ...DEFAULT_WORLD };
export let MAP_SIZE = DEFAULT_WORLD.size;
export let LAND0 = DEFAULT_WORLD.margin;
export let LAND1 = DEFAULT_WORLD.size - DEFAULT_WORLD.margin;

export function installWorld(w: Partial<WorldSpec> | undefined): void {
  // Clear what the last universe set first: an optional setting it had (Bayhaven's railway) must
  // not carry over into one that leaves it out.
  for (const k of Object.keys(WORLD)) delete (WORLD as unknown as Record<string, unknown>)[k];
  Object.assign(WORLD, DEFAULT_WORLD, w ?? {});
  MAP_SIZE = WORLD.size;
  LAND0 = WORLD.margin;
  LAND1 = WORLD.size - WORLD.margin;
}
