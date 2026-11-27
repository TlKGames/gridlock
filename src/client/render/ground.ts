// Streams ground chunks (canvas textures on planes, bent over the land in open country) around
// the camera. A chunk takes 10-20 ms to paint and shape, too long for one frame: one coming into
// the margin round the view is built as a job spread over frames, a few milliseconds each; only a
// chunk already on screen (arriving, a jump across the map) is built at once.
import * as THREE from 'three';
import type { CityMap } from '../../shared/world/city';
import { MAP_SIZE } from '../../shared/world/cityTypes';
import { buildBrush } from './brush';
import { CHUNK, paintChunk } from './groundPaint';
import { hasWild } from './groundRelief';
import { strataOf, terrainGeo, terrainMaterial } from './terrainMesh';

/** `brush`: its bushes (brush.ts), built and dropped with it. */
interface Chunk { mesh: THREE.Mesh; tex: THREE.CanvasTexture; used: number; brush: THREE.InstancedMesh[] }

const MAX_CHUNKS = 48;
/** Chunks on screen built at once per frame; the time (ms) per frame for the job in the margin. */
const URGENT_PER_FRAME = 3;
const BUILD_BUDGET_MS = 3;
/** The margin the camera's view rect has round what's on screen (render/camera.ts viewRect). */
const VIEW_MARGIN = 40;
const N = Math.ceil(MAP_SIZE / CHUNK);

/** A chunk being built over frames. */
interface Job { k: number; steps: Generator<void> }

export class Ground {
  private chunks = new Map<number, Chunk>();
  private job: Job | null = null;
  private geo = new THREE.PlaneGeometry(CHUNK, CHUNK).rotateX(-Math.PI / 2);
  private sea: THREE.Mesh;
  private frame = 0;

  constructor(private scene: THREE.Scene, private map: CityMap, private maxAniso: number) {
    // A huge plane under everything for areas outside the map: sea, or (landlocked) bare rock.
    const past = map.city.edge === 'sea' ? '#1f4250' : '#6e5440';
    const c = MAP_SIZE / 2, R = 4000;
    const shape = new THREE.Shape([new THREE.Vector2(c - R, c - R), new THREE.Vector2(c + R, c - R), new THREE.Vector2(c + R, c + R), new THREE.Vector2(c - R, c + R)]);
    this.sea = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: past, side: THREE.DoubleSide }));
    // Below the lowest wash (world/terrain.ts), or it would show through wherever the land dips.
    const t = map.city.terrain;
    let low = 0;
    if (t) for (let k = 0; k < t.base.length; k++) low = Math.min(low, t.base[k] - t.gorgeD[k]);
    this.sea.position.set(0, -0.05 + (low < 0 ? low - 0.5 : 0), 0);
    this.sea.receiveShadow = true;
    scene.add(this.sea);
  }

  update(view: { x0: number; y0: number; x1: number; y1: number }): void {
    this.frame++;
    const i0 = Math.max(0, Math.floor(view.x0 / CHUNK)), i1 = Math.min(N - 1, Math.floor(view.x1 / CHUNK));
    const j0 = Math.max(0, Math.floor(view.y0 / CHUNK)), j1 = Math.min(N - 1, Math.floor(view.y1 / CHUNK));
    const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
    const missing: [number, number, number][] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        const c = this.chunks.get(k);
        if (c) { c.used = this.frame; continue; }
        const d = ((i + 0.5) * CHUNK - cx) ** 2 + ((j + 0.5) * CHUNK - cy) ** 2;
        missing.push([i, j, d]);
      }
    }
    missing.sort((a, b) => a[2] - b[2]);
    // On screen: built now, whole (finishing it if it's the job under way). Nearest first.
    const onScreen = (i: number, j: number) => (i + 1) * CHUNK > view.x0 + VIEW_MARGIN && i * CHUNK < view.x1 - VIEW_MARGIN
      && (j + 1) * CHUNK > view.y0 + VIEW_MARGIN && j * CHUNK < view.y1 - VIEW_MARGIN;
    let urgent = 0;
    for (const [i, j] of missing) {
      if (urgent >= URGENT_PER_FRAME || !onScreen(i, j)) continue;
      const k = j * N + i;
      const steps = this.job?.k === k ? this.job.steps : this.build(i, j);
      if (this.job?.k === k) this.job = null;
      while (!steps.next().done) { /* all of it, this frame */ }
      urgent++;
    }
    // In the margin: the job, a few milliseconds a frame; the nearest missing chunk next.
    const t0 = performance.now();
    while (performance.now() - t0 < BUILD_BUDGET_MS) {
      if (!this.job) {
        const next = missing.find(([i, j]) => !this.chunks.has(j * N + i));
        if (!next) break;
        this.job = { k: next[1] * N + next[0], steps: this.build(next[0], next[1]) };
      }
      if (this.job.steps.next().done) this.job = null;
    }
    if (this.chunks.size > MAX_CHUNKS) this.evict();
  }

  /** Builds a chunk, pausing as it goes (a generator; the chunk is in place when it's done). */
  private *build(i: number, j: number): Generator<void> {
    const canvas = document.createElement('canvas');
    yield* paintChunk(this.map, i, j, canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    tex.generateMipmaps = true;
    // alphaTest: a trench's cut-out (groundPaint.ts) shows through.
    // Out in the hills a bent surface (terrainMesh.ts) that shades and casts shadow; else flat.
    const hills = yield* terrainGeo(i * CHUNK, j * CHUNK, CHUNK);
    const mat = hills ? terrainMaterial(tex, strataOf(this.map, (i + 0.5) * CHUNK, (j + 0.5) * CHUNK))
      : new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(hills ?? this.geo, mat);
    mesh.castShadow = !!hills;
    mesh.position.set((i + 0.5) * CHUNK, 0, (j + 0.5) * CHUNK);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    yield;
    const brush = hasWild() ? buildBrush(this.scene, this.map, i * CHUNK, j * CHUNK, CHUNK) : [];
    this.chunks.set(j * N + i, { mesh, tex, used: this.frame, brush });
  }

  private evict(): void {
    const sorted = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, c] of sorted.slice(0, this.chunks.size - MAX_CHUNKS)) {
      if (c.used === this.frame) break;
      this.scene.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
      if (c.mesh.geometry !== this.geo) c.mesh.geometry.dispose();
      c.tex.dispose();
      // The bush shape and material are shared; only each chunk's instances go.
      for (const b of c.brush) { this.scene.remove(b); b.dispose(); }
      this.chunks.delete(k);
    }
  }
}
