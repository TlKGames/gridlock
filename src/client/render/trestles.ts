// Timber trestles carrying the trails over the gorges (shared/world/terrain.ts Terrain.trestles):
// a plank deck at the rims' height, a rail along each side, and bents (pairs of posts, braced) every
// few metres standing down to the canyon floor below. Built once, merged and instanced.
import * as THREE from 'three';
import type { City } from '../../shared/world/cityTypes';
import { groundZ } from '../../shared/world/terrain';
import { Batch, UNIT } from './instancing';

/** Deck thickness, rail height, post size, and the spacing of the bents (m). */
const DECK = 0.35, RAIL = 1.0, POST = 0.32, BENT = 3.2;
const PLANK = '#7a5a3a', TIMBER = '#5a4230', RAIL_C = '#6a4e34';

export function buildTrestles(scene: THREE.Scene, city: City): void {
  const t = city.terrain;
  if (!t?.trestles.length) return;
  const box = new Batch(UNIT.box(), new THREE.MeshLambertMaterial());
  for (const b of t.trestles) {
    const h = b.axis === 'h';
    const len = h ? b.x1 - b.x0 : b.y1 - b.y0, wide = h ? b.y1 - b.y0 : b.x1 - b.x0;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const rot = h ? 0 : Math.PI / 2;
    // Deck height along it (a straight run from rim to rim).
    const deckAt = (f: number) => b.z0 + (b.z1 - b.z0) * f;
    const along = (f: number, off: number): [number, number] => (h ? [b.x0 + len * f, cy + off] : [cx + off, b.y0 + len * f]);
    // The deck in short sections so it follows the run between the rims.
    const parts = Math.max(1, Math.ceil(len / 4));
    for (let p = 0; p < parts; p++) {
      const f = (p + 0.5) / parts;
      const [x, y] = along(f, 0);
      box.add(x, deckAt(f) - DECK, y, len / parts + 0.05, DECK, wide, PLANK, rot);
      for (const side of [-1, 1]) {
        const [rx, ry] = along(f, side * (wide / 2 - 0.12));
        box.add(rx, deckAt(f), ry, len / parts + 0.05, 0.14, 0.14, RAIL_C, rot);
        box.add(rx, deckAt(f) + RAIL - 0.14, ry, len / parts + 0.05, 0.14, 0.14, RAIL_C, rot);
      }
    }
    // Bents: a post at each side, down to the ground under it, with a cross-tie every few metres.
    const bents = Math.max(1, Math.floor(len / BENT));
    for (let q = 1; q < bents; q++) {
      const f = q / bents, top = deckAt(f) - DECK;
      for (const side of [-1, 1]) {
        const [px, py] = along(f, side * (wide / 2 - 0.3));
        const foot = groundZ(t, px, py, true);
        if (top - foot < 0.4) continue;
        box.add(px, foot, py, POST, top - foot, POST, TIMBER, rot);
        // The rail posts above the deck.
        box.add(px, top + DECK, py, 0.16, RAIL, 0.16, RAIL_C, rot);
      }
      const [mx, my] = along(f, 0);
      const floor = groundZ(t, mx, my, true);
      for (let z = top - 2.6; z > floor + 0.8; z -= 2.6) box.add(mx, z, my, 0.22, 0.22, wide - 0.4, TIMBER, rot);
    }
  }
  box.build(scene);
}
