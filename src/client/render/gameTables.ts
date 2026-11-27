// The card and casino tables as furniture (art/furniture.py models, loaded by render/models.ts):
// each table spot (world/tables.ts) gets its game's model, stretched to the spot's footprint and
// turned so its dealer's side is away from where you stand (a slot machine's front toward you),
// with its game's layout printed on the felt (render/feltPrint.ts); chairs round the poker and
// blackjack tables, a stool at each slot machine. Interiors (render/interiors.ts) leaves these
// props out of its plain boxes.
import * as THREE from 'three';
import { TABLES } from '../../shared/packs';
import type { GameKind } from '../../shared/packs/types';
import type { City } from '../../shared/world/cityTypes';
import type { TableSpot } from '../../shared/world/tables';
import { feltTexture, reelTexture, signTexture } from './feltPrint';
import { furnitureModel, type Model, type ModelPart } from './models';

const DEFAULT: Record<GameKind, string> = {
  holdem: 'card_table', draw: 'card_table', stud: 'card_table', blackjack: 'blackjack', twentyone: 'blackjack_wood',
  roulette: 'roulette', craps: 'craps', hazard: 'dice_table', faro: 'faro', slots: 'slots',
};
/** Games played sitting down (chairs for you and the others; at blackjack, for you). */
const SEATED = new Set<GameKind>(['holdem', 'draw', 'stud', 'blackjack', 'twentyone', 'faro']);
const METAL: Record<string, [number, number]> = { chrome: [1, 0.12], brass: [0.9, 0.3], stainless: [0.85, 0.3], steel: [0.8, 0.4], glass: [0.1, 0.05] };

/** The model a table is drawn with. */
export const tableModel = (spot: TableSpot): string => TABLES[spot.spec].model ?? DEFAULT[TABLES[spot.spec].game];

export class GameTables {
  /** The table props drawn here (Interiors skips them). */
  readonly drawn = new Set<object>();
  private materials = new Map<string, THREE.Material>();

  constructor(private scene: THREE.Scene, private city: City) {
    city.tables.forEach((spot, k) => this.table(spot, k));
  }

  private table(spot: TableSpot, k: number): void {
    const spec = TABLES[spot.spec];
    const id = tableModel(spot);
    const model = furnitureModel(id);
    if (!model) return;
    if (spot.prop) this.drawn.add(spot.prop);
    const r = spot.rect;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const slot = id === 'slots';
    // The dealer's side (the model's +Z) points away from you; a slot machine's front toward you.
    const dir = { x: (spot.at.x - cx) * (slot ? 1 : -1), y: (spot.at.y - cy) * (slot ? 1 : -1) };
    const along = r.x1 - r.x0 >= r.y1 - r.y0;
    const turns = slot ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] : along ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
    const rot = turns.reduce((best, a) => (Math.sin(a) * dir.x + Math.cos(a) * dir.y > Math.sin(best) * dir.x + Math.cos(best) * dir.y ? a : best));
    const box = bounds(model);
    const sizeX = box.max.x - box.min.x, sizeZ = box.max.z - box.min.z;
    // Stretched to the footprint (a slot machine keeps its own size, in the middle of its spot).
    const spanX = Math.abs(Math.cos(rot)) > 0.5 ? r.x1 - r.x0 : r.y1 - r.y0;
    const spanZ = Math.abs(Math.cos(rot)) > 0.5 ? r.y1 - r.y0 : r.x1 - r.x0;
    const sx = slot ? 1 : spanX / sizeX, sz = slot ? 1 : spanZ / sizeZ;
    const group = new THREE.Group();
    const place = spot.interior !== undefined ? this.city.interiors[spot.interior]?.place.name.split(',')[0] ?? '' : '';
    for (const part of model.parts) {
      const mesh = new THREE.Mesh(part.geometry, this.material(part, id, spec.name, place, k, box));
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.scale.set(sx, 1, sz);
    group.position.set(cx - ((box.min.x + box.max.x) / 2) * sx * Math.cos(rot) - ((box.min.z + box.max.z) / 2) * sz * Math.sin(rot), 0,
      cy + ((box.min.x + box.max.x) / 2) * sx * Math.sin(rot) - ((box.min.z + box.max.z) / 2) * sz * Math.cos(rot));
    group.rotation.y = rot;
    this.scene.add(group);
    // Seats: a stool at a slot machine; chairs for whoever plays sitting down.
    if (slot) this.seat('stool', spot.at.x, spot.at.y, cx, cy);
    else if (SEATED.has(spec.game)) {
      const wood = id !== 'poker_oval' && id !== 'blackjack';
      const chair = wood ? 'chair_wood' : 'chair';
      this.seat(chair, spot.at.x, spot.at.y, cx, cy);
      // Poker: everyone round the table; house games: the dealer stands.
      if (spec.game !== 'blackjack' && spec.game !== 'twentyone' && spec.game !== 'faro') for (const s of spot.seats) this.seat(chair, s.x, s.y, cx, cy);
    }
  }

