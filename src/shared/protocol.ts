// Wire protocol (JSON over WebSocket). Hot-path messages use compact arrays.
import type { CharacterProgress, CharacterSave, CharLook } from './packs/characters';

export const TICK_HZ = 30;
export const SNAP_EVERY = 2;             // snapshots at 15 Hz
export const INTERP_DELAY_MS = 120;
export const PROTOCOL_VERSION = 25;
/** Every Nth snapshot carries every entity in full (others list unchanged ones in `k`). */
export const FULL_SNAP_EVERY = 30;

// Input buttons (bitmask).
export const BTN = {
  fire: 1, handbrake: 2, sprint: 4, up: 8, down: 16,
  enter: 32, interact: 64, reload: 128, next: 256, prev: 512, horn: 1024, jump: 2048,
  aim: 4096, // deliberately aiming (Aim held / right stick): what a hold-up takes
  call: 8192, // whistle for your mount (systems/mounts.ts)
  hitch: 16384, // hitch a team to a wagon, or unhitch it (systems/hitching.ts)
} as const;
/** Edge-triggered buttons must not repeat when the server re-uses a stale input. */
export const EDGE_BUTTONS = BTN.enter | BTN.interact | BTN.reload | BTN.next | BTN.prev | BTN.call | BTN.hitch;

/** [seq, mx, my, throttle, steer, aim, buttons, weaponWish] */
export type InputMsg = [number, number, number, number, number, number, number, number];

/** `deposit` / `withdraw`: id is dollars or 'all'; place is a bank's service id, or -1 - an ATM's id. */
/** `collect` / `payoff`: your business's safe, a crew at its door; `meet`: id is a gang, at your club. */
export type BuyKind = 'weapon' | 'ammo' | 'armor' | 'heal' | 'vehicle' | 'property' | 'garage' | 'respray' | 'chop' | 'sell' | 'deposit' | 'withdraw'
  | 'collect' | 'payoff' | 'meet' | 'floor';  // floor: id is the floor to ride to, place the interior index

export type C2S =
  /** `char`: the player's character from their browser; without it `name` plays an unsaved guest. */
  /** `universe`: the one this page runs (a new room is made in it; a room in another is refused). */
  | { t: 'hello'; v: number; universe: string; name: string; room: string; create: boolean; mode?: string; char?: CharacterSave; resume?: boolean }
  | { t: 'in'; i: InputMsg[] }
  | { t: 'job'; booth: number }
  | { t: 'buy'; kind: BuyKind; id: string; place: number }
  | { t: 'chat'; text: string }
  | { t: 'call'; accept: boolean }        // answer / decline the call that's ringing
  | { t: 'dial'; gang: string }           // ring a contact to ask for work
  | { t: 'talk'; ped: number }            // talk to someone you're standing next to
  | { t: 'radio'; station: number }       // retune the radio of the car you're in (-1 off)
  | { t: 'waypoint'; at: [number, number] | null } // your map waypoint (shared with whoever rides with you)
  /** At a card or casino table (world/tables.ts, server systems/cardTables.ts): `sit` (table id,
   *  n: your buy-in at poker), `leave`, or a play: `op` the move, `n`/`m` amounts or choices, `k`
   *  card indexes, `s` a name (a bet, a cheat); `bets`: several at once (roulette: [kind, number,
   *  amount] each, all on one spin). */
  | { t: 'table'; op: string; table?: number; n?: number; m?: number; k?: number[]; s?: string; bets?: [string, number, number][] }
  | { t: 'ping'; ts: number };

/** How a spoken exchange reaches you: down a payphone's line, a cell's, or face to face. */
export type TalkVia = 'payphone' | 'cell' | 'face';

export const EK = { Ped: 0, Veh: 1, Proj: 2, Pickup: 3, Fire: 4 } as const;

export const PF = { dead: 1, fast: 2, aim: 4, burning: 8, down: 16, player: 32, busy: 64, jump: 128, hands: 256 } as const;
/** `rearing` / `lame`: a mount spooked up on its hind legs, or hurt to a limp (systems/mounts.ts). */
/** `burnout`: gas and handbrake together, wheels spinning on the spot (sim/physics.ts burningOut). */
export const VF = { siren: 1, wreck: 2, burning: 4, brake: 8, lights: 16, driven: 32, smoke: 64, reverse: 128, rearing: 256, lame: 512, burnout: 1024 } as const;
export const PK = { cash: 0, weapon: 1, health: 2, armor: 3, frenzy: 4 } as const;

