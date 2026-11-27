// Fixtures (city.fixtures, shared/world/fixtures.ts) drawn from their specs' parts: each spec's parts
// merged into one shape (fixed colours baked in, plus one for its 'body' parts, coloured per fixture),
// instanced per map tile. Parts marked `spin` (a windmill's wheel) turn on their own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIXTURES } from '../../shared/packs';
import type { FixturePart, FixtureSpec } from '../../shared/packs/types';
import type { City } from '../../shared/world/cityTypes';
import { groundUnder } from '../../shared/world/terrain';
import { Batch, UNIT } from './instancing';

const shapeGeo = (s: FixturePart['shape']): THREE.BufferGeometry => {
  switch (s) {
    case 'cyl': return UNIT.cyl(12);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0);
    case 'gable': return UNIT.gable();
    default: return UNIT.box();
  }
};

/** One part sized and placed in its fixture's own space (front +x, across +z, up +y), base at 0. */
function partGeo(spec: FixtureSpec, p: FixturePart, color: THREE.Color, centred = false): THREE.BufferGeometry {
  const [L, W] = spec.size, H = spec.height;
  const sx = (p.x[1] - p.x[0]) * L, sz = (p.y[1] - p.y[0]) * W, sy = (p.z[1] - p.z[0]) * H;
  const g = shapeGeo(p.shape).toNonIndexed();
  g.scale(sx, sy, sz);
  if (centred) g.translate(0, -sy / 2, 0);
  else g.translate(((p.x[0] + p.x[1]) / 2) * L, p.z[0] * H, ((p.y[0] + p.y[1]) / 2) * W);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

interface Spinner { x: number; y: number; z: number; rot: number; phase: number }

export class FixturesView {
  private spinners: { mesh: THREE.InstancedMesh; items: Spinner[]; speed: number }[] = [];
  private t = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene, city: City) {
    if (!city.fixtures.length) return;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const white = new THREE.Color('#ffffff'), c = new THREE.Color();
    FIXTURES.forEach((spec, si) => {
      const placed = city.fixtures.filter((f) => f.spec === si);
      if (!placed.length) return;
      const fixed = spec.parts.filter((p) => !p.spin && p.paint !== 'body');
      const body = spec.parts.filter((p) => !p.spin && p.paint === 'body');
      const spin = spec.parts.filter((p) => p.spin);
      const shadows = { cast: true, receive: true };
      const fixedB = fixed.length ? new Batch(mergeGeometries(fixed.map((p) => partGeo(spec, p, c.set(p.paint)))), mat, shadows) : null;
      const bodyB = body.length ? new Batch(mergeGeometries(body.map((p) => partGeo(spec, p, white))), mat, shadows) : null;
      const items: Spinner[] = [];
      for (const f of placed) {
        const rot = -f.turn * Math.PI / 2;
        // Out on a hillside, footed on the lowest ground under it (world/terrain.ts).
        const z = groundUnder(f.x, f.y, Math.min(spec.size[0], spec.size[1]) / 2);
        fixedB?.add(f.x, z, f.y, 1, 1, 1, '#ffffff', rot);
        bodyB?.add(f.x, z, f.y, 1, 1, 1, f.color, rot);
        if (spin.length) {
          // The wheel's hub in the world: its first part's centre, turned with the fixture. All its
          // spin parts are built round that one centre (blades crossing at the hub).
          const h = spin[0];
          const lx = ((h.x[0] + h.x[1]) / 2) * spec.size[0], lz = ((h.y[0] + h.y[1]) / 2) * spec.size[1];
          const ct = Math.cos(f.turn * Math.PI / 2), st = Math.sin(f.turn * Math.PI / 2);
          items.push({ x: f.x + lx * ct - lz * st, y: z + ((h.z[0] + h.z[1]) / 2) * spec.height, z: f.y + lx * st + lz * ct, rot, phase: (f.x * 0.37 + f.y * 0.11) % 6.28 });
        }
      }
      fixedB?.build(scene);
      bodyB?.build(scene);
      if (spin.length && items.length) {
        const geo = mergeGeometries(spin.map((p) => partGeo(spec, p, p.paint === 'body' ? white : c.set(p.paint), true)));
        const mesh = new THREE.InstancedMesh(geo, mat, items.length);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.spinners.push({ mesh, items, speed: 1.6 });
      }
    });
  }

  /** Every frame: turn the wheels. */
  update(dt: number): void {
    if (!this.spinners.length) return;
    this.t += dt;
    for (const s of this.spinners) {
      s.items.forEach((it, i) => {
        this.e.set(it.phase + this.t * s.speed, it.rot, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        s.mesh.setMatrixAt(i, this.m.compose(this.p.set(it.x, it.y, it.z), this.q, this.one));
      });
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
