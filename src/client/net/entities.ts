// Client entity store: snapshot buffers and interpolation at a delayed render time.
import { lerp, lerpAngle } from '../../shared/math';
import { EK, INTERP_DELAY_MS } from '../../shared/protocol';

export interface Sample { t: number; d: number[] }

export interface ViewEntity {
  id: number;
  kind: number;
  samples: Sample[];
  // Interpolated state (filled by Interp.update)
  x: number; y: number; angle: number; alt: number; turret: number; trailer: number;
  vx: number; vy: number;
  data: number[];            // latest raw data
  seen: number;              // snapshot serial when last present
}

export class EntityStore {
  readonly all = new Map<number, ViewEntity>();
  private serial = 0;
  private offset = 0;        // serverTime - clientTime (ms)
  private offsetInit = false;
  renderTime = 0;

  ingest(st: number, list: number[][], kept: number[]): void {
    const now = performance.now();
    const off = st - now;
    if (!this.offsetInit) { this.offset = off; this.offsetInit = true; }
    // Track the fastest-arriving snapshot (smallest delay) with slow upward drift.
    else this.offset = off > this.offset ? this.offset + (off - this.offset) * 0.1 : this.offset + (off - this.offset) * 0.02;
    this.serial++;
    for (const d of list) {
      const id = d[0];
      let e = this.all.get(id);
      if (!e || e.kind !== d[1]) {
        e = { id, kind: d[1], samples: [], x: 0, y: 0, angle: 0, alt: 0, turret: 0, trailer: 0, vx: 0, vy: 0, data: d, seen: 0 };
        this.all.set(id, e);
      }
      e.data = d;
      e.seen = this.serial;
      e.samples.push({ t: st, d });
      if (e.samples.length > 4) e.samples.shift();
    }
    // Unchanged entities: repeat their last state at this timestamp.
    for (const id of kept) {
      const e = this.all.get(id);
      if (!e) continue;
      e.seen = this.serial;
      e.samples.push({ t: st, d: e.data });
      if (e.samples.length > 4) e.samples.shift();
    }
    for (const [id, e] of this.all) if (e.seen !== this.serial) this.all.delete(id);
  }

  serverNow(): number {
    return performance.now() + this.offset;
  }

  update(): void {
    const rt = this.serverNow() - INTERP_DELAY_MS;
    this.renderTime = rt;
    for (const e of this.all.values()) interpolate(e, rt);
  }
}

/** Index of x/y/angle fields per entity kind. */
const LAYOUT: Record<number, { x: number; y: number; a: number; alt?: number; turret?: number; trailer?: number }> = {
  [EK.Ped]: { x: 3, y: 4, a: 5 },
  [EK.Veh]: { x: 3, y: 4, a: 5, alt: 8, turret: 9, trailer: 11 },
  [EK.Proj]: { x: 3, y: 4, a: 5, alt: 6 },
  [EK.Pickup]: { x: 3, y: 4, a: -1 },
  [EK.Fire]: { x: 2, y: 3, a: -1 },
};

function interpolate(e: ViewEntity, rt: number): void {
  const L = LAYOUT[e.kind];
  const s = e.samples;
  let a = s[0], b = s[0];
  for (let i = 0; i < s.length; i++) {
    if (s[i].t <= rt) a = s[i];
    if (s[i].t >= rt) { b = s[i]; break; }
    b = s[i];
  }
  const span = b.t - a.t;
  let t = span > 0 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
  // Between the street and a viaduct's strip (or a lift's floors: world/levels.ts) there's no
  // in-between: take one side or the other.
  if (Math.abs(b.d[L.x] - a.d[L.x]) > 1000) t = t < 0.5 ? 0 : 1;
  const ox = e.x, oy = e.y;
  e.x = lerp(a.d[L.x], b.d[L.x], t);
  e.y = lerp(a.d[L.y], b.d[L.y], t);
  if (L.a >= 0) e.angle = lerpAngle(a.d[L.a], b.d[L.a], t);
  if (L.alt !== undefined) e.alt = lerp(a.d[L.alt], b.d[L.alt], t);
  if (L.turret !== undefined) e.turret = lerpAngle(a.d[L.turret], b.d[L.turret], t);
  if (L.trailer !== undefined) e.trailer = lerpAngle(a.d[L.trailer] ?? a.d[L.a], b.d[L.trailer] ?? b.d[L.a], t);
  if (span > 0 && Math.abs(b.d[L.x] - a.d[L.x]) > 1000) {
    // Keep the speed it had (the jump between strips isn't motion).
  } else if (span > 0) {
    e.vx = (b.d[L.x] - a.d[L.x]) / (span / 1000);
    e.vy = (b.d[L.y] - a.d[L.y]) / (span / 1000);
  } else if (ox || oy) {
    e.vx *= 0.9; e.vy *= 0.9;
  }
}
