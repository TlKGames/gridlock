// Runtime entity records for the server simulation.
import type { CharLook, PedArchetype, VehicleSpec } from '../../shared/packs';
import type { InputMsg, Mode } from '../../shared/protocol';
import type { Body, Controls } from '../../shared/sim/physics';

export interface HeldWeapon { w: number; ammo: number; clip: number }

export type TaskName = 'wander' | 'stand' | 'flee' | 'attack' | 'arrest' | 'drive' | 'pursue' | 'respond'
  | 'revive' | 'extinguish' | 'return' | 'cower' | 'guard' | 'surrender' | 'chat' | 'none';

export interface DriveState {
  merging?: boolean;
  curbBlocker?: number;
  borrowedLane?: boolean;
  junctionWait?: number;
  pts: { x: number; y: number; stop?: number; lanes?: number; axis?: 'h' | 'v' }[];
  seg: number; dir: 1 | -1; lane: number;
  route: number[];          // node ids remaining (route mode)
  routeT: number;
  stuckT: number;
  reverseT: number;
  honkT: number;
  blockT: number;           // time spent blocked by something ahead
  passing: number;          // id of the stationary obstacle being passed
  bypassT: number;          // > 0 while steering around a blockage
  yieldT: number;           // > 0 while pulled over for a siren (counts down once it's gone)
  pullT: number;            // how long we've been pulling over (ease to the kerb, then stop)
  why: string;              // what limited speed this tick (diagnostics)
}

export interface Ai {
  task: TaskName;
  t: number;                // time spent in task
  think: number;            // countdown to next perception tick
  target: number;           // entity id
  tx: number; ty: number;   // goal point
  block: number; corner: number; cdir: 1 | -1; crossing: 'none' | 'waiting' | 'walking';
  drive: DriveState | null;
  post: { x: number; y: number; angle: number } | null;
  squad: number;            // dispatch squad id, 0 none
  crew: number;             // vehicle this ped crews (cops, medics), 0 none
  panicT: number;
  enemy: number;            // ped id this ped holds a grudge against
  enemyT: number;
  workT: number;
}

export interface Ped {
  id: number;
  kind: 'ped';
  arch: number;
  spec: PedArchetype;
  faction: string;
  body: Body;
  ctl: Controls;
  hp: number; armor: number;
  dead: boolean; deadT: number;
  down: number;             // knocked-down timer
  /** Reeling from a blow (s): can't act, slides with the knock (shorter than being floored). */
  stagger?: number;
  /** The last few blows this ped landed: on whom and when, for a combo that floors them. */
  combo?: { target: number; hits: number; t: number };
  burning: number;          // seconds left on fire
  weapons: HeldWeapon[];
  wi: number;
  fireCd: number; reloadT: number;
  trigger: boolean; triggerPrev: boolean;
  /** Players: aiming on purpose this tick (BTN.aim), as a hold-up needs. */
  aimHeld?: boolean;
  commute?: import('./ai/commute').Destination;
  collectingVin?: string;
  arrivedAt?: number;
  npcName?: string;
  resident?: import('./census').Resident;
  aim: number;
  cash: number;
  vehicle: number; seat: number;
  player: Player | null;
  ai: Ai | null;
  lastHitBy: number; lastHitT: number;
  persistent: boolean;
  revived: boolean;
  swimT: number;
  jumpT: number;            // seconds left in a hop (GTA2 jump)
}

export interface Vehicle {
  vin: string;
  authorizedDriver?: number;
  departureBay?: number;
  parkingTarget?: { x: number; y: number; angle: number; lot: number };
  id: number;
  kind: 'veh';
  type: number;
  spec: VehicleSpec;
  body: Body;
  ctl: Controls;
  color: number;
  hp: number;
  burning: number;          // -1 not burning, else seconds on fire
  wrecked: boolean; wreckT: number;
  seats: number[];          // ped ids, 0 = empty; seat 0 drives
  siren: boolean;
  turret: number;           // absolute angle
  fireCd: number;
  vw: number;               // selected vehicle weapon
  owner: number;            // player id for garage cars
  persistent: boolean;
  sinkT: number;
  idleT: number;
  spot: number;             // parking/fixed spot key that spawned it, -1 none
  stolenBy: number;         // player id who stole it (for chop shop)
  horn: boolean;
  /** Its radio's station once someone riding in it retunes it (-1 off); until then the station
   *  it came tuned to (picked on the client from its id). */
  radio?: number;
  trailer: number;         // articulated trailer heading (semis), else = body angle
  /** A mount's wind: seconds of gallop it has left (spec.stamina); `blown` once it ran out, until
   *  it has back enough (systems/mounts.ts) to gallop again. */
  stamina: number;
  blown: boolean;
  /** A mount called by this player (their id) is coming to them (systems/mounts.ts); 0 = not. */
  calledBy: number;
  /** Spooked (systems/mounts.ts): seconds left rearing, then bolting away from (boltX, boltY). */
  rearT: number;
  boltT: number;
  boltX: number;
  boltY: number;
  /** Damage taken on each side (front, rear, left, right), in hit points: what the model shows as
   *  dents, broken lamps and glass (combat/damage.ts damageLevels). */
  dents: number[];
}

