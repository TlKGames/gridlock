// Vehicle lights at night: a beam thrown on the road ahead of each headlamp, the lamps themselves
// glowing, red tail lights that flare when braking and white reversing lights. Lamp positions come
// from the model's headlight / taillight parts, so every vehicle lights up where its lamps are.
import * as THREE from 'three';
import { VEHICLES, type Part, type VehicleSpec } from '../../shared/packs';
import { VF } from '../../shared/protocol';
import { hitchOffset } from '../../shared/sim/physics';
import { groundAt } from '../../shared/world/terrain';
import type { ParticleLayer } from './particles';

/** Beam on the ground: narrow at the lamp, spreading and fading out ahead (u = along, v = across). */
let beamTex: THREE.Texture | null = null;
export function beamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const W = 128, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < W; i++) {
    const u = i / (W - 1);
    const half = 0.14 + 0.86 * Math.pow(u, 0.75);
    const along = smooth(0, 0.05, u) * Math.pow(1 - u, 1.5);
    for (let j = 0; j < H; j++) {
      const v = Math.abs((j / (H - 1)) * 2 - 1);
      const a = along * (1 - smooth(half * 0.45, half, v));
      const k = (j * W + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}

interface Lamp { x: number; y: number; z: number }
interface Lamps { head: Lamp[]; tail: Lamp[]; trailerTail: Lamp[] }

const lampsOf = (model: Part[], tag: Part['tag'], L: number, W: number, H: number): Lamp[] =>
  model.filter((p) => p.tag === tag).map((p) => ({ x: ((p.x[0] + p.x[1]) / 2) * L, y: ((p.y[0] + p.y[1]) / 2) * W, z: p.z[1] * H }));

const cache = new Map<number, Lamps>();
function lamps(type: number): Lamps {
  let l = cache.get(type);
  if (l) return l;
  const s = VEHICLES[type];
  const t = s.trailer;
  l = {
    head: lampsOf(s.model, 'headlight', s.length, s.width, s.height),
    tail: t ? [] : lampsOf(s.model, 'taillight', s.length, s.width, s.height),
    trailerTail: t ? lampsOf(t.model, 'taillight', t.length, t.width, t.height) : [],
  };
  cache.set(type, l);
  return l;
}

const BEAM_LEN = 15;
const BEAM_W = 6.5;

/** A smashed end loses its lamps: at level 2 the one on the more battered side, at 3 all of them. */
function working(lampList: Lamp[], level: number, left: number, right: number): Lamp[] {
  if (level >= 3) return [];
  if (level < 2) return lampList;
  return lampList.filter((p) => (left >= right ? p.y >= 0 : p.y <= 0));
}

/** Puts this frame's lights for one vehicle. `night` is 0 (day) to 1; `trailer` is the trailer's
 *  heading for rigs; `dents` the dent level of each side (front, rear, left, right). Nothing is
 *  drawn unless the vehicle has its lights on. `alt` is its height in the scene, `above` its height
 *  over the hillside under it (world/terrain.ts), where the beams fall. */
export function putCarLights(beams: ParticleLayer, glow: ParticleLayer, spec: VehicleSpec, type: number,
  x: number, y: number, a: number, alt: number, above: number, trailer: number, flags: number, night: number, dents: number[]): void {
  if (!(flags & VF.lights) || flags & VF.wreck) return;
  // Lights come on at dusk, faint against the last of the daylight, full strength once it's dark.
  const k = 0.25 + 0.75 * night;
  const c = Math.cos(a), s = Math.sin(a);
  const l = lamps(type);
  const ground = above < 0.5; // aircraft don't throw beams on the road
  for (const h of working(l.head, dents[0], dents[2], dents[3])) {
    const lx = x + c * h.x - s * h.y, ly = y + s * h.x + c * h.y;
    glow.put(lx, ly, alt + h.z + 0.05, 1.1, 1, 0, 1, 0.96, 0.85, 0.85 * k);
    if (!ground) continue;
    // Toed out a touch, like real low beams.
    const toe = a + Math.sign(h.y) * 0.07;
    const tc = Math.cos(toe), ts = Math.sin(toe);
    const bx = lx + tc * (BEAM_LEN / 2), by = ly + ts * (BEAM_LEN / 2);
    beams.put(bx, by, groundAt(bx, by) + 0.07, BEAM_W, BEAM_LEN / BEAM_W, toe, 1, 0.93, 0.78, 0.5 * k);
  }
  // Tail lights: on the cab, or on the back of a rig's trailer.
  const brake = !!(flags & VF.brake), reverse = !!(flags & VF.reverse);
  let rear = working(l.tail, dents[1], dents[2], dents[3]), rx = x, ry = y, ra = a;
  if (spec.trailer && l.trailerTail.length) {
    const hx = x - c * hitchOffset(spec), hy = y - s * hitchOffset(spec);
    rear = l.trailerTail; ra = trailer;
    rx = hx - Math.cos(trailer) * (spec.trailer.length / 2); ry = hy - Math.sin(trailer) * (spec.trailer.length / 2);
  }
  const rc = Math.cos(ra), rs = Math.sin(ra);
  for (const t of rear) {
    const tx = rx + rc * t.x - rs * t.y, ty = ry + rs * t.x + rc * t.y;
    glow.put(tx, ty, alt + t.z + 0.05, brake ? 1.5 : 0.9, 1, 0, 1, 0.08, 0.04, (brake ? 0.95 : 0.45) * k);
  }
  if (rear.length && ground) {
    const back = Math.min(...rear.map((t) => t.x)) - 1.6;
    const px = rx + rc * back, py = ry + rs * back;
    glow.put(px, py, groundAt(px, py) + 0.07, 3.2, 1.5, ra + Math.PI / 2, 1, 0.1, 0.05, (brake ? 0.4 : 0.14) * k);
    if (reverse) glow.put(px - rc * 1.2, py - rs * 1.2, groundAt(px, py) + 0.07, 3.6, 1.3, ra + Math.PI / 2, 1, 1, 0.95, 0.3 * k);
  }
}
