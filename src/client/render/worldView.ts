// Syncs interpolated entities to meshes each frame, plus per-entity effects and night glows.
import * as THREE from 'three';
import { type CharLook, VEHICLES, WEAPONS } from '../../shared/packs';
import { EK, PF, PK, VF } from '../../shared/protocol';
import { astride } from '../../shared/sim/kinds';
import { animateLegs } from './legs';
import { materialOf } from '../../shared/materials';
import type { EntityStore, ViewEntity } from '../net/entities';
import { floorOf, groundOf, isWayStrip } from '../../shared/world/levels';
import { heightAt } from '../../shared/world/ways';
import { groundAt } from '../../shared/world/terrain';
import { putCarLights } from './carLights';
import type { Effects } from './effects';
import { animatePed, HIP_H, makePed, muzzleOf, PED_S, type PedView, ridePed, setPedWeapon, SWING_TIME } from './pedMesh';
import { lampMaterial, makeVehicle, showDamage, sirenMats, type VehicleView } from './vehicleMesh';
import { decodeDamage } from './vehicleDamage';
import { Skids } from './skids';
import { floatBoat } from './boats';

export interface OwnState { pid: number; vid: number; x: number; y: number; angle: number; alt: number; driving: boolean; vx: number; vy: number; trailer?: number }
/** `me`: your own character (drawn in your colours and look, never with a name over it). */
export interface PlayerTag { name: string; color: string; look?: CharLook; me?: boolean }

/** Riders are drawn about 1.1x life, to sit a real-size bike or saddle, and people seated in a car
 *  0.9x, whatever size they're drawn on foot (WorldSpec.pedScale): scales on the ped model. */
const RIDER_SCALE = 1.085 / PED_S;
const SEAT_SCALE = 0.9 / PED_S;
const projGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.8, 6).rotateZ(Math.PI / 2);
const grenadeGeo = new THREE.SphereGeometry(0.16, 8, 6);
const pickupGeo = new THREE.BoxGeometry(0.7, 0.35, 0.45);
const darkMat = new THREE.MeshLambertMaterial({ color: '#2a2c2e' });
const crateGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1).translate(0, 0.55, 0);
const crateBand = new THREE.BoxGeometry(1.14, 0.25, 1.14).translate(0, 0.55, 0);
const crateDark = new THREE.MeshLambertMaterial({ color: '#1a1a1c' });
const crateRed = new THREE.MeshBasicMaterial({ color: '#e0201c' });
const cashMat = new THREE.MeshLambertMaterial({ color: '#3fae4a', emissive: '#0f3a12' });
const gunMat = new THREE.MeshLambertMaterial({ color: '#4a4e54', emissive: '#202428' });

export class WorldView {
  private peds = new Map<number, PedView>();
  private vehs = new Map<number, VehicleView>();
  private objs = new Map<number, THREE.Object3D>();
  private labels = new Map<number, THREE.Sprite>();
  private tagged = new Set<number>();
  private time = 0;
  /** Your floor (world/levels.ts); people on other upper floors aren't drawn. */
  private myF = 0;
  private store: EntityStore | null = null;

  /** A vehicle not drawn on the street (yours, while it's inside the paint shop). */
  hiddenVehicle = 0;

  /** Other players riding inside vehicles (not drawn: their ped's in the car), by vehicle id: their
   *  names float over the car instead. Set by the game each frame. */
  carTags = new Map<number, PlayerTag[]>();
  private carLabels = new Map<number, { key: string; sprite: THREE.Sprite }>();

