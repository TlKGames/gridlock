// Headless checks of car handling through the shared physics on open ground: the controls map as
// they always have (W gas, S brake / reverse, A/D steer, pad triggers and stick); the handbrake
// slides the car so a handbrake 180 works and you drive off the way you came; tyre marks, smoke and
// squeal (render/skids.ts) come from hard slides, slamming the brakes or very fast sharp turns,
// never from an ordinary corner. `npx tsx scripts/drive.ts`
import { Steering } from '../src/client/game/steering';
import type { Input } from '../src/client/game/input';
import type { Effects } from '../src/client/render/effects';
import { Skids } from '../src/client/render/skids';
import { angleDiff } from '../src/shared/math';
import { RULES, VEHICLES, vehicleIndex } from '../src/shared/packs';
import { Mode, type YouState } from '../src/shared/protocol';
import { type Body, burningOut, type Controls, stepVehicle, wearOf } from '../src/shared/sim/physics';
import type { StaticWorld } from '../src/shared/world/collision';
import { blockBy, obbVsObb } from '../src/shared/sim/dynamic';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const DT = 1 / 30, DEG = Math.PI / 180;
const open = { resolveObb: () => null, gradeAt: () => 0, cliff: () => null } as unknown as StaticWorld; // open level ground, nothing to hit
const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2;

/** A stand-in for the real input: held actions (by id), the pad's sticks and triggers. */
function fake(keys: string[], pad: Partial<Input['pad']> = {}, mouseAt: number | null = null): Input {
  return {
    pad: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, ...pad },
    triggerFires: false, aimingNow: false, facingHint: 0, fireBlocked: false,
    held: (a: string) => keys.includes(a),
    axis: (neg: string, pos: string) => (keys.includes(pos) ? 1 : 0) - (keys.includes(neg) ? 1 : 0),
    mouseAim: () => null,
    mouseDirection: () => mouseAt,
  } as unknown as Input;
}

const car = vehicleIndex('sedan'), spec = VEHICLES[car];
const ctl = (o: Partial<Controls> = {}): Controls => ({ mx: 0, my: 0, throttle: 0, steer: 0, handbrake: false, sprint: false, up: false, down: false, ...o } as Controls);
const at = (angle: number, speed = 0): Body => ({ x: 0, y: 0, angle, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, av: 0, alt: 0 });
const along = (b: Body, dir: number) => b.vx * Math.cos(dir) + b.vy * Math.sin(dir);

// The controls, exactly as before.
const st = new Steering();
const out = (input: Input) => st.step(input, { mode: Mode.Driver, vt: car, body: [0, 0, 0, 0, 0, 0, 0, 0] } as unknown as YouState, 0, DT, { x: 0, y: 0 }, () => null);
let o = out(fake(['gas', 'steerRight']));
check(o.throttle === 1 && o.steer === 1, 'W is gas, D steers right');
o = out(fake(['brake', 'steerLeft']));
check(o.throttle === -1 && o.steer === -1, 'S brakes / reverses, A steers left');
o = out(fake([], { rt: 0.6, lt: 0.2, lx: -0.4 }));
check(Math.abs(o.throttle - 0.4) < 1e-9 && Math.abs(o.steer + 0.4) < 1e-9, 'pad: RT - LT, the left stick steers');

// Shooting from a car: the mouse aims without holding Aim; out of the windows, never behind you.
{
  const near = (a: number, b: number) => Math.abs(angleDiff(a, b)) < 1e-6;
  const ride = (vt: number, mouseAt: number) => {
    const input = fake(['fire'], {}, mouseAt);
    const r = new Steering().step(input, { mode: Mode.Driver, vt, body: [0, 0, 0, 0, 0, 0, 0, 0] } as unknown as YouState, 0, DT, { x: 0, y: 0 }, () => null);
    return { aim: r.aim, blocked: input.fireBlocked };
  };
  const side = ride(car, Math.PI / 2), ahead = ride(car, 0.3), back = ride(car, Math.PI);
  check(near(side.aim, Math.PI / 2) && !side.blocked && near(ahead.aim, 0.3), 'in a car the mouse aims out of the window, no Aim needed');
  check(back.blocked && Math.abs(back.aim) <= RULES.windowArc + 1e-6, 'pointing behind a closed car: no shot (the trigger does nothing)');
  const bike = vehicleIndex('streetbike');
  const over = ride(bike, 2.4);
  check(!over.blocked && near(over.aim, 2.4) && ride(bike, Math.PI).blocked, 'riding open (a bike) you can twist round further, still not straight back');
}

