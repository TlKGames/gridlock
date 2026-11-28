import * as THREE from 'three';
import { VEHICLES } from '../../shared/packs';
import { EK } from '../../shared/protocol';
import type { EntityStore } from '../net/entities';

type Views = ReadonlyMap<number, { root: THREE.Group }>;

export class NpcPicker {
  private aimRay = new THREE.Raycaster();
  private aimPoint = new THREE.Vector3();
  private pointer = new THREE.Vector2();

  pick(camera: THREE.Camera, x: number, y: number, store: EntityStore, peds: Views, vehs: Views, shells: THREE.InstancedMesh[]): string {
    this.pointer.set(x, y);
    this.aimRay.setFromCamera(this.pointer, camera);
    let nearest = Infinity, name = '';
    for (const entity of store.all.values()) {
      if (entity.kind !== EK.Ped && entity.kind !== EK.Veh) continue;
      const vehicle = entity.kind === EK.Veh;
      const root = vehicle ? vehs.get(entity.id)?.root : peds.get(entity.id)?.root;
      if (!root?.visible || !root.parent?.visible) continue;
      root.getWorldPosition(this.aimPoint);
      const radius = vehicle ? VEHICLES[entity.data[2]].length + 4 : 4;
      if (this.aimRay.ray.distanceSqToPoint(this.aimPoint) > radius * radius) continue;
      const hit = this.aimRay.intersectObject(root).find(h => h.object instanceof THREE.Mesh && h.object.visible);
      if (hit && hit.distance < nearest) {
        nearest = hit.distance;
        name = entity.npcName ?? '';
        // A bike's meshes include its seated riders. Resolve a hit on the rider in the ped pass.
        if (vehicle && VEHICLES[entity.data[2]].saddles) nearest += 0.0001;
      }
    }
    if (name) {
      this.aimRay.far = nearest;
      const covered = this.aimRay.intersectObjects(shells, false).length > 0;
      this.aimRay.far = Infinity;
      if (covered) return '';
    }
    return name;
  }
}
