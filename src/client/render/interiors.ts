// Walk-in ground floors (shared/world/interiors.ts) and the cutaway. The floors, walls cut at waist
// height, furniture and the solid rest of each building (a dark cut block) always sit inside their
// building, invisible under the roof. Stand at or in a walk-in place on foot and that building is
// hidden (render/hideable.ts): you see the floor plan from the same camera, in the same world.
import * as THREE from 'three';
import type { City } from '../../shared/world/cityTypes';
import { FLAT_PROPS as FLAT, type Interior, type PropKind } from '../../shared/world/interiors';
import { FLOOR_H, groundOf } from '../../shared/world/levels';
import { WORLD } from '../../shared/world/worldSpec';
import { setHidden } from './hideable';
import { Batch, lambert, UNIT } from './instancing';
import type { ParticleLayer } from './particles';
import { StairShade } from './stairShade';

const MODERN_FLOOR: Record<Interior['layout'], string> = {
  shop: '#d9d4c7', kiosk: '#d6d2c6', diner: '#e3d7c0', club: '#2b2531', saloon: '#6a4a30', warehouse: '#8f8d86', bank: '#cfc6b4', precinct: '#a9aeb3',
  tower: '#bfc3c6', apartments: '#b89a78', casino: '#5a1a24',
};
const MODERN_WALL: Record<Interior['layout'], string> = {
  shop: '#ece8df', kiosk: '#ece8df', diner: '#efe4d2', club: '#3d3346', saloon: '#7a4a2e', warehouse: '#b8b5ad', bank: '#e9e2d2', precinct: '#d8dbdd',
  tower: '#e6e8ea', apartments: '#ebe3d6', casino: '#d6c49a',
};
const MODERN_PROP: Record<PropKind, string> = {
  counter: '#6e5136', shelf: '#b9bdc2', table: '#7a5a3a', booth: '#a63a3a', bar: '#4a2a1a',
  rack: '#a9773d', desk: '#5f6368', stool: '#2a2a2a', dance: '#7a3aa0', bench: '#7a5a3a', bars: '#4a4e54',
  lift: '#8d949b', stairs: '#6d6a64', bed: '#d9d2c4', piano: '#1e1a18', slots: '#c9a227',
  // Stairwells (world/stairs.ts): pale treads going up, dark ones going down, a steel rail between,
  // a bright nosing on every tread so the flights read from above.
  step: '#9c968b', stepDown: '#3a3733', rail: '#5d6166', nosing: '#f1ede4', nosingDown: '#77726a',
};
// An older era (WORLD.modern off): plank floors, whitewashed or board walls, wooden fittings; the
// saloon's dance floor is boards too, the hotel's booths are wooden settles.
const OLD_FLOOR: Record<Interior['layout'], string> = {
  shop: '#8a6a48', kiosk: '#8a6a48', diner: '#7e5e40', club: '#6a4a30', saloon: '#6a4a30', warehouse: '#7a6448', bank: '#7a5a3e', precinct: '#7a6448',
  tower: '#8a6a48', apartments: '#8a6a48', casino: '#6a3a2a',
};
const OLD_WALL: Record<Interior['layout'], string> = {
  shop: '#d8ccb0', kiosk: '#d8ccb0', diner: '#d2c2a0', club: '#8a5a3a', saloon: '#8a5a3a', warehouse: '#9a7a56', bank: '#cfc2a2', precinct: '#c8b898',
  tower: '#d8ccb0', apartments: '#d8ccb0', casino: '#8a5a3a',
};
const OLD_PROP: Record<PropKind, string> = {
  counter: '#5a3a22', shelf: '#7a5a3a', table: '#6a4a2e', booth: '#5a3e26', bar: '#4a2a16',
  rack: '#8a6a40', desk: '#5a3e26', stool: '#3e2a1a', dance: '#9a7650', bench: '#6a4a2e', bars: '#3a3836',
  lift: '#6a4a2e', stairs: '#6a4a2e', bed: '#cfc2a2', piano: '#2a1c14', slots: '#8a6a40',
  step: '#9a7a56', stepDown: '#4a3624', rail: '#4a3624', nosing: '#c9a77c', nosingDown: '#6a5038',
};
const FLOOR = WORLD.modern ? MODERN_FLOOR : OLD_FLOOR;
const WALL = WORLD.modern ? MODERN_WALL : OLD_WALL;
const PROP = WORLD.modern ? MODERN_PROP : OLD_PROP;
const CUT = '#2f3136';
const FELT = '#1f6b3e';
/** How close (m) outside a walk-in place you must be for it to open up. */
const NEAR = 3.2;

export class Interiors {
  private open = -1;
  /** Vault doors by interior index (hidden when blown open). */
  private vaultDoors = new Map<number, THREE.Object3D>();

  private unit = UNIT.box();

  /** Greys out everything but the stairwell you're in. */
  private shade: StairShade;