/** Hit: [8, attacker ped, victim ped, weapon index]: a melee blow landing. */
export const FX = { Shot: 0, Boom: 1, Blood: 2, Swing: 3, Horn: 4, Splash: 5, Spark: 6, Throw: 7, Hit: 8 } as const;
export const HIT = { none: 0, flesh: 1, metal: 2, wall: 3 } as const;

export const Mode = { Foot: 0, Driver: 1, Passenger: 2, Dead: 3, Busted: 4 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export interface YouState {
  pid: number;
  vid: number;
  mode: Mode;
  body: number[];          // [x, y, angle, vx, vy, av, alt, trailer angle]
  hp: number;
  ar: number;
  cash: number;
  bank: number;            // banked money
  wl: number;              // wanted level 0..5
  heat: number;
  w: number[][];           // [weaponIndex, ammo, clip]
  wi: number;              // index into w
  rl: number;              // reload time left
  vt: number;              // vehicle type index (-1 on foot)
  vhp: number;             // vehicle health fraction
  st: number;              // the mount's wind (stamina) 0..1; -1 when not riding something with gaits
  ml: number;              // your mount: VF.rearing (no control) | VF.lame (no faster than a trot)
  respawn: number;         // seconds until respawn while dead/busted
  rs: number[];            // respect per gang (GANGS order)
  mt: number[] | null;     // current mission objective position [x, y]
}

export interface MissionInfo {
  title: string;
  giver: string;           // faction id, or '' for crates
  brief: string;
  objective: string;       // what to do right now
  ends: number;            // server time (ms) the job runs out, 0 = no limit
  progress?: string;       // e.g. "5 / 12"
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  pid: number;
  x: number; y: number;
  cash: number;
  felonies: number;        // total felonies on record
  deaths: number;
  wl: number;
  ping: number;
  frags: number;           // player kills this round
  earned: number;          // cash earned this round
  itS?: number;            // seconds spent "it" this round (tag)
  look?: CharLook;         // saved characters' chosen look (guests use the archetype look)
  vid: number;             // the vehicle they're in (0 on foot)
  wp?: [number, number];   // their map waypoint: shown to everyone riding with them
}

export interface Profile {
  garage: number[];        // vehicle type indexes
  owned: number[];         // property ids
  felonies?: Record<string, number>; // crime kind → times committed
  /** Your businesses' safes: [property id, dollars inside]. */
  safes?: [number, number][];
  /** Gangs leaning on your businesses: [property id, gang id, when they clean out the safe (server ms)]. */
  trouble?: [number, string, number][];
}

export type S2C =
  | { t: 'welcome'; id: number; room: string; seed: number; maxPlayers: number }
  /** `universe`: the room is in that universe (the page switches to it and asks again). */
  | { t: 'reject'; reason: string; universe?: string }
  /** e: changed/new entities; k: ids still in view and unchanged since the last snapshot. */
  | { t: 's'; st: number; ack: number; gt: number; you: YouState; e: number[][]; k: number[]; fx: number[][] }
  | { t: 'players'; list: PlayerInfo[] }
  | { t: 'owners'; list: [number, string | null][] }
  | { t: 'profile'; p: Profile }
  | { t: 'msg'; kind: 'info' | 'chat' | 'kill' | 'money' | 'warn'; text: string }
  | { t: 'mission'; m: MissionInfo | null; result?: 'passed' | 'failed' }
  /** `ends`: server ms the round ends (timed modes); `it`: the player id who's "it" (tag). */
  | { t: 'mode'; mode: string; round: number; ends?: number; it?: number }
  | { t: 'round'; mode: string; winner: string; standings: [string, number][] }
  | { t: 'pong'; ts: number; st: number }
  /** Cell phone: a contact (gang id) calling, a call missed, or a call over (with what they said). */
  | { t: 'call'; gang: string; state: 'ring' | 'missed' | 'end'; text?: string }
  /** A text message to the phone. */
  | { t: 'text'; from: string; body: string }
  /** A spoken exchange on the phone (packs/calls.ts): each part is [caller, situation, exchange
   *  index], played in order; `via` sets how it sounds (a payphone's line, or a cell's), or
   *  `face`: in person with `ped`, whose bubbles are drawn over them (systems/faceTalk.ts). */
  | { t: 'talk'; via: TalkVia; parts: [string, string, number][]; ped?: number }
  /** People (packs/calls.ts PEOPLE_CONTACTS) whose number you have. */
  | { t: 'people'; ids: string[] }
  /** A car's radio was retuned (by anyone riding in it), or you got into a car someone retuned:
   *  its station (-1 off). Everybody in the car hears the same broadcast. */
  | { t: 'radio'; vid: number; station: number }
  /** A message left on your phone when you missed someone's call: parts as in `talk`. */
  | { t: 'voicemail'; from: string; parts: [string, string, number][] }
  /** Vault doors standing open (interior indexes; world/interiors.ts). */
  | { t: 'gates'; open: number[] }
  /** Street props knocked flat (world/breakables.ts index, and the way it fell in centiradians);
   *  the whole list, sent when it changes and on joining. */
  | { t: 'props'; down: [number, number][] }
  /** The character's progress, for the browser to save (sent every few seconds and after buys). */
  | { t: 'save'; id: string; p: CharacterProgress }
  /** The table you're playing at, as you see it (null: you've left it). */
  | { t: 'table'; v: TableView | null }
  /** Friends with a card game whose number you have: [id, name]; and the gangs whose back-room
   *  game you've been invited to (or sat in), so the map can show it. */
  | { t: 'friends'; list: [string, string][]; games?: string[] };

/** A card or casino table as one player sees it (server systems/cardTables.ts builds it; the pane,
 *  client hud/cardTable.ts, draws it). Cards are 0..51 (games/cards.ts), -1 face down. */
export interface TableView {
  id: number;
  name: string;
  game: string;
  stakes: [number, number];
  /** Poker: your chips at the table (house games bet straight from your cash). */
  chips: number;
  /** What's been happening, newest last. */
  log: string[];
  poker?: {
    street: string; board: number[]; pot: number; toCall: number; minTo: number; maxTo: number; yourTurn: boolean;
    you: number; dealer: number; acting: number;
    /** `last`: what each last did ("Raise to 400", "Fold", "SB"). */
    seats: { name: string; stack: number; bet: number; folded: boolean; allIn: boolean; out: boolean; cards: number[]; drew?: number; last?: string }[];
    /** Between hands: you can rebuy (you're out of chips) or the next deal is coming. */
    between: boolean;
    /** The main pot, then side pots; the big blind (or the smallest bet); the last showdown. */
    pots: number[];
    big: number;
    result: { seat: number; won: number; hand: string }[] | null;
    /** The one to act thinking it over (or the next deal coming): [seconds left, of]. */
    clock: [number, number] | null;
    /** Between hands: how far you may top up your chips to (the table's biggest buy-in). */
    topTo: number;
  };
  bj?: { hands: { cards: number[]; bet: number; total: number }[]; active: number; dealer: number[]; dealerTotal: number; phase: string; outcome: string[] };
  /** Roulette: the last number, the ones before it, and the last spin's bets [kind, number,
   *  amount, back] (back: what each paid, stake included; 0 lost). */
  roulette?: { last: number; history: number[]; bets: [string, number, number, number][] };
  dice?: { variant: string; point: number; main: number; bet: number; side: string; last: [number, number] | null; said: string; history: number[] };
  /** Craps (shared/games/craps.ts): the point (0 off), your bets [kind, number, amount, odds],
   *  the last rolls (newest first). */
  craps?: { point: number; bets: [string, number, number, number][]; last: [number, number] | null; said: string; history: number[] };
  slots?: { reels: number[] | null; won: number };
  /** Faro: `dealt` per rank (deuce .. ace), what the casekeeper's counted out of the box. */
  faro?: { turn: [number, number] | null; bets: [number, number][]; left: number; said: string; dealt: number[] };
  /** Cheating (RULES.cardCheats), when you could right now: which moves, and the cards you've
   *  peeked at (seat index → cards). */
  cheats?: string[];
  peeked?: [number, number[]][];
}

export interface RoomListing { code: string; universe: string; players: number; max: number; names: string[] }

export const PLAYER_COLORS = ['#ff5a4f', '#4fa3ff', '#ffd34f', '#5fe07a', '#c77dff', '#ff9a3c', '#3ce0e0', '#ff6ec7'];
