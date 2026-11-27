// Brush in open country: low round bushes (sage, greasewood), not solid, in the zone's colours
// (WildSpec.brush), thickest down in the washes and thin on the tops. Scattered per ground chunk
// from the world seed, so every client sees the same bushes; built and dropped with the chunk.
import * as THREE from 'three';
import { ZONES } from '../../shared/packs';
import { Rng } from '../../shared/rng';
import type { CityMap } from '../../shared/world/city';
import type { Rock } from '../../shared/world/cityTypes';
import { relief } from '../../shared/world/relief';
import { groundAt } from '../../shared/world/terrain';
import { Batch } from './instancing';

/** Scatter cell (m): each draws its own bushes from its own seed. */
const CELL = 8;
/** Rock lookup grid (m). */
const RG = 32;

let geo: THREE.BufferGeometry | null = null;
let mat: THREE.Material | null = null;
/** A bush: a squat, lumpy, faceted mound (unit size, base at y = 0). */
function bushGeo(): THREE.BufferGeometry {
  if (geo) return geo;
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const p = g.getAttribute('position');
  const rng = new Rng(4242);
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = seen.get(key);
    if (j === undefined) { j = rng.range(0.8, 1.15); seen.set(key, j); }
    p.setXYZ(i, p.getX(i) * j, Math.max(p.getY(i) * j, -0.1) + 0.1, p.getZ(i) * j);
  }
  g.computeVertexNormals();
  return (geo = g);
}

let rockIndex: { city: unknown; cells: Map<number, Rock[]> } | null = null;
function rocksNear(map: CityMap, x: number, y: number): Rock[] {
  if (rockIndex?.city !== map.city) {
    const cells = new Map<number, Rock[]>();
    for (const r of map.city.rocks) {
      for (let j = Math.floor((r.y - r.r) / RG); j <= Math.floor((r.y + r.r) / RG); j++) {
        for (let i = Math.floor((r.x - r.r) / RG); i <= Math.floor((r.x + r.r) / RG); i++) {
          const k = j * 4096 + i;
          let a = cells.get(k);
          if (!a) cells.set(k, (a = []));
          a.push(r);
        }
      }
    }
    rockIndex = { city: map.city, cells };
  }
  return rockIndex.cells.get(Math.floor(y / RG) * 4096 + Math.floor(x / RG)) ?? [];
}

/** The brush in one ground chunk, added to the scene; returns its meshes (to drop with the chunk). */
export function buildBrush(scene: THREE.Scene, map: CityMap, X0: number, Y0: number, size: number): THREE.InstancedMesh[] {
  const seed = map.city.seed;
  mat ??= new THREE.MeshLambertMaterial({ flatShading: true });
  const batch = new Batch(bushGeo(), mat, { cast: false, receive: true });
  for (let cy = Y0; cy < Y0 + size; cy += CELL) {
    for (let cx = X0; cx < X0 + size; cx += CELL) {
      const z = map.zoneAt(cx + CELL / 2, cy + CELL / 2);
      const b = z >= 0 ? ZONES[z].wild?.brush : undefined;
      if (!b) continue;
      const rng = new Rng((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ seed) >>> 0);
      // Thick in the washes, thin on the tops.
      const h = relief(seed, cx + CELL / 2, cy + CELL / 2);
      const want = b.density * (CELL * CELL / 100) * (0.35 + (1 - h) * 1.5);
      const n = Math.floor(want + rng.next());
      for (let k = 0; k < n; k++) {
        const x = cx + rng.next() * CELL, y = cy + rng.next() * CELL;
        const s = rng.range(b.size[0], b.size[1]), color = rng.pick(b.colors), rot = rng.next() * 6.28;
        if (map.onRoad(x, y) || map.isWater(x, y)) continue;
        // Not on a cliff face (world/terrain.ts).
        if (Math.abs(groundAt(x + 0.6, y) - groundAt(x - 0.6, y)) + Math.abs(groundAt(x, y + 0.6) - groundAt(x, y - 0.6)) > 1.2) continue;
        if (rocksNear(map, x, y).some((r) => (r.x - x) ** 2 + (r.y - y) ** 2 < (r.r + s * 0.5) ** 2)) continue;
        batch.add(x, groundAt(x, y) - 0.05, y, s, s * rng.range(0.45, 0.7), s * rng.range(0.8, 1.1), color, rot);
      }
    }
  }
  return batch.build(scene);
}
