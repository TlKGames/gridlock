// Boats in the water: the hull sits down to its waterline and rocks gently (a wreck lists, low in
// the water), a foaming wake streams off the stern when it's going.
import type * as THREE from 'three';
import type { VehicleSpec } from '../../shared/packs';
import type { Effects } from './effects';

/** `t`: this boat's own clock (seconds, offset per boat so they don't rock in step). */
export function floatBoat(root: THREE.Object3D, fx: Effects, spec: VehicleSpec, t: number, dt: number,
  x: number, y: number, a: number, vx: number, vy: number, wreck: boolean): void {
  root.position.y = -spec.height * (wreck ? 0.5 : 0.22) + Math.sin(t * 1.6) * 0.05;
  root.rotation.x = Math.sin(t * 1.1) * 0.025 + (wreck ? 0.12 : 0);
  root.rotation.z = Math.sin(t * 0.9 + 1) * 0.02;
  const speed = Math.hypot(vx, vy);
  if (speed < 2.5 || Math.random() > dt * (10 + speed * 1.5)) return;
  const c = Math.cos(a), s = Math.sin(a), back = spec.length * 0.5;
  fx.foam(x - c * back, y - s * back, Math.min(1, speed / 20), spec.width);
}
