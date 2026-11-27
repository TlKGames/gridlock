// Sea and river surfaces with a scrolling procedural normal map, plus bridge decks over the river.
import * as THREE from 'three';
import { OverheadFade } from './overheadFade';
import type { Rect } from '../../shared/math';
import { Rng } from '../../shared/rng';
import type { CityMap } from '../../shared/world/city';
import { waterfrontRails, RAIL_HEIGHT } from '../../shared/world/waterfront';
import { LANE_W } from '../../shared/world/cityTypes';
import { WORLD } from '../../shared/world/worldSpec';
import { Batch, lambert, UNIT } from './instancing';

function normalMap(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const rng = new Rng(7);
  // Sum of a few tileable sine waves gives a height field; normals from its gradient.
  const waves = Array.from({ length: 6 }, () => ({ kx: rng.int(1, 6), ky: rng.int(-6, 6), ph: rng.next() * 6.28, a: rng.range(0.4, 1) }));
  const hgt = (x: number, y: number) => waves.reduce((s, w) => s + w.a * Math.sin(((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.ph), 0);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
      const nx = -dx * 2, ny = -dy * 2, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * N + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function spanEdge(b: Rect, x: number, y: number): number {
  return Math.max(b.x0 - x, x - b.x1, b.y0 - y, y - b.y1);
}

export class BridgeFade extends OverheadFade {
  constructor(private spans: Rect[]) { super(); }

  follow(x: number, y: number, length: number): void {
    // Begin before the bow enters and hold until the stern clears, in either direction.
    let strength = 0;
    if (length) for (const b of this.spans) {
      strength = 1 - THREE.MathUtils.smoothstep(spanEdge(b, x, y) - length / 2, 0, 3);
      if (strength > 0) {
        this.bounds.set(b.x0 - 0.5, b.y0 - 1, b.x1 + 0.5, b.y1 + 1);
        break;
      }
    }
    this.focus.value.set(x, -4, y, strength);
  }
}

export class Water {
  readonly fade: BridgeFade;
  private tex: THREE.CanvasTexture;
  private t = 0;

  constructor(scene: THREE.Scene, map: CityMap) {
    this.fade = new BridgeFade(map.city.bridges);
    this.tex = normalMap();
    this.tex.repeat.set(1 / 80, 1 / 80);
    const mat = new THREE.MeshStandardMaterial({ color: '#163a47', roughness: 0.32, metalness: 0.1, normalMap: this.tex, normalScale: new THREE.Vector2(0.22, 0.22) });
    // World-space UVs so the pattern is continuous across planes.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_NORMALMAP
          vNormalMapUv = (normalMapTransform * vec3((modelMatrix * vec4(position, 1.0)).xz, 1.0)).xy;
        #endif`);
    };
    const plane = (x0: number, y0: number, x1: number, y1: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0).rotateX(-Math.PI / 2), mat);
      m.position.set((x0 + x1) / 2, 0.03, (y0 + y1) / 2);
      m.renderOrder = -3;
      m.receiveShadow = true;
      scene.add(m);
    };
    const far = 6000, { lo, hi } = map.shore;
    if (map.city.edge === 'sea') {
      plane(-far, -far, far, lo);
      plane(-far, hi, far, far);
      plane(-far, lo, lo, hi);
      plane(hi, lo, far, hi);
    }
    const r = map.river;
    if (r) plane(lo, r.y0, hi, r.y1);
    for (const p of map.city.ponds) plane(p.x0, p.y0, p.x1, p.y1);
    const timber = new Batch(UNIT.box(), lambert());
    for (const d of map.docks) {
      const w = d.x1 - d.x0, h = d.y1 - d.y0, cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
      const horizontal = w > h, count = Math.round(Math.max(w, h) / 0.35);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        timber.add(horizontal ? d.x0 + t * w : cx, 0.05, horizontal ? cy : d.y0 + t * h,
          horizontal ? w / count - 0.02 : w, 0.12, horizontal ? h : h / count - 0.02, ['#967552', '#886a4c', '#907153'][i % 3]);
      }
      for (const x of [d.x0 + 0.18, d.x1 - 0.18]) for (const y of [d.y0 + 0.18, d.y1 - 0.18])
        timber.add(x, 0, y, 0.24, 0.4, 0.24, '#584431');
    }
    timber.build(scene);
    const rails = new Batch(UNIT.box(), lambert());
    for (const wall of waterfrontRails(map.city, map.shore, map.docks)) {
      const w = wall.x1 - wall.x0, l = wall.y1 - wall.y0;
      const x = (wall.x0 + wall.x1) / 2, y = (wall.y0 + wall.y1) / 2;
      // Concrete parapet with a lighter cap, like the rails of the road bridges.
      rails.add(x, 0, y, w, RAIL_HEIGHT - 0.12, l, '#969596');
      rails.add(x, RAIL_HEIGHT - 0.12, y, w, 0.12, l, '#b8b5ac');
    }
    rails.build(scene);
    if (r) this.bridges(scene, map, r);
  }

  private bridges(scene: THREE.Scene, map: CityMap, r: { y0: number; y1: number }): void {
    const deck = new Batch(UNIT.box(), this.fade.material(lambert()));
    // Roads and water are practically level in the simulation. Keep the water and boats'
    // colour, then restore water-surface depth under each deck before drawing road traffic.
    const channel = new Batch(UNIT.box(), new THREE.MeshBasicMaterial({
      colorWrite: false, depthFunc: THREE.AlwaysDepth,
    }), { cast: false, receive: false });
    for (const b of map.city.bridges) {
      const w = b.x1 - b.x0, len = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      channel.add(cx, 0.02, cy, w + 0.8, 0.01, len, '#ffffff');
      if (!WORLD.modern) { timberBridge(deck, cx, cy, w, len, r); continue; }
      deck.add(cx, -1.4, cy, w + 0.6, 1.44, len, '#5d5f62');
      deck.add(cx, 0.08, cy, w, 0.02, len, '#3a3d42');
      // Lane markings on the deck.
      deck.add(cx - 0.2, 0.1, cy, 0.15, 0.01, len, '#e2b93b');
      deck.add(cx + 0.2, 0.1, cy, 0.15, 0.01, len, '#e2b93b');
      deck.add(cx - LANE_W, 0.1, cy, 0.12, 0.01, len, '#d8d6cf');
      deck.add(cx + LANE_W, 0.1, cy, 0.12, 0.01, len, '#d8d6cf');
      // Railings and posts.
      for (const side of [-1, 1]) {
        const x = cx + side * (w / 2 + 0.15);
        deck.add(x, 0, cy, 0.3, 1.0, len, '#9a978e');
        deck.add(x, 1.0, cy, 0.4, 0.12, len, '#b8b5ac');
      }
      // Piers in the river.
      for (let y = r.y0 + 12; y < r.y1 - 6; y += 22) deck.add(cx, -4, y, w * 0.6, 4, 3, '#6d6b66');
    }
    for (const mesh of channel.build(scene)) mesh.renderOrder = -1;
    deck.build(scene);
  }

  update(dt: number): void {
    this.t += dt;
    this.tex.offset.set(this.t * 0.004, this.t * 0.0025);
  }
}

