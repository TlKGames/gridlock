// Box-built pedestrians with walk / aim / down / dead poses, coloured from the archetype look.
// Body (torso, belt, head, hair/hat), each limb (with hand/shoe) are merged vertex-coloured meshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HAIRSTYLES } from '../../shared/packs/hairstyles';
import { hash32 } from '../../shared/math';
import { CHARACTER_LOOKS, type CharLook, HAIR, PEDS, SHOES, WEAPONS } from '../../shared/packs';
import { WORLD } from '../../shared/world/worldSpec';
import { weaponGlb } from './models';
import { weaponModel } from './weaponMesh';

/** How large people are drawn against life (WorldSpec.pedScale; larger than life so they read from
 *  the air). The world is installed before any render code loads. */
const S = WORLD.pedScale ?? 1.55;
/** A ped model's own scale, for anything sizing a ped relative to life (riders, seats). */
export const PED_S = S;

function cbox(w: number, h: number, d: number, x: number, y: number, z: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w * S, h * S, d * S).translate(x * S, y * S, z * S).toNonIndexed();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = mergeGeometries(make())!; geoCache.set(key, g); }
  return g;
}

const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
/** Where the hand grips the weapon, by how it's held (in body space; x forward, z to the right),
 *  and its pitch: armed peds hold the right arm out front, so pistols sit in that hand and long guns
 *  reach back to the shoulder; melee weapons and throwables hang at the side, pointing down a little. */
const HOLD: Record<string, { at: [number, number, number]; pitch: number }> = {
  one: { at: [0.56, 1.47, 0.34], pitch: 0 },
  two: { at: [0.5, 1.42, 0.3], pitch: 0 },
  heavy: { at: [0.42, 1.3, 0.3], pitch: 0 },
  fist: { at: [0.04, 0.92, 0.34], pitch: -0.7 },
  throw: { at: [0.04, 0.92, 0.34], pitch: 0 },
};

export interface PedView {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Mesh; legR: THREE.Mesh;
  armL: THREE.Mesh; armR: THREE.Mesh;
  /** Holds the weapon model in the hand (empty when unarmed). */
  gun: THREE.Group;
  /** On the back: a weapon's pack (the flamethrower's fuel tanks), when it has one. */
  pack: THREE.Group;
  weapon: number;
  phase: number;
  deadT: number;
  hop: number;              // seconds left in a jump arc
  lookKey?: string;         // what the look was built from (players rebuild when it changes)
  /** The held weapon's muzzle in the gun's own space (setPedWeapon), where shots leave it. */
  muzzle?: THREE.Vector3 | null;
  /** Throwing a melee blow: seconds left of it, and which arm (fists alternate). */
  swingT?: number;
  swingSide?: number;
}

/** How long a melee blow's arm movement takes (s). */
export const SWING_TIME = 0.24;

interface Colours { skin: string; top: string; bottom: string; hat: string | null; hair: string; shoes: string; style: number }

/** Archetype peds pick from their look by id; saved characters use their chosen look. */
function colours(id: number, arch: number, playerColor: string | null, chosen?: CharLook): Colours {
  const look = PEDS[arch].look;
  const h = hash32(id);
  const pick = (arr: string[], salt: number) => arr[(hash32(h + salt) >>> 0) % arr.length];
  const shoes = pick(SHOES, 7);
  if (chosen) {
    const L = CHARACTER_LOOKS;
    return { skin: L.skin[chosen.skin], top: L.top[chosen.top], bottom: L.bottom[chosen.bottom], hat: L.hat[chosen.hat] || null, hair: L.hair[chosen.hair], shoes, style: chosen.hairStyle };
  }
  return {
    skin: pick(look.skin, 1), top: playerColor ?? pick(look.top, 2), bottom: pick(look.bottom, 3),
    hat: look.hat && (hash32(h + 4) % 100) / 100 < (look.hatChance ?? 0) ? pick(look.hat, 5) : null,
    hair: pick(HAIR, 6), shoes, style: hash32(h + 8) % 3 === 0 ? 1 : 0,
  };
}

