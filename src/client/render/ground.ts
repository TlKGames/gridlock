// Streams ground chunks (canvas textures on planes, bent over the land in open country) around
// the camera. A chunk takes 10-20 ms to paint and shape, too long for one frame: one coming into
// the margin round the view is built as a job spread over frames, a few milliseconds each; only a
// chunk already on screen (arriving, a jump across the map) is built at once.
import * as THREE from 'three';
import type { CityMap } from '../../shared/world/city';
import { MAP_SIZE } from '../../shared/world/cityTypes';
import { buildBrush } from './brush';
import { CHUNK, GROUND_PX, PREVIEW_PX, paintChunk } from './groundPaint';
import { hasWild } from './groundRelief';
import { strataOf, terrainGeo, terrainMaterial } from './terrainMesh';

/** `brush`: its bushes (brush.ts), built and dropped with it. */
interface Chunk { mesh: THREE.Mesh; tex: THREE.CanvasTexture; used: number; brush: THREE.InstancedMesh[] }

// RGBA8 plus mipmaps. Visible tiles take priority if a very wide view exceeds the budget.
const CACHE_BYTES = 64 * 1024 * 1024;
const textureBytes = (tex: THREE.CanvasTexture) => tex.image.width * tex.image.height * 4 * 4 / 3;
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
  private lastX = 0;
  private lastY = 0;

  constructor(private scene: THREE.Scene, private map: CityMap, private renderer: THREE.WebGLRenderer) {
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
    const aheadX = cx + THREE.MathUtils.clamp((cx - this.lastX) * 20, -VIEW_MARGIN, VIEW_MARGIN);
    const aheadY = cy + THREE.MathUtils.clamp((cy - this.lastY) * 20, -VIEW_MARGIN, VIEW_MARGIN);
    this.lastX = cx;
    this.lastY = cy;
    const missing: [number, number, number][] = [];
    const previews: [number, number, number][] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = this.chunks.get(j * N + i);
        if (c) {
          c.used = this.frame;
          if (c.tex.image.width === CHUNK * GROUND_PX) continue;
        }
        const d = ((i + 0.5) * CHUNK - aheadX) ** 2 + ((j + 0.5) * CHUNK - aheadY) ** 2;
        (c ? previews : missing).push([i, j, d]);
      }
    }
    missing.sort((a, b) => a[2] - b[2]);
    previews.sort((a, b) => a[2] - b[2]);
    // On screen: built now, whole (finishing it if it's the job under way). Nearest first.
    const onScreen = (i: number, j: number) => (i + 1) * CHUNK > view.x0 + VIEW_MARGIN && i * CHUNK < view.x1 - VIEW_MARGIN
      && (j + 1) * CHUNK > view.y0 + VIEW_MARGIN && j * CHUNK < view.y1 - VIEW_MARGIN;
    let urgent = 0;
    for (const [i, j] of missing) {
      if (urgent >= URGENT_PER_FRAME || !onScreen(i, j)) continue;
      const k = j * N + i;
      const steps = this.job?.k === k ? this.job.steps : this.build(i, j, PREVIEW_PX);
      if (this.job?.k === k) this.job = null;
      while (!steps.next().done) { /* all of it, this frame */ }
      urgent++;
    }
    // In the margin: the job, a few milliseconds a frame; the nearest missing chunk next.
    if (this.job) {
      const i = this.job.k % N, j = Math.floor(this.job.k / N);
      if (i < i0 || i > i1 || j < j0 || j > j1) this.job = null;
    }
    const t0 = performance.now();
    while (performance.now() - t0 < BUILD_BUDGET_MS) {
      if (!this.job) {
        const next = missing.find(([i, j]) => !this.chunks.has(j * N + i));
        const tile = next ?? previews[0];
        if (!tile) break;
        const [i, j] = tile;
        this.job = { k: j * N + i, steps: next ? this.build(i, j, GROUND_PX) : this.refine(i, j) };
      }
      if (this.job.steps.next().done) {
        this.job = null;
        break; // At most one background texture becomes ready for upload per frame.
      }
    }
    this.evict();
  }

  private *texture(i: number, j: number, px: number): Generator<void, THREE.CanvasTexture> {
    const canvas = document.createElement('canvas');
    yield* paintChunk(this.map, i, j, canvas, px);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    this.renderer.initTexture(tex);
    return tex;
  }

  private *refine(i: number, j: number): Generator<void> {
    const chunk = this.chunks.get(j * N + i)!;
    const tex = yield* this.texture(i, j, GROUND_PX);
    (chunk.mesh.material as THREE.MeshLambertMaterial).map = tex;
    chunk.tex.dispose();
    chunk.tex = tex;
  }

  private *build(i: number, j: number, px: number): Generator<void> {
    // alphaTest: a trench's cut-out (groundPaint.ts) shows through.
    // Out in the hills a bent surface (terrainMesh.ts) that shades and casts shadow; else flat.
    const hills = yield* terrainGeo(i * CHUNK, j * CHUNK, CHUNK);
    // Upload last so a cancelled terrain job has no GPU resources to release.
    const tex = yield* this.texture(i, j, px);
    const mat = hills ? terrainMaterial(tex, strataOf(this.map, (i + 0.5) * CHUNK, (j + 0.5) * CHUNK))
      : new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(hills ?? this.geo, mat);
    mesh.castShadow = !!hills;
    mesh.position.set((i + 0.5) * CHUNK, 0, (j + 0.5) * CHUNK);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    const brush = hasWild() ? buildBrush(this.scene, this.map, i * CHUNK, j * CHUNK, CHUNK) : [];
    this.chunks.set(j * N + i, { mesh, tex, used: this.frame, brush });
  }

  private evict(): void {
    let bytes = 0;
    for (const c of this.chunks.values()) bytes += textureBytes(c.tex);
    if (bytes <= CACHE_BYTES) return;
    const sorted = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [k, c] of sorted) {
      if (bytes <= CACHE_BYTES || c.used === this.frame) break;
      bytes -= textureBytes(c.tex);
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