// Handbrake 180: at speed, hold the handbrake and steer; it slides round to face back the way it
// came, and let go with the gas on it drives off that way.
for (const speed of [12, 20, 28]) {
  const b = at(NORTH, speed);
  let t = 0;
  while (t < 3 && Math.abs(angleDiff(b.angle, SOUTH)) > 15 * DEG) { stepVehicle(b, spec, ctl({ steer: 1, handbrake: true }), DT, open, true); t += DT; }
  const spun = t < 3, wide = Math.abs(b.x);
  for (let i = 0; i < 60; i++) stepVehicle(b, spec, ctl({ throttle: 1 }), DT, open, true);
  check(spun && along(b, SOUTH) > 4, `handbrake 180 from ${speed} m/s: round in ${t.toFixed(1)} s, ${wide.toFixed(1)} m sideways, then drives off south at ${along(b, SOUTH).toFixed(1)} m/s`);
}
// Straight on the handbrake: it locks up and stops hard (no spin), squealing all the way.
{
  const b = at(NORTH, 20);
  let t = 0;
  while (t < 3 && Math.hypot(b.vx, b.vy) > 0.5) { stepVehicle(b, spec, ctl({ handbrake: true }), DT, open, true); t += DT; }
  check(Math.abs(angleDiff(b.angle, NORTH)) < 2 * DEG && t < 1.3, `handbrake straight from 20 m/s: stops hard in ${t.toFixed(2)} s, no spin`);
}
// Without the handbrake a car corners on its tyres as before: full lock doesn't spin it round.
{
  const b = at(NORTH, 15);
  for (let i = 0; i < 30; i++) stepVehicle(b, spec, ctl({ throttle: 0.5, steer: 1 }), DT, open, true);
  const slip = Math.abs(-b.vx * Math.sin(b.angle) + b.vy * Math.cos(b.angle));
  check(slip < 1, `no handbrake: the tyres hold (sideways slip ${slip.toFixed(2)} m/s)`);
}

// Other cars in the way (client prediction, shared/sim/dynamic.ts): you stop at them, not in them.
{
  const parked = { x: 8, y: 0, angle: Math.PI / 2, hl: spec.length / 2, hw: spec.width / 2 };
  const b = at(0, 15);
  let overlap = 0;
  for (let i = 0; i < 40; i++) {
    stepVehicle(b, spec, ctl({ throttle: 1 }), DT, open, true);
    blockBy(b, { hl: spec.length / 2, hw: spec.width / 2 }, [parked]);
    overlap = Math.max(overlap, obbVsObb({ x: b.x, y: b.y, angle: b.angle, hl: spec.length / 2, hw: spec.width / 2 }, parked)?.depth ?? 0);
  }
  check(overlap < 0.01 && b.x < 8, `driving into a parked car: you stop against it (x ${b.x.toFixed(2)}), never inside it`);
  const ped = { x: 8 - 3, y: 0, angle: 0, vx: 0, vy: 0, av: 0, alt: 0 };
  for (let i = 0; i < 40; i++) { ped.x += 4 * DT; blockBy(ped, { r: 0.35 }, [parked]); }
  check(ped.x < 8 - spec.width / 2 - 0.3, `walking into it: you stop at its side (x ${ped.x.toFixed(2)})`);
  // Getting into a car: the car you're in is never in its own way (it doesn't lurch off).
  const mine = { x: 30, y: 0, angle: 0, vx: 0, vy: 0, av: 0, alt: 0 };
  blockBy(mine, { hl: spec.length / 2, hw: spec.width / 2 }, [{ x: 30, y: 0, angle: 0, hl: spec.length / 2, hw: spec.width / 2, id: 7 }], 7);
  check(mine.x === 30 && mine.y === 0, 'the car you get into stays put (not pushed out of itself)');
}

// A beaten-up car drives worse: less top speed, and it pulls to one side with the wheel straight.
{
  const top = (health: number) => {
    const b = at(NORTH, 0);
    for (let i = 0; i < 30 * 12; i++) stepVehicle(b, spec, ctl({ throttle: 1 }), DT, open, true, undefined, wearOf(health, 1));
    return { speed: Math.hypot(b.vx, b.vy), drift: Math.abs(angleDiff(b.angle, NORTH)) };
  };
  const fine = top(1), dented = top(0.6), wreck = top(0.1);
  check(fine.speed === top(0.9).speed && fine.drift < 1e-6, `healthy (and only lightly hurt) it drives as ever (${fine.speed.toFixed(1)} m/s)`);
  check(dented.speed < fine.speed && wreck.speed < dented.speed && wreck.speed > fine.speed * 0.5, `hurt, slower: ${dented.speed.toFixed(1)} at 60% health, ${wreck.speed.toFixed(1)} at 10%`);
  check(wreck.drift > 0.3, `badly hurt, it pulls off line with the wheel straight (${(wreck.drift / DEG).toFixed(0)}° in 12 s)`);
}