export interface Projectile {
  id: number;
  kind: 'proj';
  weapon: number;
  owner: number;            // ped id
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  angle: number;
  life: number;
  fuse: number;
}

export interface Pickup {
  id: number;
  kind: 'pickup';
  type: number;             // PK.*
  x: number; y: number;
  value: number;            // cash amount or ammo
  weapon: number;
  life: number;
}

export interface Fire {
  id: number;
  kind: 'fire';
  x: number; y: number; r: number;
  life: number;
  owner: number;
}

export interface Player {
  ownerKey: string;
  id: number;
  name: string;
  color: string;
  pid: number;              // avatar ped id
  mode: Mode;
  queue: InputMsg[];
  last: InputMsg;
  ack: number;
  cash: number;
  /** Banked money: kept through death and arrest; purchases use it after cash. */
  bank: number;
  deaths: number;
  /** Felony record: crime kind → times committed (saved with the character). */
  felonies: Record<string, number>;
  /** Crime kind → world time before it can be recorded again. */
  felonyCd: Record<string, number>;
  heat: number; wanted: number; seenT: number; lethal: boolean;
  respawnT: number;
  garage: number[];
  owned: number[];
  garageCar: number;        // vehicle id spawned from garage
  ping: number;
  send: (msg: unknown) => void;
  sendRaw: (data: string) => void;
  spawnCdT: number;
  bustT: number;
  lastPlace: number;
  gunCrimeT: number;
  seenCheckT: number;
  /** Last entity state sent to this player (id -> serialized), for delta snapshots. */
  sent: Map<number, string>;
  snapCount: number;
  respect: Record<string, number>;
  /** Callers who've introduced themselves (packs/calls.ts; saved with the character). */
  met: Set<string>;
  /** Their map waypoint, shared with whoever rides with them. */
  waypoint?: [number, number] | null;
  /** The vehicle they were last told the radio of (radio sync, room.ts). */
  radioVid?: number;
  mission: MissionState | null;
  boothCd: Map<number, number>;   // booth id -> world time it may ring again
  /** Face to face (systems/faceTalk.ts): when you can talk to someone again, and each gang's wait
   *  before its people have work for you again. */
  talkT?: number;
  talkCd?: Map<string, number>;
  /** Jobs blown in a row (a pass resets it): the mentor stops dealing with you past a point. */
  blownRun: number;
  /** Cell phone (missions/cell.ts): when the next call comes, who's ringing and until when, each
   *  contact's wait before it has work again, the gangs whose number you've been texted, when the
   *  welcome call comes, when the mentor next nudges, and the people list last sent. */
  cell: { next: number; ringing: string; ringEnds: number; dialCd: Record<string, number>; known: Set<string>; introAt: number; nudgeAt: number; people: string };
  frags: number;                  // player kills this round
  earned: number;                 // cash earned this round
  itTime: number;                 // seconds spent "it" this round (tag)
  /** The mount (vehicle id) this player last rode, which comes when they whistle; when they may
   *  whistle again (systems/mounts.ts). */
  mount?: number;
  callT?: number;
  /** Character being played (absent for guests); its progress is sent back to the browser. */
  character?: { id: string };
  look?: CharLook;
}

export interface MissionState {
  spec: number;                   // MISSIONS index
  giver: string;
  rival: string;
  stage: number;
  ends: number;                   // world time (s), 0 = no limit
  targets: number[];              // spawned entity ids (cleaned up afterwards)
  focus: number;                  // entity the objective follows, 0 = fixed point
  point: { x: number; y: number } | null;
  dest: { x: number; y: number } | null;
  kills: number;
  reward: number;
  place: string;
  name: string;
  weapon: number;                 // weapon index handed out for the job, -1 none
  sentKey: string;                // last objective/progress sent to the client
}

export interface Squad {
  id: number;
  player: number;           // target player id
  key: string;              // which wanted-level squad slot it fills
  vehicle: number;
  members: number[];
  incident?: { target: number; x: number; y: number; expires: number };
}

export type Entity = Ped | Vehicle | Projectile | Pickup | Fire;