export function makePed(id: number, arch: number, playerColor: string | null, chosen?: CharLook): PedView {
  const look = PEDS[arch].look;
  const h = hash32(id);
  const { skin, top, bottom, hat, hair, shoes, style } = colours(id, arch, playerColor, chosen);
  const bodyGeo = cached(`b:${skin}:${top}:${bottom}:${hat}:${hair}:${style}`, () => {
    const parts = [
      cbox(0.3, 0.26, 0.54, 0, 1.38, 0, top),          // chest / shoulders
      cbox(0.27, 0.38, 0.44, 0, 1.06, 0, top),         // waist
      cbox(0.29, 0.07, 0.46, 0, 0.86, 0, '#2a2622'),   // belt
      cbox(0.28, 0.12, 0.44, 0, 0.84, 0, bottom),      // hips
      cbox(0.11, 0.08, 0.13, 0, 1.55, 0, skin),        // neck
      cbox(0.25, 0.27, 0.23, 0.01, 1.72, 0, skin),     // head
      cbox(0.011, 0.027, 0.032, 0.138, 1.745, -0.056, '#29221f'),
      cbox(0.011, 0.027, 0.032, 0.138, 1.745, 0.056, '#29221f'),
      cbox(0.038, 0.043, 0.033, 0.149, 1.705, 0, skin),
      cbox(0.011, 0.012, 0.052, 0.138, 1.66, 0, new THREE.Color(skin).multiplyScalar(0.48).getStyle()),
    ];
    if (hat) parts.push(cbox(0.3, 0.09, 0.27, 0, 1.88, 0, hat), cbox(0.12, 0.03, 0.25, 0.17, 1.84, 0, hat));
    else for (const piece of HAIRSTYLES[style].pieces) parts.push(cbox(...piece, hair));
    return parts;
  });
  const legGeo = cached(`l:${bottom}:${shoes}`, () => [cbox(0.17, 0.78, 0.17, 0, -0.39, 0, bottom), cbox(0.25, 0.09, 0.16, 0.04, -0.82, 0, shoes)]);
  const armGeo = cached(`a:${top}:${skin}`, () => [cbox(0.13, 0.5, 0.13, 0, -0.25, 0, top), cbox(0.11, 0.13, 0.11, 0, -0.56, 0, skin)]);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mesh = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    body.add(m);
    return m;
  };
  mesh(bodyGeo);
  const legL = mesh(legGeo), legR = mesh(legGeo);
  legL.position.set(0, 0.86 * S, -0.11 * S); legR.position.set(0, 0.86 * S, 0.11 * S);
  const armL = mesh(armGeo), armR = mesh(armGeo);
  armL.position.set(0, 1.47 * S, -0.34 * S); armR.position.set(0, 1.47 * S, 0.34 * S);
  const gun = new THREE.Group();
  gun.visible = false;
  body.add(gun);
  // The pack's frame sits against the back of the chest, its tanks from the belt to the shoulders.
  const pack = new THREE.Group();
  pack.position.set(-0.28 * S, 0.86 * S, 0);
  pack.scale.setScalar(S);
  body.add(pack);
  const build = look.build ?? 1;
  body.scale.set(build, 1, build);
  return { root, body, legL, legR, armL, armR, gun, pack, weapon: -1, phase: (h % 100) / 16, deadT: 0, hop: 0 };
}

export function setPedWeapon(v: PedView, wi: number): void {
  if (v.weapon === wi) return;
  v.weapon = wi;
  const spec = wi >= 0 ? WEAPONS[wi] : null;
  v.gun.clear();
  v.pack.clear();
  if (spec && weaponGlb(`${spec.id}_pack`)) v.pack.add(weaponModel(`${spec.id}_pack`, []));
  v.gun.visible = !!spec?.model && spec.size > 0;
  if (!spec?.model || !v.gun.visible) return;
  // The ped is drawn larger than life (S), so its weapon is too.
  const hold = HOLD[spec.kind === 'melee' ? 'fist' : spec.hold] ?? HOLD.one;
  const model = weaponModel(spec.id, spec.model);
  v.gun.add(model);
  v.gun.position.set(hold.at[0] * S, hold.at[1] * S, hold.at[2] * S);
  v.gun.rotation.z = hold.pitch;
  v.gun.scale.setScalar(S);
  // The muzzle: the model's front tip (it points along +x), where shots leave it.
  const box = new THREE.Box3();
  model.traverse((o) => { if ((o as THREE.Mesh).geometry) { const g = (o as THREE.Mesh).geometry; g.computeBoundingBox(); box.union(g.boundingBox!); } });
  v.muzzle = box.isEmpty() ? null : new THREE.Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
}

/** Where a ped's held weapon's muzzle is in the world right now (the scene's x, height, y), or
 *  null when they hold nothing drawn. */
