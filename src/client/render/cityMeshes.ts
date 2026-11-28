// Static city geometry: building masses + rooftop detail, signs, containers/fences, trees, lamps.
import * as THREE from 'three';
import { Rng } from '../../shared/rng';
import type { City } from '../../shared/world/cityTypes';
import { buildingMaterial, type BuildingUniforms } from './buildingMaterial';
import { turfGang } from '../../shared/world/gangTurf';
import { decorate, type DetailBatches, type Mass, massesFor } from './buildingDetail';
import { type GraffitiSpot, graffitiSpots } from './buildingSpots';
import { ownInstance } from './hideable';
import { Batch, byTile, lambert, UNIT } from './instancing';
import { buildRocks } from './rocks';
import { buildTrestles } from './trestles';
import { groundUnder } from '../../shared/world/terrain';
import { FixturesView } from './fixtures';
import { StreetProps } from './streetProps';
import { StreetPropsView } from './breakables';
import { Breakables } from '../../shared/world/breakables';

/** A street lamp's head (`off` once the post is knocked down). */
export interface LampSpot { x: number; y: number; off?: boolean }

// Lowest exposed elevation on each face (north, east, south, west). The lower
// wing or podium can hide just the bottom of an otherwise visible window.
function wallBases(m: Mass, group: Mass[]): number[] {
  const r = m.r;
  const bases = [m.base, m.base, m.base, m.base];
  for (const other of group) {
    if (other === m) continue;
    const o = other.r;
    const coversX = o.x0 <= r.x0 && o.x1 >= r.x1;
    const coversZ = o.y0 <= r.y0 && o.y1 >= r.y1;
    const covered = [
      coversX && o.y0 < r.y0 && o.y1 >= r.y0,
      coversZ && o.x0 <= r.x1 && o.x1 > r.x1,
      coversX && o.y0 <= r.y1 && o.y1 > r.y1,
      coversZ && o.x0 < r.x0 && o.x1 >= r.x0,
    ];
    covered.forEach((yes, face) => {
      if (yes) bases[face] = Math.max(bases[face], other.h);
    });
  }
  return bases;
}

type CityMass = Mass & { owner: number; front: number; wallBases: number[] };

export class CityMeshes {
  readonly shells: THREE.InstancedMesh[] = [];
  readonly uniforms: BuildingUniforms;
  readonly lamps: LampSpot[];
  readonly props: StreetProps;
  readonly furniture: StreetPropsView;
  /** Fixtures (render/fixtures.ts): update() turns their wheels. */
  readonly fixtures: FixturesView;
  /** Surfaces on gang turf that can carry graffiti, with the gang that owns them. */
  readonly graffitiSpots: (GraffitiSpot & { gang: string })[] = [];