// Tyre marks: counted with a stand-in for the effects.
let marks = 0, smoke = 0;
const fx = { skid: () => { marks++; }, tyreSmoke: () => { smoke++; } } as unknown as Effects;
function run(b: Body, c: (i: number) => Controls, frames: number): { marks: number; smoke: number; squeal: number } {
  const sk = new Skids();
  marks = 0; smoke = 0;
  let squeal = 0;
  for (let i = 0; i < frames; i++) {
    stepVehicle(b, spec, c(i), DT, open, true);
    sk.begin();
    sk.update(fx, 1, spec, b.x, b.y, b.angle, b.vx, b.vy, 0, DT);
    squeal = Math.max(squeal, sk.squeal.k);
  }
  return { marks, smoke, squeal };
}
let r = run(at(NORTH, 20), () => ctl({ steer: 1, handbrake: true }), 30);
check(r.marks > 6 && r.smoke > 0 && r.squeal > 0.3, `a handbrake slide marks the road (${r.marks}), smokes (${r.smoke}) and squeals (${r.squeal.toFixed(2)})`);
r = run(at(NORTH, 20), () => ctl({ handbrake: true }), 20);
check(r.marks > 0 && r.squeal > 0.2, `the handbrake straight on marks the road (${r.marks}) and squeals (${r.squeal.toFixed(2)})`);
r = run(at(NORTH, 25), () => ctl({ throttle: -1 }), 30);
check(r.marks > 0, `slamming the brakes marks the road (${r.marks})`);
r = run(at(NORTH, 20), () => ctl(), 60);
check(r.marks === 0 && r.squeal === 0, 'driving straight: nothing');
r = run(at(NORTH, 12), (i) => ctl({ throttle: i < 40 ? 0.3 : -0.4, steer: 0.4 }), 60);
check(r.marks === 0 && r.squeal === 0, 'turning a bit at town speed, easing off the brakes: nothing');
{
  // A full-lock corner at about 10 m/s (a junction turn), the gas just holding the speed.
  const b = at(NORTH, 10);
  r = run(b, () => ctl({ throttle: Math.hypot(b.vx, b.vy) < 10 ? 0.6 : 0, steer: 1 }), 45);
  check(r.marks === 0 && r.squeal === 0, `a full-lock junction turn at 10 m/s: nothing (${r.marks})`);
}
r = run(at(NORTH, 30), () => ctl({ throttle: 1, steer: 1 }), 30);
check(r.marks > 0, `a full-lock turn at 30 m/s marks the road (${r.marks})`);

// Burnout: gas and handbrake at a standstill; it stays put (steering, it spins round), and let go of
// the handbrake, it launches.
{
  const spec = VEHICLES[vehicleIndex('muscle')];
  const b = at(NORTH, 0);
  const x0 = b.x, y0 = b.y;
  for (let i = 0; i < 60; i++) stepVehicle(b, spec, ctl({ throttle: 1, handbrake: true }), DT, open, true);
  check(Math.hypot(b.x - x0, b.y - y0) < 2.5 && burningOut(spec, ctl({ throttle: 1, handbrake: true }), Math.abs(b.vx * Math.cos(b.angle) + b.vy * Math.sin(b.angle))), `gas and handbrake: a burnout, the car creeps ${Math.hypot(b.x - x0, b.y - y0).toFixed(1)} m in 2 s`);
  const a0 = b.angle;
  for (let i = 0; i < 60; i++) stepVehicle(b, spec, ctl({ throttle: 1, handbrake: true, steer: 1 }), DT, open, true);
  check(Math.abs(b.angle - a0) > Math.PI && Math.hypot(b.x - x0, b.y - y0) < 8, `steering through it, a donut: it swings ${(Math.abs(b.angle - a0) / DEG).toFixed(0)}° round in 2 s, staying within ${Math.hypot(b.x - x0, b.y - y0).toFixed(1)} m`);
  for (let i = 0; i < 30; i++) stepVehicle(b, spec, ctl({ throttle: 1 }), DT, open, true);
  check(Math.hypot(b.vx, b.vy) > 4, `let go of the handbrake: it launches (${Math.hypot(b.vx, b.vy).toFixed(1)} m/s after 1 s)`);
}

console.log(failures ? `${failures} check(s) failed` : 'all driving checks passed');
process.exit(failures ? 1 : 0);
