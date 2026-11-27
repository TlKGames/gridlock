// The ground of open country as a real surface (shared/world/terrain.ts): each chunk's plane bent
// over the land, a vertex every 2 m so a cliff is a wall, normals worked out from the land itself
// (so the light and shadow match across chunk edges), and steep faces drawn in the zone's rock
// layers instead of the top-down painting stretched down them.
import * as THREE from 'three';
import { ZONES } from '../../shared/packs';
import type { CityMap } from '../../shared/world/city';
import { groundZ, installedTerrain } from '../../shared/world/terrain';

/** Metres between vertices (finer where there are cliffs, so their edges don't zig-zag along the
 *  triangles), and the height of one rock layer on a cliff face. */
const RES = 2, FINE = 1, LAYER = 2.4;

/** Lattice rows worked between pauses (render/ground.ts spreads a chunk's build over frames). */
const BAND = 24;

/** A chunk's plane bent over the land, or null where it's all level. A generator: it pauses every
 *  BAND rows and returns the geometry. */
export function* terrainGeo(x0: number, y0: number, size: number): Generator<void, THREE.PlaneGeometry | null> {
  const t = installedTerrain();
  if (!t) return null;
  const cliffs = yield* hasCliffs(x0, y0, size);
  return yield* bent(x0, y0, size, cliffs ? FINE : RES);
}

/** Whether any of the chunk has a wall in it (a steep step between points 2 m apart). */
function* hasCliffs(x0: number, y0: number, size: number): Generator<void, boolean> {
  const t = installedTerrain()!;
  for (let y = y0; y <= y0 + size; y += 2) {
    if ((y - y0) % (2 * BAND) === 2 * BAND - 2) yield;
    let prev = groundZ(t, x0, y, true);
    for (let x = x0 + 2; x <= x0 + size; x += 2) {
      const z = groundZ(t, x, y, true);
      if (Math.abs(z - prev) > 2.5) return true;
      prev = z;
    }
  }
  return false;
}

function* bent(x0: number, y0: number, size: number, RES: number): Generator<void, THREE.PlaneGeometry | null> {
  const t = installedTerrain()!;
  const segs = Math.round(size / RES);
  // Heights on the vertex lattice with a one-vertex border, so each normal comes from the land
  // either side of it, the same on both sides of a chunk edge (no seams in the light).
  const m = segs + 3, H = new Float32Array(m * m);
  let any = false;
  for (let j = 0; j < m; j++) {
    if (j % BAND === BAND - 1) yield;
    for (let i = 0; i < m; i++) {
      const h = groundZ(t, x0 + (i - 1) * RES, y0 + (j - 1) * RES, true);
      H[j * m + i] = h;
      if (h !== 0) any = true;
    }
  }
  if (!any) return null;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  for (let v = 0; v < pos.count; v++) {
    if (v % 3000 === 2999) yield;
    const i = Math.round((pos.getX(v) + size / 2) / RES) + 1, j = Math.round((pos.getZ(v) + size / 2) / RES) + 1;
    pos.setY(v, H[j * m + i]);
    const gx = (H[j * m + i + 1] - H[j * m + i - 1]) / (2 * RES), gy = (H[(j + 1) * m + i] - H[(j - 1) * m + i]) / (2 * RES);
    const l = Math.hypot(gx, 1, gy);
    nrm.setXYZ(v, -gx / l, 1 / l, -gy / l);
  }
  geo.computeBoundingSphere();
  return geo;
}

/** The rock layers a chunk's cliffs show: its zone's strata, else its rock colours. */
export function strataOf(map: CityMap, x: number, y: number): string[] {
  const z = map.zoneAt(x, y);
  const w = z >= 0 ? ZONES[z].wild : undefined;
  const c = w?.strata?.length ? w.strata : w?.rockColor?.length ? w.rockColor : ['#9a7a5a', '#8a6a4a'];
  return [0, 1, 2, 3].map((k) => c[k % c.length]);
}

/** The ground's material: the painted chunk, with faces too steep to paint drawn as rock in bands
 *  by height (wavering a little, grained), lit and shadowed like everything else. */
export function terrainMaterial(tex: THREE.Texture, strata: string[]): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
  const colors = strata.map((c) => new THREE.Color(c));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStrata = { value: colors };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandPos;\nvarying vec3 vLandN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLandPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLandN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLandPos;\nvarying vec3 vLandN;\nuniform vec3 uStrata[4];')
      .replace('#include <map_fragment>', `#include <map_fragment>
  float steep = smoothstep(0.66, 0.4, vLandN.y);
  if (steep > 0.0) {
    float yy = vLandPos.y / ${LAYER.toFixed(1)} + sin(vLandPos.x * 0.11) * 0.3 + sin(vLandPos.z * 0.13) * 0.3;
    float b = mod(floor(yy), 4.0);
    vec3 rock = b < 1.0 ? uStrata[0] : b < 2.0 ? uStrata[1] : b < 3.0 ? uStrata[2] : uStrata[3];
    float grain = 0.86 + 0.14 * fract(sin(dot(floor(vLandPos.xz * 1.7) + floor(yy * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
    float lip = smoothstep(0.85, 1.0, fract(yy)) * 0.18;
    diffuseColor.rgb = mix(diffuseColor.rgb, rock * (grain - lip), steep);
  }`);
  };
  return mat;
}
