// The vehicle, weapon and furniture models built in Blender (art/build.py), loaded once at startup. Each model
// is a node named after its game id (userData.model) holding a static mesh and any moving parts
// (userData.anim: rotor, tailrotor, turret) whose origin is their pivot. Materials say how they're
// drawn: vehicles by role (userData.role: paint, fixed, shiny, head, tail, siren_red, siren_blue),
// weapons by name (w_steel, w_wood...). Until they load, or if they fail, the packs' box models stand in.
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import dracoWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import dracoWrapper from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import { ASSETS } from '../assets';
import furnitureGlb from '../models/furniture.glb?url';

/** One material's worth of a model: geometry in the model's own space (metres, x forward, y up). */
export interface ModelPart { role: string; material: string; color: THREE.Color; geometry: THREE.BufferGeometry }
/** A moving part: its geometry is relative to `pivot` (the model-space point it turns about). */
export interface ModelAnim { tag: string; pivot: THREE.Vector3; parts: ModelPart[] }
export interface Model { parts: ModelPart[]; anim: ModelAnim[] }

const vehicles = new Map<string, Model>();
const weapons = new Map<string, Model>();
const furniture = new Map<string, Model>();

export const vehicleModel = (id: string): Model | undefined => vehicles.get(id);
export const weaponGlb = (id: string): Model | undefined => weapons.get(id);
/** Casino and card-room furniture (art/furniture.py), the same in every universe. */
export const furnitureModel = (id: string): Model | undefined => furniture.get(id);

/** Draco's decoder ships with three; Vite gives its two files hashed URLs, so look them up by name. */
function draco(): DRACOLoader {
  const d = new DRACOLoader();
  const files: Record<string, string> = { 'draco_wasm_wrapper.js': dracoWrapper, 'draco_decoder.wasm': dracoWasm };
  (d as unknown as { _loadLibrary: (url: string, type: string) => Promise<unknown> })._loadLibrary = (url, type) =>
    new Promise((resolve, reject) => {
      const f = new THREE.FileLoader(d.manager);
      f.setResponseType(type as 'arraybuffer' | 'text');
      f.load(files[url] ?? url, resolve, undefined, reject);
    });
  return d;
}

function partsOf(node: THREE.Object3D, space: THREE.Matrix4, skip: (o: THREE.Object3D) => boolean): ModelPart[] {
  const out: ModelPart[] = [];
  node.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip(o)) return;
    const mat = o.material as THREE.MeshStandardMaterial;
    const g = (o.geometry as THREE.BufferGeometry).clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(space, o.matrixWorld));
    out.push({ role: (mat.userData.role as string) ?? 'fixed', material: mat.name, color: mat.color.clone(), geometry: g });
  });
  return out;
}

/** Splits a loaded scene into models by their id nodes. */
function index(scene: THREE.Object3D, into: Map<string, Model>): void {
  scene.updateMatrixWorld(true);
  for (const root of scene.children) {
    const id = root.userData.model as string | undefined;
    if (!id) continue;
    const toRoot = root.matrixWorld.clone().invert();
    const inAnim = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.anim) return true; return false; };
    const anim: ModelAnim[] = [];
    for (const child of root.children) {
      if (!child.userData.anim) continue;
      const pivot = child.getWorldPosition(new THREE.Vector3()).applyMatrix4(toRoot);
      anim.push({ tag: child.userData.anim as string, pivot, parts: partsOf(child, child.matrixWorld.clone().invert(), () => false) });
    }
    into.set(id, { parts: partsOf(root, toRoot, inAnim), anim });
  }
}

/** Loads both model sets. Resolves either way: whatever failed keeps its stand-in. */
export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader().setDRACOLoader(draco());
  const one = async (url: string, into: Map<string, Model>) => {
    try { index((await loader.loadAsync(url)).scene, into); } catch (e) { console.warn('models: could not load', url, e); }
  };
  // The installed universe's models (client/assets.ts); a universe without them draws box models.
  await Promise.all([
    ASSETS.vehiclesGlb ? one(ASSETS.vehiclesGlb, vehicles) : undefined,
    ASSETS.weaponsGlb ? one(ASSETS.weaponsGlb, weapons) : undefined,
    one(furnitureGlb, furniture),
  ]);
}