  /** A chair or stool at (x, y), facing the table's middle. */
  private seat(id: string, x: number, y: number, tx: number, ty: number): void {
    const model = furnitureModel(id);
    if (!model) return;
    const g = new THREE.Group();
    for (const part of model.parts) {
      const m = new THREE.Mesh(part.geometry, this.material(part, id, '', '', 0, null));
      m.castShadow = true;
      g.add(m);
    }
    // The model faces -Z (its front, +Y in Blender, is -Z here): turn that toward the table.
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1;
    g.position.set(x + (dx / d) * 0.05, 0, y + (dy / d) * 0.05);
    g.rotation.y = Math.atan2(-dx, -dy);
    this.scene.add(g);
  }

  private material(part: ModelPart, model: string, game: string, house: string, k: number, box: THREE.Box3 | null): THREE.Material {
    if (part.role === 'felt' && box) {
      // Its own print: planar over the felt's footprint, the dealer's side (+Z) at the top.
      const fb = new THREE.Box3().setFromBufferAttribute(part.geometry.getAttribute('position') as THREE.BufferAttribute);
      planarUv(part.geometry, fb);
      const map = feltTexture(model, (fb.max.x - fb.min.x) / Math.max(0.01, fb.max.z - fb.min.z), { house: house.toUpperCase(), game, blackjack: model === 'blackjack' });
      return new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    }
    if (part.role === 'screen' || part.role === 'sign') {
      const fb = new THREE.Box3().setFromBufferAttribute(part.geometry.getAttribute('position') as THREE.BufferAttribute);
      frontUv(part.geometry, fb);
      const map = part.role === 'screen' ? reelTexture(k) : signTexture();
      return new THREE.MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: part.role === 'sign' ? 0.9 : 0.35, roughness: 0.3 });
    }
    const key = `${part.material}`;
    let m = this.materials.get(key);
    if (!m) {
      const [metalness, roughness] = METAL[part.material] ?? [0, part.material.startsWith('leather') ? 0.55 : 0.75];
      m = new THREE.MeshStandardMaterial({ color: part.color, metalness, roughness });
      this.materials.set(key, m);
    }
    return m;
  }
}

function bounds(model: Model): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of model.parts) { p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox!); }
  return b;
}

/** Top-down UVs: u across (from +X, so the print isn't mirrored seen from the player's side), v up
 *  toward +Z (the dealer). (The geometry's shared by every table of the model: the UVs are the same.) */
function planarUv(g: THREE.BufferGeometry, b: THREE.Box3): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (b.max.x - pos.getX(i)) / (b.max.x - b.min.x || 1);
    uv[i * 2 + 1] = (pos.getZ(i) - b.min.z) / (b.max.z - b.min.z || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Front-facing UVs (a slot machine's glass and sign, seen from +Z). */
function frontUv(g: THREE.BufferGeometry, b: THREE.Box3): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.min.x) / (b.max.x - b.min.x || 1);
    uv[i * 2 + 1] = (pos.getY(i) - b.min.y) / (b.max.y - b.min.y || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
