// Visual effects for server FX events and continuous effects (smoke, fire, skids, glows). Heights
// passed in are over the ground at that point (world/terrain.ts: the hills), except a shot's z0.
import * as THREE from 'three';
import { WEAPONS } from '../../shared/packs';
import { HIT } from '../../shared/protocol';
import { groundAt } from '../../shared/world/terrain';
import { beamTexture } from './carLights';
import { ParticleLayer } from './particles';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  readonly add: ParticleLayer;     // fire, flashes, tracers, sparks, glows
  readonly alpha: ParticleLayer;   // smoke, dust
  readonly decals: ParticleLayer;  // blood, scorch, skids (long-lived, on the ground)
  readonly glow: ParticleLayer;    // night lights pooled on the ground, rebuilt each frame
  readonly beams: ParticleLayer;   // headlight beams on the road, rebuilt each frame
  private flashes: { light: THREE.PointLight; t: number; max: number; i: number }[] = [];

  constructor(scene: THREE.Scene, private lights: THREE.PointLight[]) {
    this.decals = new ParticleLayer(scene, 2400, false, 1);
    this.glow = new ParticleLayer(scene, 900, true, 2);
    this.beams = new ParticleLayer(scene, 500, true, 2, beamTexture());
    this.alpha = new ParticleLayer(scene, 900, false, 3);
    this.add = new ParticleLayer(scene, 1400, true, 4);
  }

  update(dt: number): void {
    this.add.update(dt);
    this.alpha.update(dt);
    this.decals.update(dt);
    for (const f of this.flashes) {
      f.t += dt;
      f.light.intensity = f.i * Math.max(0, 1 - f.t / f.max);
    }
    this.flashes = this.flashes.filter((f) => f.t < f.max);
  }

  private flash(x: number, y: number, z: number, intensity: number, dur: number, color = '#ffb060'): void {
    const light = this.lights.find((l) => !this.flashes.some((f) => f.light === l)) ?? this.lights[0];
    light.position.set(x, z, y);
    light.color.set(color);
    this.flashes = this.flashes.filter((f) => f.light !== light);
    this.flashes.push({ light, t: 0, max: dur, i: intensity });
  }

  /** `z0`: how high (in the scene) it leaves the gun; the tracer runs from there to the hit, at body
   *  height over the ground there. Without it, body height over the shooter's ground. */
  shot(x0: number, y0: number, x1: number, y1: number, wi: number, hit: number, z0 = groundAt(x0, y0) + 1.2): void {
    const spec = WEAPONS[wi];
    const z1 = groundAt(x1, y1) + 1.2;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    if (spec.kind === 'flame') {
      for (let k = 0; k < 3; k++) {
        const t = Math.random();
        this.add.spawn({ x: x0 + dx * t * 0.3, y: y0 + dy * t * 0.3, z: z0 - 0.2, vx: (dx / len) * rnd(9, 14) + rnd(-1.5, 1.5), vy: (dy / len) * rnd(9, 14) + rnd(-1.5, 1.5),
          size: 0.6, grow: 2.6, max: rnd(0.5, 0.8), r: 1, g: rnd(0.45, 0.7), b: 0.15, a: 0.9, drag: 1.5 });
      }
      return;
    }
    const tc = new THREE.Color(spec.tracer);
    this.add.spawn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, size: 0.09, stretch: len / 0.09, rot: ang, max: 0.06, r: tc.r, g: tc.g, b: tc.b, a: 0.9 });
    // The muzzle flash, at the gun's mouth.
    this.add.spawn({ x: x0, y: y0, z: z0, size: 0.9, max: 0.05, r: 1, g: 0.8, b: 0.4, a: 1 });
    if (Math.random() < 0.35) this.flash(x0, y0, z0 + 0.8, 6, 0.06);
    if (hit === HIT.wall || hit === HIT.metal) {
      for (let k = 0; k < 3; k++) {
        this.add.spawn({ x: x1, y: y1, z: z1 - 0.2, vx: rnd(-5, 5), vy: rnd(-5, 5), size: 0.15, max: 0.2, r: 1, g: 0.85, b: 0.5, drag: 4 });
      }
      this.alpha.spawn({ x: x1, y: y1, z: z1 - 0.2, size: 0.5, grow: 1.5, max: 0.5, r: 0.7, g: 0.68, b: 0.62, a: 0.4 });
    }
  }

  blood(x: number, y: number): void {
    const g = groundAt(x, y);
    for (let k = 0; k < 4; k++) {
      this.alpha.spawn({ x, y, z: g + 0.9, vx: rnd(-3, 3), vy: rnd(-3, 3), size: 0.25, max: 0.35, r: 0.55, g: 0.02, b: 0.02, a: 0.9, drag: 5 });
    }
    this.decals.spawn({ x: x + rnd(-0.4, 0.4), y: y + rnd(-0.4, 0.4), z: g + 0.04, size: rnd(0.6, 1.3), max: 40, r: 0.35, g: 0.01, b: 0.01, a: 0.85, rot: rnd(0, 6) });
  }

  explosion(x: number, y: number, radius: number): void {
    const g = groundAt(x, y);
    const big = radius > 3;
    for (let k = 0; k < (big ? 26 : 8); k++) {
      const a = rnd(0, Math.PI * 2), s = rnd(2, big ? 14 : 5);
      this.add.spawn({ x, y, z: g + rnd(0.5, 2), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(0, 3), size: rnd(1.5, 3) * (big ? 1 : 0.6), grow: big ? 6 : 3,
        max: rnd(0.35, 0.7), r: 1, g: rnd(0.45, 0.75), b: 0.2, a: 1, drag: 3 });
    }
    for (let k = 0; k < (big ? 18 : 6); k++) {
      const a = rnd(0, Math.PI * 2), s = rnd(1, 6);
      this.alpha.spawn({ x, y, z: g + rnd(1, 4), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 2, size: rnd(2, 4), grow: 4, max: rnd(1.8, 3.2), r: 0.13, g: 0.12, b: 0.11, a: 0.75, drag: 1.2 });
    }
    this.add.spawn({ x, y, z: g + 1, size: radius * 3.5, max: 0.18, r: 1, g: 0.9, b: 0.7, a: 1 });
    if (big) this.decals.spawn({ x, y, z: g + 0.03, size: radius * 1.4, max: 60, r: 0.05, g: 0.05, b: 0.05, a: 0.75 });
    this.flash(x, y, g + 6, big ? 60 : 15, big ? 0.5 : 0.25);
  }

  splash(x: number, y: number): void {
    for (let k = 0; k < 10; k++) {
      const a = rnd(0, Math.PI * 2);
      this.alpha.spawn({ x, y, z: groundAt(x, y) + 0.3, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, size: 0.8, grow: 2, max: 0.8, r: 0.85, g: 0.92, b: 0.95, a: 0.7, drag: 2 });
    }
  }

  spark(x: number, y: number): void {
    for (let k = 0; k < 8; k++) {
      this.add.spawn({ x, y, z: groundAt(x, y) + 0.8, vx: rnd(-8, 8), vy: rnd(-8, 8), size: 0.18, max: 0.3, r: 1, g: 0.8, b: 0.4, drag: 3 });
    }
  }

  smoke(x: number, y: number, z: number, dark: number): void {
    const c = 0.55 - dark * 0.45;
    this.alpha.spawn({ x: x + rnd(-0.5, 0.5), y: y + rnd(-0.5, 0.5), z: groundAt(x, y) + z, vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6), vz: 2, size: rnd(0.7, 1.3), grow: 2.2, max: rnd(1.2, 2), r: c, g: c, b: c, a: 0.55, drag: 0.6 });
  }

  fire(x: number, y: number, r: number): void {
    this.add.spawn({ x: x + rnd(-r, r) * 0.6, y: y + rnd(-r, r) * 0.6, z: groundAt(x, y) + rnd(0.4, 1.5), vz: 2.5, vx: rnd(-0.5, 0.5), vy: rnd(-0.5, 0.5), size: rnd(0.8, 1.6) * Math.max(0.6, r / 2), grow: -0.6, max: rnd(0.35, 0.6), r: 1, g: rnd(0.4, 0.65), b: 0.12, a: 0.95 });
    if (Math.random() < 0.2) this.smoke(x, y, 2.5, 1);
  }

  /** A stretch of tyre mark on the road from one wheel position to the next: laid end to end they
   *  make an unbroken black streak that fades after a while. `k` (0..1) is how hard it slid. */
  skid(x0: number, y0: number, x1: number, y1: number, k: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.02) return;
    const w = 0.3;
    this.decals.spawn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: groundAt(x1, y1) + 0.025, size: w, stretch: (len + w * 0.6) / w, rot: Math.atan2(y1 - y0, x1 - x0),
      max: 22, r: 0.04, g: 0.04, b: 0.04, a: 0.35 + 0.3 * k });
  }

  /** White water churned up behind a boat's stern, spreading and fading on the surface; `k` (0..1)
   *  is how fast it's going, `w` the hull's width. */
  foam(x: number, y: number, k: number, w: number): void {
    for (let n = 0; n < 2; n++) {
      this.alpha.spawn({ x: x + rnd(-w, w) * 0.3, y: y + rnd(-w, w) * 0.3, z: 0.06, vx: rnd(-0.6, 0.6), vy: rnd(-0.6, 0.6),
        size: rnd(0.5, 0.9) * w * 0.5, grow: 1.2 + k, max: rnd(1.4, 2.4), r: 0.88, g: 0.93, b: 0.95, a: 0.35 + 0.3 * k, drag: 1.2 });
    }
  }

  /** Pale tyre smoke billowing off a sliding wheel; `k` (0..1) is how hard it slid. */
  tyreSmoke(x: number, y: number, k: number): void {
    const c = rnd(0.78, 0.88);
    this.alpha.spawn({ x: x + rnd(-0.3, 0.3), y: y + rnd(-0.3, 0.3), z: groundAt(x, y) + 0.35, vx: rnd(-0.8, 0.8), vy: rnd(-0.8, 0.8), vz: rnd(0.4, 1.1),
      size: rnd(0.6, 1.0), grow: 2.6, max: rnd(0.9, 1.6), r: c, g: c, b: c, a: 0.18 + 0.22 * k, drag: 1.4 });
  }

  muzzle(x: number, y: number): void {
    this.add.spawn({ x, y, z: groundAt(x, y) + 1.3, size: 1.2, max: 0.06, r: 1, g: 0.75, b: 0.35, a: 1 });
  }
}