/** A trestle bridge before concrete: a plank deck (boards across it) on timber stringers, a rail of
 *  posts and a top rail each side, and pile bents standing in the river. */
function timberBridge(deck: Batch, cx: number, cy: number, w: number, len: number, r: { y0: number; y1: number }): void {
  deck.add(cx, -0.9, cy, w + 0.4, 1.0, len, '#4a3624');
  deck.add(cx, 0.06, cy, w, 0.05, len, '#7a5a3a');
  for (let y = cy - len / 2 + 0.2; y < cy + len / 2; y += 1.1) deck.add(cx, 0.1, y, w, 0.02, 0.08, '#4e3a26');
  for (const side of [-1, 1]) {
    const x = cx + side * (w / 2 + 0.1);
    for (let y = cy - len / 2 + 0.5; y < cy + len / 2; y += 2.4) deck.add(x, 0, y, 0.18, 1.1, 0.18, '#5a4026');
    deck.add(x, 1.0, cy, 0.14, 0.12, len, '#6a4a2e');
  }
  for (let y = r.y0 + 8; y < r.y1 - 4; y += 9) {
    for (let k = -1; k <= 1; k++) deck.add(cx + k * w * 0.35, -4, y, 0.4, 4, 0.4, '#3e2c1a');
    deck.add(cx, -1.2, y, w, 0.3, 0.4, '#3e2c1a');
  }
}
