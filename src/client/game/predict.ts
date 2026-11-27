// Client-side prediction of the local avatar (on foot or driving) with server reconciliation.
import { PEDS, PLAYER_ARCHETYPE, VEHICLES } from '../../shared/packs';
import { BTN, type InputMsg, Mode, VF, type YouState } from '../../shared/protocol';
import { type Body, type Controls, copyBody, DT, emptyControls, newBody, PED_RADIUS, SPRINT, stepFoot, stepTrailer, stepVehicle, wearOf } from '../../shared/sim/physics';
import { blockBy, type Obb } from '../../shared/sim/dynamic';
import { flies, floats } from '../../shared/sim/kinds';
import type { StreetPropsView } from '../render/breakables';
import type { CityMap } from '../../shared/world/city';
import type { StaticWorld } from '../../shared/world/collision';

interface Pending { seq: number; inp: InputMsg }

export class Predictor {
  readonly body: Body = newBody(0, 0);
  readonly prev: Body = newBody(0, 0);
  private pending: Pending[] = [];
  private mode: Mode = Mode.Foot;
  private vtype = -1;
  /** The vehicle you're in (never an obstacle to itself). */
  private vid = 0;
  private ctl: Controls = emptyControls();
  active = false;
  /** Predicted trailer heading (rigs), now and at the previous tick for interpolation. */
  trailer = 0;
  prevTrailer = 0;
  /** Visual error offset that decays after corrections. */
  errX = 0;
  errY = 0;

  /** Other vehicles where they're drawn (set by the game each tick): the predicted car or ped stops
   *  at them instead of running into them until the server pulls it back out. */
  obstacles: Obb[] = [];
  /** Street props (render/breakables.ts): your car knocks them over at once, or stops at them when
   *  too slow, the same way the server does. */
  furniture: StreetPropsView | null = null;

  /** How beaten up your vehicle is (from the server), so the prediction drives it as the server does. */
  private wear = wearOf(1, 0);
  /** Your mount's wind from the server (0..1; -1: not on a mount). */
  private wind = -1;
  /** Your mount's state from the server (VF.rearing | VF.lame). */
  private mount = 0;

  private onRoad: (x: number, y: number) => boolean;

  constructor(private world: StaticWorld, private map: CityMap) {
    this.onRoad = (x, y) => map.onRoad(x, y);
  }

  private step(inp: InputMsg): void {
    const [, mx, my, throttle, steer, , btn] = inp;
    const c = this.ctl;
    c.mx = mx; c.my = my; c.throttle = throttle; c.steer = steer;
    c.handbrake = (btn & BTN.handbrake) !== 0;
    // On a mount, Sprint gallops only while it has the wind (the server's word, you.st).
    c.sprint = (btn & BTN.sprint) !== 0 && (this.mode !== Mode.Driver || this.wind !== 0);
    // Your horse rearing won't go; lame, it won't go faster than a trot (as the server holds it).
    if (this.mode === Mode.Driver && this.mount & VF.rearing) { c.throttle = 0; c.steer = 0; c.sprint = false; }
    if (this.mode === Mode.Driver && this.mount & VF.lame) { c.throttle = Math.min(c.throttle, 0.7); c.sprint = false; }
    c.up = (btn & BTN.up) !== 0;
    c.down = (btn & BTN.down) !== 0;
    const b = this.body;
    if (this.mode === Mode.Driver && this.vtype >= 0) {
      const spec = VEHICLES[this.vtype];
      stepVehicle(b, spec, c, DT, this.world, true, this.onRoad, this.wear);
      blockBy(b, { hl: spec.length / 2, hw: spec.width / 2 }, this.obstacles, this.vid);
      const f = this.furniture;
      if (f && !floats(spec) && !(flies(spec) && b.alt > 1)) {
        f.props.meet(b, spec.length / 2, spec.width / 2, (i) => f.standing(i), (i, a) => f.knock(i, a));
      }
      // A rig's trailer is predicted with the cab, so it answers the steering without lag.
      this.trailer = spec.trailer ? stepTrailer(b, spec, this.trailer, DT) : b.angle;
    } else {
      const ox = b.x, oy = b.y;
      stepFoot(b, c, PEDS[PLAYER_ARCHETYPE].runSpeed * (c.sprint ? SPRINT : 1), DT, this.world);
      blockBy(b, { r: PED_RADIUS }, this.obstacles);
      if (this.map.isWater(b.x, b.y) && !this.map.isWater(ox, oy)) { b.x = ox; b.y = oy; b.vx = 0; b.vy = 0; }
    }
  }

  /** Runs one local tick with this input. */
  apply(inp: InputMsg): void {
    if (!this.active) return;
    copyBody(this.prev, this.body);
    this.prevTrailer = this.trailer;
    this.pending.push({ seq: inp[0], inp });
    if (this.pending.length > 90) this.pending.shift();
    this.step(inp);
  }

  reconcile(you: YouState, ack: number): void {
    const predictable = you.mode === Mode.Foot || you.mode === Mode.Driver;
    const changed = you.mode !== this.mode || you.vt !== this.vtype || !this.active;
    this.mode = you.mode;
    this.vtype = you.vt;
    this.vid = you.vid;
    this.wear = wearOf(you.vhp, you.vid);
    this.wind = you.st;
    this.mount = you.ml;
    if (!predictable) { this.active = false; this.pending.length = 0; return; }
    const [x, y, angle, vx, vy, av, alt, trailer] = you.body;
    const beforeX = this.body.x, beforeY = this.body.y;
    const b = this.body;
    b.x = x; b.y = y; b.angle = angle; b.vx = vx; b.vy = vy; b.av = av; b.alt = alt;
    this.trailer = trailer ?? angle;
    this.pending = this.pending.filter((p) => p.seq > ack);
    for (const p of this.pending) this.step(p.inp);
    if (changed) {
      this.active = true;
      copyBody(this.prev, b);
      this.prevTrailer = this.trailer;
      this.errX = 0; this.errY = 0;
      return;
    }
    const ex = beforeX - b.x, ey = beforeY - b.y;
    if (Math.hypot(ex, ey) > 6) { this.errX = 0; this.errY = 0; copyBody(this.prev, b); return; }
    this.errX += ex; this.errY += ey;
    this.prev.x -= ex; this.prev.y -= ey;
  }

  decay(dt: number): void {
    const k = Math.exp(-dt * 10);
    this.errX *= k; this.errY *= k;
  }
}
