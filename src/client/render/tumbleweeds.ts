// Tumbleweeds: now and then a dry tangle of brush bowls across open country on the wind, bounding
// and rolling as it goes. Only where the country is open (a zone with brush, WildSpec.brush), one at
// a time and never more than a few in view; one shared wind from the west with a slow wander. Each
// client's own (scenery: not solid, nothing on the wire).
import * as THREE from 'three';
import { ZONES } from '../../shared/packs';
import { Rng } from '../../shared/rng';
import type { CityMap } from '../../shared/world/city';
import { groundAt } from '../../shared/world/terrain';

/** At most this many in view; a new one every so often (s); how fast they go (m/s). */
const MAX = 3;
const EVERY: [number, number] = [3, 9];
const SPEED: [number, number] = [3, 7];

/** A tangle of thin dry twigs on a rough ball, straw to brown: wire-thin from above, as they are. */
function tangle(): THREE.BufferGeometry {
  const rng = new Rng(733);
  const pos: number[] = [], col: number[] = [];
  const straw = new THREE.Color('#d2b47a'), brown = new THREE.Color('#7a5a36');
  const point = () => {
    // A point in a rough shell: mostly near the surface, some inside.
    const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
    const r = rng.chance(0.75) ? rng.range(0.75, 1.05) : rng.range(0.3, 0.75);
    return new THREE.Vector3(Math.cos(a) * s * r, u * r * 0.9, Math.sin(a) * s * r);
  };
  for (let k = 0; k < 260; k++) {
    const p = point();
    // Each twig bends once on its way to a nearby point.
    const q = p.clone().add(new THREE.Vector3(rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5))).clampLength(0, 1.05);
    const m = p.clone().lerp(q, 0.5).add(new THREE.Vector3(rng.range(-0.12, 0.12), rng.range(-0.12, 0.12), rng.range(-0.12, 0.12)));
    const c = straw.clone().lerp(brown, rng.next());
    for (const [a, b] of [[p, m], [m, q]]) {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

interface Weed { root: THREE.Group; ball: THREE.Object3D; shadow: THREE.Mesh; x: number; y: number; v: number; r: number; spin: number; hop: number; vz: number; z: number; alive: boolean }

export class Tumbleweeds {
  private weeds: Weed[] = [];
  private t = 0;
  private next = 2;
  private open: boolean;

  constructor(scene: THREE.Scene, private map: CityMap) {
    this.open = ZONES.some((z) => z.wild?.brush);
    if (!this.open) return;
    const twigs = tangle();
    const lines = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
    const body = new THREE.MeshLambertMaterial({ color: '#b89a64', transparent: true, opacity: 0.22, depthWrite: false });
    const core = new THREE.IcosahedronGeometry(0.8, 1);
    const shade = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false });
    const disc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
    for (let k = 0; k < MAX; k++) {
      const root = new THREE.Group();
      const ball = new THREE.Group();
      ball.add(new THREE.LineSegments(twigs, lines), new THREE.Mesh(core, body));
      root.add(ball);
      const shadow = new THREE.Mesh(disc, shade);
      shadow.renderOrder = 1;
      scene.add(root, shadow);
      root.visible = shadow.visible = false;
      this.weeds.push({ root, ball, shadow, x: 0, y: 0, v: 0, r: 0.6, spin: 0, hop: 0, vz: 0, z: 0, alive: false });
    }
  }

  private isOpen(x: number, y: number): boolean {
    const z = this.map.zoneAt(x, y);
    return z >= 0 && !!ZONES[z].wild?.brush && !this.map.isWater(x, y);
  }

  /** Every frame, with the camera's view of the ground. */
  update(dt: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    if (!this.open) return;
    this.t += dt;
    // The wind: from the west, veering slowly, gusting.
    const dir = Math.sin(this.t * 0.05) * 0.35;
    const wx = Math.cos(dir), wy = Math.sin(dir);
    const gust = 0.75 + 0.45 * Math.sin(this.t * 0.9) * Math.sin(this.t * 0.37);
    this.next -= dt;
    if (this.next <= 0) {
      this.next = EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]);
      const g = this.weeds.find((w) => !w.alive);
      // In from the upwind edge, somewhere along it, where the country is open.
      const x = view.x0 - 2, y = view.y0 + (0.1 + Math.random() * 0.8) * (view.y1 - view.y0);
      if (g && this.isOpen(x + 8, y)) {
        Object.assign(g, { x, y, v: SPEED[0] + Math.random() * (SPEED[1] - SPEED[0]), r: 0.45 + Math.random() * 0.35, spin: 0, hop: Math.random() * 6, vz: 0, z: 0, alive: true });
        g.root.scale.setScalar(g.r);
        g.root.visible = g.shadow.visible = true;
      }
    }
    for (const g of this.weeds) {
      if (!g.alive) continue;
      const v = g.v * gust;
      g.x += wx * v * dt; g.y += wy * v * dt;
      // Bounding: kicked up off bumps now and then, falling back under gravity.
      g.vz -= 9.8 * dt;
      g.z += g.vz * dt;
      if (g.z <= 0) { g.z = 0; g.vz = Math.random() < 0.35 ? (1 + Math.random() * 2.2) * Math.min(1, v / 5) : 0; }
      g.spin += (v / g.r) * dt;
      g.hop += dt;
      // Over the hills (world/terrain.ts), its hop above the ground it's crossing.
      const ground = groundAt(g.x, g.y);
      g.root.position.set(g.x, ground + g.r + g.z, g.y);
      // Rolling about the axis across the wind, with a wobble.
      g.ball.rotation.set(wy * g.spin, Math.sin(g.hop * 1.7) * 0.4, -wx * g.spin);
      g.shadow.position.set(g.x + 0.25, groundAt(g.x + 0.25, g.y + 0.25) + 0.03, g.y + 0.25);
      g.shadow.scale.setScalar(g.r * (1 - Math.min(0.5, g.z * 0.25)));
      if (g.x > view.x1 + 4 || g.y < view.y0 - 6 || g.y > view.y1 + 6 || !this.isOpen(g.x, g.y)) {
        g.alive = false;
        g.root.visible = g.shadow.visible = false;
      }
    }
  }
}
