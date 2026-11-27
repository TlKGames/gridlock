// Per-player snapshots with interest management.
import { r2 } from '../../../shared/math';
import { GANGS, RULES } from '../../../shared/packs';
import { flies } from '../../../shared/sim/kinds';
import { burningOut } from '../../../shared/sim/physics';
import { objectivePoint } from '../missions/kinds';
import { damageLevels } from '../combat/damage';
import { EK, FULL_SNAP_EVERY, FX, Mode, PF, type PlayerInfo, type S2C, VF, type YouState } from '../../../shared/protocol';
import type { Ped, Player, Vehicle } from '../entities';
import type { World } from '../world';
import { isLame } from './spook';
import { groundOf, isWayStrip, LEVEL_BAND } from '../../../shared/world/levels';

const a2 = (v: number) => Math.round(v * 100) / 100;

function pedFlags(p: Ped): number {
  let f = 0;
  if (p.dead) f |= PF.dead;
  if (Math.hypot(p.body.vx, p.body.vy) > 3) f |= PF.fast;
  if (p.trigger) f |= PF.aim;
  if (p.burning > 0) f |= PF.burning;
  if (p.down > 0) f |= PF.down;
  if (p.player) f |= PF.player;
  if (p.ai && (p.ai.task === 'revive' || p.ai.task === 'extinguish') && p.ai.workT > 0) f |= PF.busy;
  if (p.jumpT > 0) f |= PF.jump;
  if (p.ai?.task === 'surrender') f |= PF.hands;
  return f;
}

function vehFlags(w: World, v: Vehicle): number {
  let f = 0;
  if (v.siren) f |= VF.siren;
  if (v.wrecked) f |= VF.wreck;
  if (v.burning >= 0) f |= VF.burning;
  if (v.ctl.throttle < 0 || v.ctl.handbrake) f |= VF.brake;
  if (v.seats[0]) f |= VF.driven;
  if (!v.wrecked && v.hp < v.spec.hp * 0.35) f |= VF.smoke;
  const fwd = v.body.vx * Math.cos(v.body.angle) + v.body.vy * Math.sin(v.body.angle);
  if (fwd < -0.5) f |= VF.reverse;
  if (v.rearT > 0) f |= VF.rearing;
  if (v.seats[0] && burningOut(v.spec, v.ctl, Math.abs(fwd))) f |= VF.burnout;
  if (isLame(v)) f |= VF.lame;
  const hour = (w.gameMinutes / 60) % 24;
  // Lights on from dusk (5 pm, as the sky starts to go) until 7 am, whenever someone's driving.
  if (v.seats[0] && (hour >= 17 || hour < 7)) f |= VF.lights;
  return f;
}

export function buildSnapshot(w: World, pl: Player): S2C {
  const me = w.peds.get(pl.pid);
  const center = me ? w.pedPos(me) : { x: 1000, y: 1000 };
  // Upstairs (world/levels.ts) you also see the street round your building; on the street or a
  // train's viaduct, everything on the street and the viaduct round you (it's drawn over it).
  const below = groundOf(center.x, center.y);
  const R = RULES.interestRadius;
  const R2 = R * R;
  const e: number[][] = [];
  const open = below.f === 0 || isWayStrip(below.f);
  const near = (x: number, y: number, r2 = R2) => {
    if ((x - center.x) ** 2 + (y - center.y) ** 2 < r2) return true;
    if (x < LEVEL_BAND) return below.f > 0 && (x - below.x) ** 2 + (y - below.y) ** 2 < r2;
    const g = groundOf(x, y);
    return open && isWayStrip(g.f) && (g.x - below.x) ** 2 + (g.y - below.y) ** 2 < r2;
  };

  const addPed = (p: Ped) => {
    if (p.vehicle || !near(p.body.x, p.body.y)) return;
    const h = p.weapons[p.wi];
    e.push([p.id, EK.Ped, p.arch, r2(p.body.x), r2(p.body.y), a2(p.body.angle), pedFlags(p), h ? h.w : -1]);
  };
  w.pedHash.query(center.x, center.y, R, addPed);
  if (below.f > 0) w.pedHash.query(below.x, below.y, R, addPed);
  if (open) for (const way of w.city.ways) if (way.strip !== below.f) w.pedHash.query(below.x + way.strip * LEVEL_BAND, below.y, R, addPed);
  for (const v of w.vehicles.values()) {
    const air = flies(v.spec) && v.body.alt > 3;
    if (!near(v.body.x, v.body.y, air ? R2 * 1.7 : R2)) continue;
    // Overall state in the low 2 bits, then each side's dent level (front, rear, left, right), 2 bits each.
    const overall = v.wrecked ? 3 : v.hp < v.spec.hp * 0.35 ? 2 : v.hp < v.spec.hp * 0.7 ? 1 : 0;
    const dmg = damageLevels(v).reduce((acc, l, i) => acc | (l << (2 + i * 2)), overall);
    e.push([v.id, EK.Veh, v.type, r2(v.body.x), r2(v.body.y), a2(v.body.angle), v.color, vehFlags(w, v), a2(v.body.alt), a2(v.turret), dmg, v.spec.trailer ? a2(v.trailer) : 0]);
    // Riders sit in plain sight (bikes, open-top cars): sent as peds carrying the vehicle and the seat they're on.
    const saddles = v.spec.saddles;
    if (saddles) {
      v.seats.forEach((pid, seat) => {
        const p = pid && seat < saddles.length ? w.peds.get(pid) : undefined;
        if (!p) return;
        const h = p.weapons[p.wi];
        e.push([p.id, EK.Ped, p.arch, r2(v.body.x), r2(v.body.y), a2(v.body.angle), pedFlags(p), h ? h.w : -1, v.id, seat]);
      });
    }
  }
  for (const pr of w.projectiles.values()) {
    if (near(pr.x, pr.y)) e.push([pr.id, EK.Proj, pr.weapon, r2(pr.x), r2(pr.y), a2(pr.angle), a2(pr.z)]);
  }
  for (const pk of w.pickups.values()) {
    if (near(pk.x, pk.y)) e.push([pk.id, EK.Pickup, pk.type, r2(pk.x), r2(pk.y), pk.weapon]);
  }
  for (const f of w.fires.values()) {
    if (near(f.x, f.y)) e.push([f.id, EK.Fire, r2(f.x), r2(f.y), a2(f.r)]);
  }
  const fx = w.fx.filter((ev) => ID_EVENTS.has(ev[0]) || near(ev[1], ev[2], R2 * 1.3));
  const { changed, kept } = delta(pl, e);
  return { t: 's', st: Math.round(w.time * 1000), ack: pl.ack, gt: Math.round(w.gameMinutes * 10) / 10, you: youState(w, pl, me), e: changed, k: kept, fx };
}