export function muzzleOf(v: PedView): THREE.Vector3 | null {
  if (!v.muzzle || !v.gun.visible || !v.root.visible) return null;
  v.root.updateMatrixWorld(true);
  return v.gun.localToWorld(v.muzzle.clone());
}

/** Hip height in the ped's own space (legs hang from here). */
export const HIP_H = 0.86 * S;

/** Seated astride a bike: leaning forward by `lean`, knees up to the pegs, hands on the bars (or the
 *  right arm out when shooting). The caller places the root so the hips land on the saddle. */
export function ridePed(v: PedView, lean: number, aiming: boolean): void {
  const b = v.body;
  v.deadT = 0;
  b.position.y = 0;
  b.rotation.z = -lean;
  v.legL.rotation.z = v.legR.rotation.z = 1.3 + lean * 0.6;
  v.legL.rotation.x = -0.12; v.legR.rotation.x = 0.12;
  v.armL.rotation.z = 1.0 + lean * 0.8;
  v.armL.rotation.x = 0.25;
  v.armR.rotation.z = aiming || (v.gun.visible && v.weapon >= 0 && WEAPONS[v.weapon].kind !== 'melee') ? Math.PI / 2 + lean : 1.0 + lean * 0.8;
}

/** Poses the ped for this frame. speed in m/s. */
export function animatePed(v: PedView, dt: number, speed: number, aiming: boolean, down: boolean, dead: boolean, busy: boolean, hands = false): void {
  const b = v.body;
  if (dead || down) {
    v.deadT = Math.min(1, v.deadT + dt * 5);
    b.rotation.z = -Math.PI / 2 * v.deadT;
    b.position.y = 0.3 * v.deadT;
    v.legL.rotation.z = v.legR.rotation.z = 0;
    v.armL.rotation.z = 0.5; v.armR.rotation.z = -0.3;
    return;
  }
  v.deadT = 0;
  b.rotation.z = 0;
  b.rotation.y = 0; // (a blow twists the body: see blow())
  b.position.y = busy ? -0.55 : 0;
  v.legL.rotation.x = v.legR.rotation.x = 0;
  v.phase += dt * Math.min(speed, 8) * 2.1;
  const swing = Math.min(1, speed / 2) * 0.7;
  const s = Math.sin(v.phase) * swing;
  v.legL.rotation.z = s; v.legR.rotation.z = -s;
  const armed = v.gun.visible && v.weapon >= 0 && WEAPONS[v.weapon].kind !== 'melee';
  const twoHanded = armed && (WEAPONS[v.weapon].hold === 'two' || WEAPONS[v.weapon].hold === 'heavy');
  if (hands) {
    // Held up: both hands raised, a little forward and apart.
    v.armL.rotation.z = v.armR.rotation.z = 2.75;
    v.armL.rotation.x = -0.25; v.armR.rotation.x = 0.25;
  } else if (aiming || armed) {
    v.armR.rotation.z = Math.PI / 2;
    v.armL.rotation.z = twoHanded ? Math.PI / 2.3 : -s;
    v.armL.rotation.x = twoHanded ? 0.5 : 0;
  } else {
    v.armL.rotation.z = -s; v.armR.rotation.z = s;
    v.armL.rotation.x = 0;
  }
  if (!hands) v.armR.rotation.x = 0;
  if (v.swingT && v.swingT > 0) blow(v, dt);
}

/** A melee blow: a straight jab out and back (fists, alternating arms; knives and machetes from
 *  the weapon hand), or a two-handed sweep across the body (a bat). */
function blow(v: PedView, dt: number): void {
  v.swingT = Math.max(0, (v.swingT ?? 0) - dt);
  const u = 1 - v.swingT / SWING_TIME, out = Math.sin(Math.PI * u);
  const hold = v.weapon >= 0 ? WEAPONS[v.weapon].hold : 'fist';
  if (hold === 'two') {
    // Wind up behind, sweep through to the front.
    v.armL.rotation.z = v.armR.rotation.z = Math.PI / 2.2;
    v.armL.rotation.x = v.armR.rotation.x = 1.2 - 2.4 * u;
    v.body.rotation.y = 0.5 - u;
    return;
  }
  const arm = hold === 'fist' && (v.swingSide ?? 1) < 0 ? v.armL : v.armR;
  arm.rotation.z = (Math.PI / 2) * (0.35 + 0.65 * out);
  v.body.rotation.y = (arm === v.armL ? 0.25 : -0.25) * out;
}
