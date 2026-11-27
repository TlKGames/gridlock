// Split an impact into closing speed and slip along the contact surface. Friction
// is limited by the normal impulse, so a slight scrape cannot stop a fast vehicle.
import { clamp } from '../math';
import type { Body } from './physics';

export function contactImpulse(vx: number, vy: number, nx: number, ny: number, boat: boolean) {
  const closing = Math.max(0, -(vx * nx + vy * ny));
  const normal = closing * (1 + (boat ? 0.19 : 0.14));
  const limit = normal * (boat ? 0.035 : 0.32);
  const slip = clamp(-vy * nx + vx * ny, -limit, limit);
  return { closing, x: normal * nx - slip * ny, y: normal * ny + slip * nx };
}

/** An oblique hit turns the leading end away. End-on and broadside hits stay square. */
export function impactYaw(angle: number, nx: number, ny: number, speed: number, length: number): number {
  const c = Math.cos(angle), s = Math.sin(angle);
  return clamp(-(c * nx + s * ny) * (c * ny - s * nx) * speed / length, -1.5, 1.5);
}

export function rebound(b: Body, nx: number, ny: number, length: number, boat: boolean): number {
  const impulse = contactImpulse(b.vx, b.vy, nx, ny, boat);
  b.vx += impulse.x; b.vy += impulse.y;
  b.av += impactYaw(b.angle, nx, ny, impulse.closing, length);
  return impulse.closing;
}