/** Splits entities into changed (sent in full) and unchanged (sent as ids only). */
function delta(pl: Player, all: number[][]): { changed: number[][]; kept: number[] } {
  const full = pl.snapCount++ % FULL_SNAP_EVERY === 0;
  const next = new Map<number, string>();
  const changed: number[][] = [], kept: number[] = [];
  for (const d of all) {
    const key = d.join(',');
    next.set(d[0], key);
    if (!full && pl.sent.get(d[0]) === key) kept.push(d[0]);
    else changed.push(d);
  }
  pl.sent = next;
  return { changed, kept };
}

/** Events keyed by entity id are sent to everyone; the client ignores ids it doesn't know. */
const ID_EVENTS = new Set<number>([FX.Swing, FX.Horn, FX.Throw]);

function youState(w: World, pl: Player, p: Ped | undefined): YouState {
  const v = p?.vehicle ? w.vehicles.get(p.vehicle) : undefined;
  const b = v && p!.seat === 0 ? v.body : p?.body;
  return {
    pid: pl.pid, vid: v?.id ?? 0,
    mode: pl.mode === Mode.Foot && v ? (p!.seat === 0 ? Mode.Driver : Mode.Passenger) : pl.mode,
    // [x, y, angle, vx, vy, av, alt, trailer angle] — the trailer for client prediction of rigs.
    body: b ? [b.x, b.y, b.angle, b.vx, b.vy, b.av, b.alt, v && p!.seat === 0 && v.spec.trailer ? v.trailer : b.angle] : [0, 0, 0, 0, 0, 0, 0, 0],
    hp: Math.ceil(p?.hp ?? 0), ar: Math.ceil(p?.armor ?? 0), cash: pl.cash, bank: pl.bank, wl: pl.wanted, heat: Math.round(pl.heat),
    w: p ? p.weapons.map((h) => [h.w, h.ammo, h.clip]) : [], wi: p?.wi ?? 0, rl: p ? a2(p.reloadT) : 0,
    vt: v ? v.type : -1, vhp: v ? Math.max(0, Math.round((v.hp / v.spec.hp) * 100) / 100) : 0,
    // A blown mount reads 0 (no gallop, as the server will have it); otherwise never quite 0.
    ml: v ? (v.rearT > 0 ? VF.rearing : 0) | (isLame(v) ? VF.lame : 0) : 0,
    st: v?.spec.stamina ? (v.blown ? 0 : Math.max(0.01, Math.round((v.stamina / v.spec.stamina.gallop) * 100) / 100)) : -1,
    respawn: Math.max(0, a2(pl.respawnT)),
    rs: GANGS.map((g) => Math.round(pl.respect[g] ?? 0)),
    mt: objectiveOf(w, pl),
  };
}

function objectiveOf(w: World, pl: Player): number[] | null {
  if (!pl.mission) return null;
  const p = objectivePoint(w, pl.mission);
  return p ? [r2(p.x), r2(p.y)] : null;
}

export function playerList(w: World): PlayerInfo[] {
  return [...w.players.values()].map((pl) => {
    const p = w.peds.get(pl.pid);
    // Where on the map (players upstairs show at their building).
    const pos = p ? groundOf(w.pedPos(p).x, w.pedPos(p).y) : { x: 0, y: 0 };
    return { id: pl.id, name: pl.name, color: pl.color, pid: pl.pid, x: r2(pos.x), y: r2(pos.y), cash: pl.cash, felonies: Object.values(pl.felonies).reduce((a, n) => a + n, 0), deaths: pl.deaths, wl: pl.wanted, ping: pl.ping, frags: pl.frags, earned: pl.earned, itS: Math.round(pl.itTime), ...(pl.look ? { look: pl.look } : {}),
      vid: p?.vehicle ?? 0, ...(pl.waypoint ? { wp: pl.waypoint } : {}) };
  });
}