  /** Names of the players inside a vehicle, stacked over it in their colours. */
  private carLabel(id: number, root: THREE.Object3D, height: number): void {
    const list = this.carTags.get(id);
    const have = this.carLabels.get(id);
    const key = list?.map((t) => `${t.name}:${t.color}`).join('|') ?? '';
    if (have && have.key !== key) { this.dropCarLabel(id); }
    if (!key) return;
    let l = this.carLabels.get(id);
    if (!l) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 48 * list!.length + 16;
      const ctx = c.getContext('2d')!;
      ctx.font = 'bold 34px Bahnschrift, Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      list!.forEach((t, i) => { ctx.strokeText(t.name, 128, 44 + i * 48); ctx.fillStyle = t.color; ctx.fillText(t.name, 128, 44 + i * 48); });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(8, 8 * c.height / 256, 1);
      sprite.renderOrder = 10;
      this.carLabels.set(id, l = { key, sprite });
    }
    if (l.sprite.parent !== root) root.add(l.sprite);
    l.sprite.position.set(0, height + 2.2 + l.sprite.scale.y / 2, 0);
  }

  private dropCarLabel(id: number): void {
    const l = this.carLabels.get(id);
    if (!l) return;
    l.sprite.removeFromParent();
    (l.sprite.material as THREE.SpriteMaterial).map?.dispose();
    l.sprite.material.dispose();
    this.carLabels.delete(id);
  }

  /** Tyre marks and smoke; `skids.squeal` is the hardest slide this frame, for the tyre sound. */
  readonly skids = new Skids();

  constructor(private scene: THREE.Scene, private fx: Effects, private lamps: { x: number; y: number; off?: boolean }[]) {}

  sync(store: EntityStore, dt: number, own: OwnState | null, tags: Map<number, PlayerTag>, night: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    this.time += dt;
    this.store = store;
    this.myF = own ? floorOf(own.x) : 0;
    this.skids.begin();
    const seen = new Set<number>();
    // Vehicles first, so riders (peds sent with a vehicle and a seat) find the bike they sit on.
    for (const e of store.all.values()) if (e.kind === EK.Veh) { seen.add(e.id); this.vehicle(e, dt, own, night); }
    for (const e of store.all.values()) {
      seen.add(e.id);
      switch (e.kind) {
        case EK.Ped: this.ped(e, dt, own, tags); break;
        case EK.Proj: this.projectile(e); break;
        case EK.Pickup: this.pickup(e); break;
        case EK.Fire: this.fireEnt(e, night); break;
      }
    }
    this.prune(seen);
    if (night > 0.05) this.lampGlows(night, view);
    this.fx.glow.update(dt);
    this.fx.beams.update(dt);
  }

  private prune(seen: Set<number>): void {
    for (const [id, v] of this.peds) if (!seen.has(id)) { v.root.removeFromParent(); this.peds.delete(id); this.dropTag(id); }
    for (const [id, v] of this.vehs) if (!seen.has(id)) { this.scene.remove(v.root); this.vehs.delete(id); this.dropCarLabel(id); }
    for (const [id, o] of this.objs) if (!seen.has(id)) { this.scene.remove(o); this.objs.delete(id); }
  }

  /** Is something on strip f drawn? The street and the railway's viaduct always; a building's upper floor
   *  only when it's yours. */
  private shows(f: number): boolean {
    return f === 0 || isWayStrip(f) || f === this.myF;
  }

  private dropTag(id: number): void {
    const l = this.labels.get(id);
    if (l) { l.removeFromParent(); (l.material as THREE.SpriteMaterial).map?.dispose(); l.material.dispose(); this.labels.delete(id); }
    this.tagged.delete(id);
  }

  private ped(e: ViewEntity, dt: number, own: OwnState | null, tags: Map<number, PlayerTag>): void {
    const d = e.data;
    const flags = d[6];
    const tag = tags.get(e.id);
    let v = this.peds.get(e.id);
    // A player's tag (colour, saved look) can arrive after their ped first shows: rebuild then.
    const want = tag ? `${tag.color}:${tag.look ? JSON.stringify(tag.look) : ''}` : '';
    if (v && v.lookKey !== want) { v.root.removeFromParent(); this.peds.delete(e.id); this.dropTag(e.id); v = undefined; }
    if (!v) {
      v = makePed(e.id, d[2], tag?.color ?? null, tag?.look);
      v.lookKey = want;
      this.peds.set(e.id, v);
      this.scene.add(v.root);
    }
    if (this.ride(e, v, tags)) return;
    if (v.root.parent !== this.scene) { this.scene.add(v.root); v.root.scale.setScalar(1); }
    const isMe = own && own.pid === e.id && !own.vid;
    const x = isMe ? own!.x : e.x, y = isMe ? own!.y : e.y, a = isMe ? own!.angle : e.angle;
    // Jump: a 0.5 s arc, started when the server says this ped is hopping.
    if (flags & PF.jump && v.hop <= 0) v.hop = 0.5;
    v.hop = Math.max(0, v.hop - dt);
    const lift = v.hop > 0 ? Math.sin(Math.PI * (1 - v.hop / 0.5)) * 0.9 : 0;
    // Upstairs (world/levels.ts): over the building, at the floor's height; on a train's viaduct,
    // over its corridor at the track's height.
    const g = groundOf(x, y);
    v.root.position.set(g.x, lift + heightAt(x, y), g.y);
    // Only your floor is drawn: people on another upper floor would float in mid-air.
    v.root.visible = this.shows(g.f);
    v.root.rotation.y = -a;
    setPedWeapon(v, d[7]);
    const speed = isMe ? Math.hypot(own!.vx, own!.vy) : Math.hypot(e.vx, e.vy);
    animatePed(v, dt, speed, !!(flags & PF.aim), !!(flags & PF.down), !!(flags & PF.dead), !!(flags & PF.busy), !!(flags & PF.hands));
    if (flags & PF.burning && Math.random() < 0.6) this.fx.fire(x, y, 0.8);
    if (tag && !this.tagged.has(e.id)) this.addTag(e.id, v, tag, !!isMe);
  }

  /** A rider (sent with the vehicle id and seat): sits on that bike's saddle, moving with it. People
   *  are drawn larger than life to read from the air; on a life-size bike they're scaled to fit. */
  private ride(e: ViewEntity, v: PedView, tags: Map<number, PlayerTag>): boolean {
    const d = e.data;
    const vid = d[8] ?? 0, seat = d[9] ?? 0;
    const bike = vid ? this.vehs.get(vid) : undefined;
    const veh = vid ? this.store?.all.get(vid) : undefined;
    const saddle = veh ? VEHICLES[veh.data[2]].saddles?.[seat] : undefined;
    if (!bike || !saddle) return false;
    if (v.root.parent !== bike.root) bike.root.add(v.root);
    // Sitting in a car (side by side, front and back) they need to be smaller to fit than astride a bike.
    const k = astride(VEHICLES[veh!.data[2]]) ? RIDER_SCALE : SEAT_SCALE;
    v.root.scale.setScalar(k);
    v.root.rotation.set(0, 0, 0);
    // The model's left side is local -z (Blender +y), so + y (the driver's right) is + z.
    v.root.position.set(saddle.x - k * HIP_H * Math.sin(saddle.lean), saddle.z - k * HIP_H * Math.cos(saddle.lean), saddle.y ?? 0);
    v.root.visible = bike.root.visible;
    setPedWeapon(v, d[7]);
    ridePed(v, saddle.lean, !!(d[6] & PF.aim));
    const tag = tags.get(e.id);
    if (tag && !this.tagged.has(e.id)) this.addTag(e.id, v, tag, false);
    return true;
  }

  /** Other players get a floating name in their colour (no ground markers). */
  private addTag(id: number, v: PedView, tag: PlayerTag, isMe: boolean): void {
    this.tagged.add(id);
    // Your own name never shows (alone in a game, no name tags at all), on foot or riding.
    if (isMe || tag.me) return;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 34px Bahnschrift, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(tag.name, 128, 44);
    ctx.fillStyle = tag.color;
    ctx.fillText(tag.name, 128, 44);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(8, 2, 1);
    s.position.set(0, 4.5, 0);
    s.renderOrder = 10;
    v.root.add(s);
    this.labels.set(id, s);
  }

  /** Where a ped's gun muzzle is drawn right now (game x, y and height), for shots to leave it. */
  muzzle(pid: number): { x: number; y: number; z: number } | null {
    const v = this.peds.get(pid);
    const m = v ? muzzleOf(v) : null;
    return m ? { x: m.x, y: m.z, z: m.y } : null;
  }

  /** A ped swung a melee weapon: their arm throws the blow. */
  swing(pid: number): void {
    const v = this.peds.get(pid);
    if (v) { v.swingT = SWING_TIME; v.swingSide = -(v.swingSide ?? 1); }
  }

  /** Dry ground at a point (set by the game from the city map): a boat there is under a bridge. */
  dryAt: (x: number, y: number) => boolean = () => false;

  private vehicle(e: ViewEntity, dt: number, own: OwnState | null, night: number): void {
    const d = e.data;
    const type = d[2], color = d[6], flags = d[7];
    const spec = VEHICLES[type];
    const wreck = !!(flags & VF.wreck);
    const { overall: dmg, sides } = decodeDamage(d[10] ?? 0);
    // A wreck has been through a fire and a blast: battered all round, whatever it was before.
    const dents = wreck ? sides.map((l) => Math.max(l, 2)) : sides;
    // What it's made of says how it looks hurt and done for (shared/materials.ts): a burnt-out car,
    // a horse lying in its own colours.
    const mat = materialOf(spec);
    const charred = wreck && !!mat.charred;
    const key = `${type}:${color}:${charred}`;
    let v = this.vehs.get(e.id);
    if (!v || v.key !== key) {
      if (v) this.scene.remove(v.root);
      v = makeVehicle(type, color, charred);
      // Mounts roll onto their side and rear in their own frame (heading first); others keep the default.
      if (mat.liesDown || spec.temper) v.root.rotation.order = 'YXZ';
      this.vehs.set(e.id, v);
      this.scene.add(v.root);
    }
    const mine = own && own.vid === e.id && own.driving;
    const rx = mine ? own!.x : e.x, ry = mine ? own!.y : e.y, a = mine ? own!.angle : e.angle;
    // On a train's viaduct (world/ways.ts): over its corridor at the track's height; out in the
    // hills (world/terrain.ts), on the slope and tilted with it.
    const g = groundOf(rx, ry), lift = heightAt(rx, ry);
    const x = g.x, y = g.y, alt = (mine ? own!.alt : e.alt) + lift;
    // Its height over the hillside under it (a viaduct still counts as up).
    const above = alt - groundAt(x, y);
    const cs = Math.cos(a) * 1.6, sn = Math.sin(a) * 1.6;
    const pitch = Math.atan2(heightAt(rx + cs, ry + sn) - heightAt(rx - cs, ry - sn), 3.2);
    // Down for good (a horse, not a wagon in harness): on its side.
    const down = wreck && !!mat.liesDown && !spec.trailer;
    // Spooked: up on its hind legs (nose up about its middle, lifted so the hind feet stay down).
    const rear = !down && !spec.trailer && flags & VF.rearing ? 0.55 : 0;
    v.rearing = (v.rearing ?? 0) + (rear - (v.rearing ?? 0)) * Math.min(1, dt * 10);
    v.root.position.set(x, alt + (down ? spec.width * 0.45 : 0) + Math.sin(v.rearing) * spec.length * 0.4, y);
    v.root.rotation.y = -a;
    v.root.rotation.z = pitch;
    if (mat.liesDown || spec.temper) {
      v.root.rotation.x = down ? Math.PI / 2 : 0;
      v.root.rotation.z = v.rearing + pitch;
    }
    if (spec.movement === 'boat') {
      floatBoat(v.root, this.fx, spec, this.time + e.id * 1.7, dt, x, y, a, mine ? own!.vx : e.vx, mine ? own!.vy : e.vy, wreck, this.dryAt(x, y));
    }
    v.root.visible = e.id !== this.hiddenVehicle && this.shows(g.f);
    if (mat.dents) showDamage(v, spec, e.id, dents);
    this.carLabel(e.id, v.root, spec.height);
    if (v.turret) v.turret.rotation.y = -(e.turret - e.angle);
    // Trailer swing relative to the cab: your own rig's is predicted with the cab; others' come
    // from the server, interpolated.
    const trailerAngle = mine && own!.trailer !== undefined ? own!.trailer : a + (e.trailer - e.angle);
    if (v.trailer) v.trailer.rotation.y = -(trailerAngle - a);
    const spinning = (flags & VF.driven) || above > 0.3;
    for (const r of v.rotors) r.rotation.y += dt * (spinning ? 32 : 0);
    for (const r of v.tailRotors) r.rotation.z += dt * (spinning ? 40 : 0);
    if (v.legs.length) animateLegs(v, VEHICLES[e.data[2]], e.x, e.y, dt, !!(flags & VF.lame));
    const sirenOn = !!(flags & VF.siren);
    const phase = Math.floor(this.time * 6) % 2;
    for (const s of v.sirens) {
      const blue = s.userData.blue as boolean;
      s.material = !sirenOn ? (blue ? sirenMats.blueDim : sirenMats.redDim) : (phase === (blue ? 1 : 0) ? (blue ? sirenMats.blue : sirenMats.red) : (blue ? sirenMats.blueDim : sirenMats.redDim));
    }
    const c = Math.cos(a), s = Math.sin(a);
    if (sirenOn) {
      const col = phase ? [0.2, 0.35, 1] : [1, 0.15, 0.1];
      this.fx.glow.put(x, y, alt - above + 0.1, 9 + night * 6, 1, 0, col[0], col[1], col[2], 0.18 + night * 0.25);
    }
    const lit = !!(flags & VF.lights) && !wreck;
    for (const m of v.lamps) m.material = lampMaterial(v, m, lit);
    putCarLights(this.fx.beams, this.fx.glow, spec, type, x, y, a, alt, above, trailerAngle, flags, night, dents);
    // Smoke from under the bonnet: a badly hurt vehicle, or a smashed front end (the engine's there).
    const steam = dmg >= 2 || dents[0] >= 2;
    if (mat.smokes && (flags & VF.smoke || steam) && !wreck && Math.random() < dt * (dents[0] >= 3 ? 12 : 8)) {
      this.fx.smoke(x + c * spec.length * 0.35, y + s * spec.length * 0.35, above + spec.height * 0.8, dmg >= 2 || dents[0] >= 3 ? 0.6 : 0.3);
    }
    if (flags & VF.burning) { this.fx.fire(x, y, spec.width); if (night > 0.1) this.fx.glow.put(x, y, alt - above + 0.1, 10, 1, 0, 1, 0.5, 0.15, 0.35 * night); }
    if (charred && Math.random() < dt * 3) this.fx.smoke(x, y, 1.5, 1);
    // Tyre marks and smoke when sliding.
    this.skids.update(this.fx, e.id, spec, x, y, a, mine ? own!.vx : e.vx, mine ? own!.vy : e.vy, above, dt, !!(flags & VF.burnout));
  }

  private projectile(e: ViewEntity): void {
    const spec = WEAPONS[e.data[2]];
    let o = this.objs.get(e.id);
    if (!o) {
      o = new THREE.Mesh(spec.projectile?.arc ? grenadeGeo : projGeo, darkMat);
      this.objs.set(e.id, o);
      this.scene.add(o);
    }
    const g = groundOf(e.x, e.y);
    o.position.set(g.x, Math.max(0.15, e.alt) + heightAt(e.x, e.y), g.y);
    o.visible = this.shows(g.f);
    o.rotation.y = -e.angle;
    if (!spec.projectile?.arc) {
      this.fx.alpha.spawn({ x: e.x, y: e.y, z: e.alt, size: 0.6, grow: 2.5, max: 1.2, r: 0.75, g: 0.75, b: 0.72, a: 0.5, drag: 1 });
      this.fx.add.spawn({ x: e.x, y: e.y, z: e.alt, size: 0.9, max: 0.05, r: 1, g: 0.7, b: 0.3 });
    } else if (spec.projectile.fire) this.fx.fire(e.x, e.y, 0.3);
  }

  private pickup(e: ViewEntity): void {
    let o = this.objs.get(e.id);
    const type = e.data[2];
    if (type === PK.frenzy) { this.crate(e, o); return; }
    if (!o) {
      o = new THREE.Mesh(pickupGeo, type === PK.cash ? cashMat : gunMat);
      this.objs.set(e.id, o);
      this.scene.add(o);
    }
    const g = groundOf(e.x, e.y);
    o.position.set(g.x, 0.6 + Math.sin(this.time * 3 + e.id) * 0.15 + heightAt(e.x, e.y), g.y);
    o.visible = this.shows(g.f);
    o.rotation.y = this.time * 2 + e.id;
    const col = type === PK.cash ? [0.3, 1, 0.4] : [1, 0.85, 0.4];
    this.fx.glow.put(e.x, e.y, 0.07, 2.4, 1, 0, col[0], col[1], col[2], 0.35);
  }

  /** Kill-frenzy crate: red and black, slowly turning, with a pulsing red glow. */
  private crate(e: ViewEntity, existing: THREE.Object3D | undefined): void {
    let o = existing;
    if (!o) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(crateGeo, crateDark);
      body.castShadow = true;
      const band1 = new THREE.Mesh(crateBand, crateRed);
      const band2 = new THREE.Mesh(crateBand, crateRed);
      band2.rotation.y = Math.PI / 2;
      g.add(body, band1, band2);
      o = g;
      this.objs.set(e.id, o);
      this.scene.add(o);
    }
    o.position.set(e.x, 0.15 + Math.sin(this.time * 2.5) * 0.15, e.y);
    o.rotation.y = this.time * 0.8;
    const pulse = 0.35 + 0.25 * Math.sin(this.time * 5);
    this.fx.glow.put(e.x, e.y, 0.08, 5, 1, 0, 1, 0.1, 0.05, pulse);
  }

  private fireEnt(e: ViewEntity, night: number): void {
    const r = e.data[4];
    if (Math.random() < 0.9) this.fx.fire(e.x, e.y, r);
    if (Math.random() < 0.5) this.fx.fire(e.x, e.y, r);
    this.fx.glow.put(e.x, e.y, 0.09, r * 4, 1, 0, 1, 0.45, 0.1, 0.25 + night * 0.3);
  }

  private lampGlows(night: number, v: { x0: number; y0: number; x1: number; y1: number }): void {
    for (const l of this.lamps) {
      if (l.off || l.x < v.x0 || l.x > v.x1 || l.y < v.y0 || l.y > v.y1) continue;
      this.fx.glow.put(l.x, l.y, 0.06, 18, 1, 0, 1, 0.78, 0.45, 0.28 * night);
      this.fx.glow.put(l.x, l.y, 6.6, 1.2, 1, 0, 1, 0.9, 0.7, 0.9 * night);
    }
  }
}
