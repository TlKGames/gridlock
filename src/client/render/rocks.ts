// Open country's rock (city.rocks, shared/world/landforms.ts), drawn as it collides: round in plan.
// A mesa or butte column is sheer, stepped at a couple of ledges, banded in its rock layers and
// flat on top; a lump or boulder is a weathered, faceted stone. A few shapes of each, scaled per
// rock (radius, height), turned and coloured per rock, instanced per map tile.
import * as THREE from 'three';
import { Rng } from '../../shared/rng';
import type { City } from '../../shared/world/cityTypes';
import { groundAt, groundUnder } from '../../shared/world/terrain';
import { Batch } from './instancing';

/** A mesa column's profile, bottom to top: [height 0..1, radius, brightness (the layers)]. */
const MESA: [number, number, number][] = [
  [0, 1.08, 0.8], [0.16, 1.02, 0.9], [0.36, 0.97, 1.02], [0.385, 0.91, 0.84], [0.6, 0.89, 1.06],
  [0.625, 0.84, 0.88], [0.82, 0.82, 1.1], [1, 0.79, 1.14],
];
const SIDES = 11;

/** A column with sheer, uneven sides and a flat top (unit radius and height, base at y = 0). */
function mesaGeo(v: number): THREE.BufferGeometry {
  const rng = new Rng(9001 + v * 31);
  const jit = Array.from({ length: SIDES }, () => rng.range(0.86, 1.14));
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [y, r, b] of MESA) {
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2, rr = r * jit[k] * rng.range(0.97, 1.03);
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      col.push(b, b, b);
    }
  }
  for (let ring = 0; ring < MESA.length - 1; ring++) {
    for (let k = 0; k < SIDES; k++) {
      const a = ring * SIDES + k, b = ring * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
      idx.push(a, c, b, b, c, d);
    }
  }
  // The flat top: a fan from its middle, sunlit.
  const top = (MESA.length - 1) * SIDES, mid = pos.length / 3;
  pos.push(0, 1, 0); col.push(1.18, 1.18, 1.18);
  for (let k = 0; k < SIDES; k++) idx.push(mid, top + (k + 1) % SIDES, top + k);
  return finish(pos, col, idx);
}

/** A weathered stone: a jittered ball, flat underneath (unit radius and height, base at y = 0). */
function lumpGeo(v: number): THREE.BufferGeometry {
  const rng = new Rng(7001 + v * 53);
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const p = ico.getAttribute('position');
  // One jitter per corner, keyed by where it is, so faces sharing it stay joined.
  const seen = new Map<string, number>();
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let j = seen.get(key);
    if (j === undefined) { j = rng.range(0.78, 1.18); seen.set(key, j); }
    const yy = Math.max(y * j, -0.35);
    pos.push(x * j, (yy + 0.35) / 1.5, z * j);
    const b = 0.78 + ((yy + 0.35) / 1.5) * 0.4;
    col.push(b, b, b);
  }
  ico.dispose();
  return finish(pos, col);
}

function finish(pos: number[], col: number[], idx?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (idx) g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Adds every rock in the city to the scene. */
export function buildRocks(scene: THREE.Scene, city: City): void {
  if (!city.rocks.length) return;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const shapes = [0, 1, 2, 3].map((v) => ({ mesa: new Batch(mesaGeo(v), mat), lump: new Batch(lumpGeo(v), mat) }));
  for (const r of city.rocks) {
    // Turned by where it stands, so neighbours made from one shape don't line up.
    const rot = ((r.x * 12.9898 + r.y * 78.233) % 1) * Math.PI * 2;
    const s = shapes[r.v % shapes.length];
    // Footed on the lowest ground under it (world/terrain.ts), its height above that.
    const z = groundUnder(r.x, r.y, r.r);
    (r.mesa ? s.mesa : s.lump).add(r.x, z, r.y, r.r, r.h + groundAt(r.x, r.y) - z, r.r, r.color, rot);
  }
  for (const s of shapes) { s.mesa.build(scene); s.lump.build(scene); }
}