  /** `furnished`: props drawn as models elsewhere (render/gameTables.ts), left out here. */
  constructor(private scene: THREE.Scene, private city: City, furnished: ReadonlySet<object> = new Set()) {
    this.shade = new StairShade(scene, city);
    // Vault doors: a thick steel slab with a wheel, standing in the gap in the vault wall.
    const steel = new THREE.MeshStandardMaterial({ color: '#7d848c', metalness: 0.7, roughness: 0.35 });
    const dark = new THREE.MeshLambertMaterial({ color: '#3a3e44' });
    city.interiors.forEach((i, k) => {
      if (!i.vault) return;
      const d = i.vault.door, g = new THREE.Group();
      const slab = new THREE.Mesh(UNIT.box(), steel);
      slab.scale.set(d.x1 - d.x0, 3.0, d.y1 - d.y0);
      slab.castShadow = true;
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 6, 16).rotateX(Math.PI / 2), dark);
      wheel.position.y = 3.05;
      g.add(slab, wheel);
      g.position.set((d.x0 + d.x1) / 2, 0, (d.y0 + d.y1) / 2);
      scene.add(g);
      this.vaultDoors.set(k, g);
    });
    const box = new Batch(UNIT.box(), lambert());
    const felt = new Set(city.tables.map((t) => t.prop).filter((p): p is NonNullable<typeof p> => !!p));
    const add = (r: { x0: number; y0: number; x1: number; y1: number }, y: number, h: number, color: string) =>
      box.add((r.x0 + r.x1) / 2, y, (r.y0 + r.y1) / 2, r.x1 - r.x0, h, r.y1 - r.y0, color);
    for (const i of city.interiors) {
      add(i.room, 0, 0.06, FLOOR[i.layout]);
      for (const w of i.walls) add(w.rect, 0, i.wallH, WALL[i.layout]);
      for (const r of i.rest) add(r.rect, 0, i.wallH, CUT);
      // Game tables (world/tables.ts) wear green baize.
      for (const p of i.props) if (!furnished.has(p)) add(p.rect, FLAT.has(p.kind) ? 0.06 : 0, p.h, p.kind === 'table' && felt.has(p) ? FELT : PROP[p.kind]);
    }
    box.build(scene);
  }

  /** Opens the walk-in place you're at or in (on foot); closes it again when you leave. (x, y) is
   *  where you are over the map and `f` your floor: upstairs, that floor is drawn at its height. */
  update(x: number, y: number, onFoot: boolean, f = 0): void {
    this.shade.update(x, y, f, onFoot);
    let want = -1, inside: Interior | undefined;
    if (onFoot || f > 0) {
      for (const i of this.city.interiors) {
        const r = i.room;
        if (x > r.x0 - NEAR && x < r.x1 + NEAR && y > r.y0 - NEAR && y < r.y1 + NEAR) { want = i.building; inside = i; break; }
      }
    }
    this.showFloor(f > 0 && inside ? inside : null, f);
    if (want === this.open) return;
    if (this.open >= 0) setHidden(this.open, false);
    if (want >= 0) setHidden(want, true);
    this.open = want;
  }

  /** Upper floors are built when someone's on one and dropped when they leave. */
  private floor: { key: string; group: THREE.Group } | null = null;

  private showFloor(i: Interior | null, f: number): void {
    const key = i ? `${i.building}:${f}` : '';
    if ((this.floor?.key ?? '') === key) return;
    if (this.floor) {
      this.scene.remove(this.floor.group);
      this.floor.group.traverse((o) => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); });
      this.floor = null;
    }
    const fl = i?.floors[f - 1];
    if (!i || !fl) return;
    const group = new THREE.Group();
    const base = f * FLOOR_H;
    const add = (r: { x0: number; y0: number; x1: number; y1: number }, y: number, h: number, color: string) => {
      const m = new THREE.Mesh(this.unit, new THREE.MeshLambertMaterial({ color }));
      const g0 = groundOf(r.x0, r.y0), g1 = groundOf(r.x1, r.y1);
      m.position.set((g0.x + g1.x) / 2, base + y, (g0.y + g1.y) / 2);
      m.scale.set(g1.x - g0.x, h, g1.y - g0.y);
      m.castShadow = h > 0.3;
      m.receiveShadow = true;
      group.add(m);
    };
    // The floor slab (a little thicker than the room so it reads as a floor), then walls and furniture.
    add(fl.rect, -0.25, 0.3, FLOOR[i.layout]);
    for (const w of fl.walls) add(w.rect, 0, w.h, WALL[i.layout]);
    for (const p of fl.props) add(p.rect, FLAT.has(p.kind) ? 0.05 : 0, Math.max(0.05, p.h), PROP[p.kind]);
    this.scene.add(group);
    this.floor = { key, group };
  }

  /** Vault doors blown open (interior indexes) are gone until the vault shuts again. */
  setVaults(open: number[]): void {
    for (const [k, g] of this.vaultDoors) g.visible = !open.includes(k);
  }

  /** The open place's lights, so it isn't a black hole at night. */
  putGlows(layer: ParticleLayer, night: number): void {
    if (this.open < 0 || night < 0.05) return;
    const i = this.city.interiors.find((x) => x.building === this.open);
    if (!i) return;
    const r = i.room;
    layer.put((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0.08, Math.max(r.x1 - r.x0, r.y1 - r.y0) * 1.1, 1, 0, 1, 0.92, 0.8, 0.45 * night);
  }
}