  constructor(scene: THREE.Scene, city: City) {
    const rng = new Rng(city.seed ^ 0xb11d);
    const glassMat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.6 });
    const out: DetailBatches = {
      box: new Batch(UNIT.box(), lambert()),
      cyl: new Batch(UNIT.cyl(), lambert()),
      gable: new Batch(UNIT.gable(), lambert()),
      glass: new Batch(UNIT.box(), glassMat),
    };
    const masses: CityMass[] = [];
    // Walk-in buildings can be hidden (the cutaway): their instances are tagged with the building.
    const open = new Set(city.interiors.map((i) => i.building));
    city.buildings.forEach((b, bi) => {
      const owner = open.has(bi) ? bi : -1;
      const ms = massesFor(b, city.seed, bi);
      const lot = city.lots[b.lot];
      masses.push(...ms.map((m) => ({ ...m, owner, front: lot?.front ?? -1, wallBases: wallBases(m, ms) })));
      for (const batch of Object.values(out)) batch.owner = owner;
      const deco = decorate(b, lot, ms, rng, out);
      // Gang turf: the model's paintable spots, for the graffiti layer.
      const gang = lot ? turfGang(city.blocks[lot.block]?.district ?? -1) : null;
      if (gang) for (const s of graffitiSpots(b, lot, ms, deco)) this.graffitiSpots.push({ ...s, gang });
    });
    for (const batch of Object.values(out)) batch.owner = -1;
    this.uniforms = this.buildMasses(scene, masses, rng);
    for (const batch of Object.values(out)) batch.build(scene);

    // Containers, fences.
    const obs = new Batch(UNIT.box(), lambert());
    for (const o of city.obstacles) {
      if (o.kind === 'pump' || o.kind === 'pole') continue; // gas stations draw their own (gasStations.ts)
      const r = o.rect;
      obs.add((r.x0 + r.x1) / 2, 0, (r.y0 + r.y1) / 2, r.x1 - r.x0, o.h, r.y1 - r.y0, o.color);
    }
    obs.build(scene);
    // Open country's buttes, mesas, outcrops and boulders; churches, barns, windmills, cacti...
    buildRocks(scene, city);
    buildTrestles(scene, city);
    this.fixtures = new FixturesView(scene, city);
    this.trees(scene, city, rng);
    this.props = new StreetProps(scene, city, rng);
    // Lamp posts, hydrants, bins and boxes: knockable (shared/world/breakables.ts).
    this.furniture = new StreetPropsView(scene, new Breakables(city));
    this.furniture.onSignal = (k, down) => this.props.setSignalDown(k, down);
    this.lamps = this.furniture.lamps;
  }

  /** One instanced mesh per map tile so off-screen blocks are culled (also from the shadow pass). */
  private buildMasses(scene: THREE.Scene, masses: CityMass[], rng: Rng): BuildingUniforms {
    const { mat, uniforms } = buildingMaterial();
    const base = UNIT.box();
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (const group of byTile(masses, (ms) => [(ms.r.x0 + ms.r.x1) / 2, (ms.r.y0 + ms.r.y1) / 2]).values()) {
      const n = group.length;
      const geo = base.clone();
      const wall = new Float32Array(n * 3), roof = new Float32Array(n * 3), win = new Float32Array(n * 4);
      const bases = new Float32Array(n * 4);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      group.forEach((ms, i) => {
        const r = ms.r;
        m4.makeScale(r.x1 - r.x0, ms.h - ms.base, r.y1 - r.y0).setPosition((r.x0 + r.x1) / 2, ms.base, (r.y0 + r.y1) / 2);
        mesh.setMatrixAt(i, m4);
        if (ms.owner >= 0) ownInstance(ms.owner, mesh, i, m4);
        // Color.set() converts sRGB hex to the linear working space already.
        c.set(ms.wall); wall.set([c.r, c.g, c.b], i * 3);
        c.set(ms.roof); roof.set([c.r, c.g, c.b], i * 3);
        win.set([ms.win, rng.next() * 100, ms.kind, ms.front], i * 4);
        bases.set(ms.wallBases, i * 4);
      });
      geo.setAttribute('aWall', new THREE.InstancedBufferAttribute(wall, 3));
      geo.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 3));
      geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(win, 4));
      geo.setAttribute('aWallBases', new THREE.InstancedBufferAttribute(bases, 4));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      this.shells.push(mesh);
      scene.add(mesh);
    }
    return uniforms;
  }

  private trees(scene: THREE.Scene, city: City, rng: Rng): void {
    const trunk = new Batch(new THREE.CylinderGeometry(0.22, 0.34, 1, 6).translate(0, 0.5, 0), lambert(), { cast: true, receive: false });
    const crown = new Batch(new THREE.IcosahedronGeometry(1, 1), lambert());
    const greens = ['#3f6b35', '#4b7a3a', '#365e30', '#5a8a42', '#2f5530', '#6b8f3a'];
    for (const t of city.trees) {
      const h = 3 + t.r * 0.8, z = groundUnder(t.x, t.y, 0.4); // on a hillside: world/terrain.ts
      trunk.add(t.x, z, t.y, 1, h, 1, '#5a4030');
      // Two or three overlapping lobes per crown read as foliage rather than a ball.
      const g = rng.pick(greens);
      crown.add(t.x, z + h + t.r * 0.4, t.y, t.r, t.r * 0.8, t.r, g, rng.next() * 6);
      for (let k = 0; k < 2; k++) {
        const a = rng.next() * Math.PI * 2, d = t.r * 0.55;
        crown.add(t.x + Math.cos(a) * d, z + h + t.r * rng.range(0.1, 0.6), t.y + Math.sin(a) * d, t.r * 0.7, t.r * 0.6, t.r * 0.7, rng.pick(greens), rng.next() * 6);
      }
    }
    trunk.build(scene);
    crown.build(scene);
  }
}
