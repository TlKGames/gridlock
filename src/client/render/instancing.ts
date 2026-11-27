// Collects many copies of one geometry (position, scale, yaw, colour) into InstancedMeshes,
// split into map tiles so the renderer (and the shadow pass) can frustum-cull each tile.
import * as THREE from 'three';
import { ownInstance } from './hideable';

interface Inst { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number; color: string; owner: number }

export const TILE = 160;

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const c = new THREE.Color();

export const tileKey = (x: number, z: number): number => Math.floor(z / TILE) * 1000 + Math.floor(x / TILE);

/** Groups items by map tile. */
export function byTile<T>(items: T[], pos: (t: T) => [number, number]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const it of items) {
    const [x, z] = pos(it);
    const k = tileKey(x, z);
    let arr = out.get(k);
    if (!arr) { arr = []; out.set(k, arr); }
    arr.push(it);
  }
  return out;
}

export class Batch {
  private items: Inst[] = [];
  /** Instances added from now on belong to this owner (a building that can be hidden; -1 none). */
  owner = -1;

  constructor(private geo: THREE.BufferGeometry, private mat: THREE.Material, private shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true }) {}

  /** (x, z) is the ground position in world metres, y the base height. */
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, rot = 0): void {
    this.items.push({ x, y, z, sx, sy, sz, rot, color, owner: this.owner });
  }

  get size(): number {
    return this.items.length;
  }

  build(scene: THREE.Object3D): THREE.InstancedMesh[] {
    const meshes: THREE.InstancedMesh[] = [];
    for (const group of byTile(this.items, (it) => [it.x, it.z]).values()) {
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, group.length);
      group.forEach((it, i) => {
        q.setFromAxisAngle(up, it.rot);
        mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz)));
        mesh.setColorAt(i, c.set(it.color));
        if (it.owner >= 0) ownInstance(it.owner, mesh, i, m);
      });
      mesh.castShadow = this.shadows.cast;
      mesh.receiveShadow = this.shadows.receive;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      meshes.push(mesh);
    }
    this.items = [];
    return meshes;
  }
}

/** Unit geometries with their base at y = 0. */
export const UNIT = {
  box: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: (seg = 8) => new THREE.CylinderGeometry(0.5, 0.5, 1, seg).translate(0, 0.5, 0),
  /** Triangular prism with the ridge along x. */
  gable: () => {
    const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  },
};

export const lambert = () => new THREE.MeshLambertMaterial();
