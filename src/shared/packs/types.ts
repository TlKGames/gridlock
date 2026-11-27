// Pack schemas. Packs hold nouns (content, numbers, names). The engine holds verbs and
// only ever refers to pack entries through these fields, never by a pack id.

/** A box in a vehicle/prop model, in fractions of the object's length (x), width (y), height (z). */
export interface Part {
  x: [number, number];   // -0.5..0.5 along length (+ = front)
  y: [number, number];   // -0.5..0.5 across width (+ = right side)
  z: [number, number];   // 0..1 of height
  paint: Paint;
  /** Optional side silhouette [x, z] points; when set the part is this outline extruded across y. */
  profile?: [number, number][];
  /** `leg_*`: a mount's leg (front/rear, left/right), swung by its gait from the top of the box. */
  tag?: 'rotor' | 'tailrotor' | 'turret' | 'barrel' | 'siren' | 'headlight' | 'taillight' | 'leg_fl' | 'leg_fr' | 'leg_rl' | 'leg_rr';
}

export type Paint = 'body' | 'glass' | 'dark' | 'chrome' | 'trim' | 'headlight' | 'taillight'
  | 'red' | 'blue' | 'white' | 'black' | 'yellow' | 'olive' | 'tire' | `#${string}`;

/** `legs`: a ridden animal (a horse, a team pulling a wagon): no wheels, the rider sits astride. */
export type Movement = 'wheels' | 'bike' | 'tracks' | 'rotor' | 'boat' | 'legs' | 'rail';

export interface CrimeSpec {
  /** Heat added when a lawful unit sees it (civilian witnesses report half). */
  heat: number;
  /** Label on the offender's felony record; crimes without one (gunfire) only add heat. */
  felony?: string;
  /** Seconds before the same felony is recorded again for one player. */
  cooldown?: number;
}

/** Fractions of the body width lost toward the ends and the top. */
export interface BodyShape {
  nose: number;     // width lost at the very front (rounded corners)
  tail: number;     // width lost at the very back
  tumble: number;   // width lost at the roof (cabin narrower than the body)
  round?: number;   // length fraction over which the ends curve in; default 0.16
  hips?: number;    // extra width over the rear wheels (sports cars), fraction of width
}

export interface VehicleSpec {
  id: string;
  name: string;
  movement: Movement;
  length: number; width: number; height: number;
  mass: number;
  maxSpeed: number;     // m/s
  accel: number;        // m/s^2
  brake: number;        // m/s^2
  reverse: number;      // max reverse speed m/s
  grip: number;         // lateral grip (1/s)
  turnIn?: number;      // oversteer when steering at speed, 0..0.5 (GTA2 turn_in); default 0.15
  turnRate: number;     // rad/s at full lock
  hp: number;
  seats: number;
  price: number;        // dealer price; also chop-shop value base
  colors: number[] | 'civil' | 'bright' | 'dull';
  roles: string[];      // spawn roles: traffic, parked, police, ambulance, fire, military, ...
  siren?: boolean;
  /** Sound voices (src/client/audio/sound.ts): the horn it honks and the engine heard while you
   *  drive it. Without them it has no horn / no engine sound. */
  horn?: string;
  engine?: string;
  /** A ridden animal's gaits (sim/mount.ts): speeds (m/s) at a walk, trot, canter (a full
   *  throttle) and gallop (Sprint); how fast it picks speed up and lets it go (m/s²); its turn rate
   *  (rad/s) standing or walking and at a gallop; how fast it backs up. With `gaits` a vehicle
   *  moves as a mount, not a car. */
  gaits?: { walk: number; trot: number; canter: number; gallop: number; accel: number; slow: number; turnSlow: number; turnFast: number; back: number };
  /** A mount's wind: it can gallop for up to `gallop` seconds, then has to canter while it gets its
   *  wind back, `recover` seconds of gallop per second off it (default 0.5: half as fast as it
   *  spends it). */
  stamina?: { gallop: number; recover?: number };
  /** A mount's temperament (server/game/systems/mounts.ts): `nerve` 0..1, how often it holds steady
   *  when a gun goes off or something blows up near it (else it rears, then bolts if nobody holds
   *  it); `buck` 0..1, how readily a rearing horse throws its rider; `lame`, the share of its health
   *  below which it limps (no faster than a trot) until it heals. */
  temper?: { nerve: number; buck: number; lame: number };
  /** Comes at a whistle (the Call key) to the player who last rode it. */
  comesWhenCalled?: boolean;
  /** Livestock: left to itself it grazes, standing and ambling about near where it was found
   *  (systems/graze.ts); spooked, it bolts like a loose horse. */
  grazes?: boolean;
  /** A team-drawn wagon: unhitching (the Hitch key, stopped) leaves the wagon standing as
   *  `wagon` and you driving the bare `team` (vehicle ids). */
  hitch?: { team: string; wagon: string };
  /** A wagon standing without its team (seats 0): a team backed up to its pole hitches on and it
   *  becomes this vehicle (whose `hitch.team` is that team). */
  hitchAs?: string;
  /** What it's made of (shared/materials.ts says what each does): `metal` (default: sparks, dents,
   *  smokes, burns and blows up), `wood` (dust, goes down), `flesh` (bleeds, falls and lies down). */
  material?: 'metal' | 'wood' | 'flesh';
  armored?: boolean;    // occupants immune to small arms
  openTop?: boolean;    // occupants can be shot
  crushes?: boolean;    // drives over cars
  weapons?: string[];   // vehicle weapon ids fired by the driver
  /** A driver-aimed turret and how fast it traverses (rad/s): tanks, gun trucks. Without one,
   *  mounted weapons fire straight ahead. */
  turret?: number;
  /** Seats you sit on in plain sight (motorbikes, open-top cars), in seat order (0 drives): where
   *  the hips go (metres from the centre, x + = forward, y + = to the driver's right; height off the
   *  ground) and how far they lean forward (radians; negative leans back into a seat). Riders are
   *  drawn; occupants of other vehicles aren't. */
  saddles?: { x: number; y?: number; z: number; lean: number }[];
  model: Part[];
  /** Plan-view body shaping (seen from above): without it the body is a straight-sided box. */
  shape?: BodyShape;
  /** Metres behind the centre that the vehicle pivots on when it turns (its rear axle). Without it,
   *  vehicles turn about their centre (arcade cars). */
  rearAxle?: number;
  /** Truck-style turning: tightest circle at a crawl (m) and most cornering force (m/s²). */
  minTurnRadius?: number;
  maxLateral?: number;
  /** Articulated trailer; `hitch` is metres behind the vehicle's centre (the fifth wheel). */
  trailer?: { length: number; width: number; height: number; model: Part[]; hitch?: number };
}

export type WeaponKind = 'melee' | 'hitscan' | 'projectile' | 'thrown' | 'flame';

/** One piece of a street prop's model, standing at the prop's spot (`out`: metres out over the
 *  road, for a lamp's arm and head; `lamp`: lights up at night). */
export interface StreetPropPart {
  shape: 'cyl' | 'box'; w: number; h: number; d?: number; y?: number; out?: number; color: string; lamp?: boolean;
  /** Traffic-light arms reach across their own road: `arm` spans the reach, `end` hangs at its tip. */
  span?: 'arm' | 'end';
}

/** A fixture part: a box-model part (fractions of the fixture's size, +x its front), in one of a
 *  few shapes; `spin` turns about its own x axis (a windmill's wheel). */
export interface FixturePart {
  x: [number, number]; y: [number, number]; z: [number, number];
  /** A colour, or 'body': the fixture's own colour (one of its `colors`, per fixture). */
  paint: `#${string}` | 'body';
  shape?: 'box' | 'cyl' | 'cone' | 'gable';
  spin?: boolean;
}

/**
 * A fixture: something built or growing that the world places (shared/world/fixtures.ts) and the
 * renderer draws from its parts: a church, a water tower, a barn, a corral, a windmill, a cactus.
 * `site` says where: in place of a generated building on a street lot ('lot'), on a town square
 * ('square'), in a homestead's yard beside the house ('yard'), out in open country ('wild'), or on
 * the street lot beside a railway station, facing the track ('station': a depot).
 * `chance` per lot (or, 'wild', per 10,000 m²), at most `most` per town (district). `solid`: its
 * footprint ('box'), a trunk of that radius (m), or an outline with a gate in front ('ring': a
 * corral); none, it can be walked through.
 */
export interface FixtureSpec {
  id: string;
  site: 'lot' | 'square' | 'yard' | 'wild' | 'station';
  zones: string[];
  chance: number;
  most?: number;
  /** Footprint (m: along its front, x; across, y) and height (m). */
  size: [number, number]; height: number;
  solid?: 'box' | 'ring' | number;
  colors?: string[];
  parts: FixturePart[];
}

/** Street furniture vehicles can knock over (packs/streetProps.ts). */
export interface StreetPropSpec {
  id: string; name: string;
  /** Its footprint (m): what a vehicle hits. */
  radius: number;
  /** A vehicle at least this fast (m/s) knocks it flat; slower, it's in the way like a wall. */
  knockSpeed: number;
  /** Damage the vehicle takes knocking it over, and the share of its speed it keeps. */
  carDamage: number; slow: number;
  /** Where the city puts it: down the roads `every` metres, on block kerbs (`perBlock` min..max,
   *  `busyOnly`: only on busy blocks), or at each lit junction's approaches (`signal`). */
  along: 'road' | 'kerb' | 'signal'; every?: number; perBlock?: [number, number]; busyOnly?: boolean;
  /** What knocking it over throws up. */
  fx?: 'spark' | 'water';
  parts: StreetPropPart[];
}

export interface WeaponSpec {
  id: string;
  name: string;
  kind: WeaponKind;
  slot: number;            // 0 melee .. 7 heavy
  damage: number;
  rate: number;            // shots per second
  range: number;
  spread: number;          // radians
  pellets?: number;
  auto: boolean;
  clip: number;            // 0 = no ammo (melee)
  reload: number;          // seconds
  vehicleMul: number;      // damage multiplier vs vehicles
  price: number;           // 0 = not sold
  ammoPrice: number;       // price per clip refill bundle
  ammoBundle: number;
  projectile?: { speed: number; fuse?: number; radius: number; blast: number; fire?: boolean; arc?: boolean };
  tracer: string;
  sound: string;
  /** Melee: the sound of it landing (else `sound`), how hard it shoves who it hits (m/s) and how
   *  long they reel, unable to act (s). */
  hitSound?: string;
  knockback?: number;
  stagger?: number;
  hold: 'fist' | 'one' | 'two' | 'heavy' | 'throw';
  vehicleOnly?: boolean;
  driveBy?: boolean;       // usable from a car window
  /** Display length of the held mesh in metres (0 = nothing in the hand). */
  size: number;
  /** The weapon's 3D model (packs/weaponModels.ts), in the hand and in the gun shop. */
  model?: WeaponPart[];
}

/** A weapon model part, in metres: x along the barrel (+ = muzzle; 0 is where the hand grips),
 *  y up, z to the right. A box spans the three ranges; a cylinder runs along `axis` (default x)
 *  and fills the other two. `tilt` pitches the part about its centre (radians, + = nose up). */
export interface WeaponPart {
  shape: 'box' | 'cyl';
  x: [number, number]; y: [number, number]; z: [number, number];
  mat: WeaponMat;
  axis?: 'x' | 'y' | 'z';
  tilt?: number;
}
export type WeaponMat = 'steel' | 'black' | 'polymer' | 'wood' | 'chrome' | 'olive' | 'brass' | 'red' | 'glass' | 'cloth' | `#${string}`;

export interface LoadoutEntry { weapon: string; chance: number; ammo: number }

export type Behaviour = 'civilian' | 'gang' | 'police' | 'military' | 'medic' | 'firefighter'
  | 'dealer' | 'streetwalker' | 'guard' | 'player';

export interface PedArchetype {
  id: string;
  name: string;
  behaviour: Behaviour;
  faction: string;
  hp: number;
  armor: number;
  walkSpeed: number;
  runSpeed: number;
  courage: number;        // 0 flees from everything, 1 always fights back
  accuracy: number;       // 0..1
  loadout: LoadoutEntry[];
  cash: [number, number];
  look: { skin: string[]; top: string[]; bottom: string[]; hat?: string[]; hatChance?: number; build?: number };
  /** Who they speak as when you walk up and talk to them (a cast id; systems/faceTalk.ts). One of a
   *  gang's people can give you its work face to face. */
  talker?: string;
}

export interface FactionSpec {
  id: string;
  name: string;
  color: string;
  hostile: string[];      // factions attacked on sight
  lawful?: boolean;       // reports/punishes crime
  /** Its members report crimes they see (at half the heat a lawful unit adds). */
  witness?: boolean;
  gang?: boolean;         // has respect, payphones and missions
  carColor?: number;      // palette index gang cars are painted on their turf
  /** Gang brand: the symbol they spray (a kind the renderer knows how to draw) and a second colour. */
  brand?: { symbol: string; accent: string };
  tags?: string[];        // words they spray on their turf
}

export type MissionKind = 'hit' | 'torch' | 'steal' | 'courier' | 'frenzy';

export interface MissionSpec {
  id: string;
  kind: MissionKind;
  /** Who offers it: a gang faction id, 'gang' (any gang's phone) or 'crate' (kill-frenzy crates). */
  giver: string;
  title: string;
  /** Brief with tokens: {target} {rival} {place} {vehicle} {count} {reward} {time}. */
  brief: string;
  reward: [number, number];
  respect: number;              // gained with the giver on success
  rivalRespect: number;         // lost with the target gang on success
  time: number;                 // seconds, 0 = no limit
  distance: [number, number];   // metres from the phone to the job
  target?: {
    vehicle?: string;           // steal: vehicle id; torch: vehicle id (else the rival's gang car)
    hpMul?: number;             // hit: toughness multiplier for the mark
    escorts?: number;           // hit/torch: rival members guarding the target
    count?: number;             // frenzy: kills needed
    weapon?: string;            // frenzy: weapon handed out for the duration
  };
}

export interface GameMode {
  id: string;
  name: string;
  /** 'none' free roam; 'frags' player kills; 'earned' cash earned this round. */
  /** `tag`: one player is "it"; target is the round length (s); least time as it wins. */
  score: 'none' | 'frags' | 'earned' | 'tag';
  target: number;
  blurb: string;
}

export interface WeightedId { id: string; weight: number }

export interface ZoneSpec {
  id: string;
  name: string;
  mapColor: string;
  ground: string;               // lot ground colour
  sidewalk: string;
  /** Lot widths (m), the building's setback and height, coverage; `width`: a house's own frontage
   *  (m), when it stands on a plot wider than itself (layout 'houses'; default: the plot's width). */
  lot: { min: number; max: number; setback: [number, number]; height: [number, number]; coverage: number; width?: [number, number] };
  /** `wild`: open country (no sidewalks; roads only along arterial lines, as trails; `wild` says
   *  what the ground holds). */
  layout: 'buildings' | 'houses' | 'park' | 'docks' | 'compound' | 'wild';
  wild?: WildSpec;
  wall: string[];               // building wall colours
  roof: string[];
  trees: number;                // trees per 1000 m2 of open ground
  parkingChance: number;
  plazaChance: number;
  pedDensity: number;           // peds per 10,000 m2
  peds: WeightedId[];
  trafficDensity: number;       // cars per 100 m of road
  traffic: WeightedId[];
  parked: WeightedId[];
  parkedDensity: number;        // parked cars per 100 m of curb
  roadDrop: number;             // chance a minor road segment is removed
  fenced?: boolean;
  windows: number;              // 0 no windows .. 1 glass towers
  /** Its buildings are warehouses (big sheds) rather than blocks and towers. */
  warehouses?: boolean;
  /** Busy streets: bins, mailboxes, newspaper boxes and bus shelters along the curb. */
  busy?: boolean;
  /** A compound's perimeter (layout 'compound'): its colour and height (m). Default a 3 m grey
   *  security fence; a fort's log palisade is brown and taller. */
  perimeter?: { color: string; h: number };
  /** A compound's buildings: 'hangar' (metal sheds, the default) or 'block' (plain timber or brick). */
  compoundKind?: 'hangar' | 'block';
}

export interface DistrictSpec {
  name: string; zone: string; x: number; y: number; weight?: number;
  /** Gang that holds this district: its members hang out here and tag the walls. */
  gang?: string;
}

export type ServiceVerb = 'gunshop' | 'dealer' | 'respray' | 'chopshop' | 'hospital' | 'police'
  | 'fire' | 'military' | 'helipad' | 'bank' | 'gas' | 'casino';

/** A game a table runs (shared/games): poker (hold'em, five-card draw and stud) against other
 *  players, or a house game against the bank. */
export type GameKind = 'holdem' | 'draw' | 'stud' | 'blackjack' | 'twentyone' | 'roulette' | 'craps' | 'hazard' | 'slots' | 'faro';

/** A kind of table (Universe.tables): its game, its stakes and its company. */
export interface TableSpec {
  id: string;
  name: string;
  game: GameKind;
  /** Poker: hold'em's blinds [small, big]; draw and stud [ante, smallest bet]. House games: the
   *  smallest and biggest bet. */
  stakes: [number, number];
  /** Poker: what you sit down with, at least and at most. */
  buyIn?: [number, number];
  /** Poker: how many others play, and how well (0, a buddy who calls everything, to 1, a shark). */
  players?: number;
  skill?: number;
  /** Poker: the house's cut of each pot (a share) and its cap. */
  rake?: [number, number];
  /** Poker: the share of the others who are card sharps (they cheat now and then). */
  sharps?: number;
  /** Caught cheating here: shot dead where you sit, or thrown out (the house keeps your stack). */
  caught?: 'shoot' | 'throwOut';
  /** What the table is drawn as: a card or dice table, or a slot machine. */
  prop?: 'table' | 'slots';
  /** Its furniture model (art/furniture.py: poker_oval, blackjack, blackjack_wood, roulette, craps,
   *  slots, card_table, faro, dice_table, folding); by default the plain one for its game. */
  model?: string;
}

/** Where tables are (Universe.venues): every walk-in place of a layout (a casino's floor, a
 *  saloon) whose table props each get one of `tables`; a back room in a walk-in place on each
 *  gang's turf (the gang runs it: invite only, the first time); or a friend's yard (FriendSpec).
 *  `mix`: each place gets its own few of `tables`, more of them the more tables its room holds. */
export interface VenueSpec {
  at: { layout: InteriorLayout } | { backroom: true } | { home: true };
  tables: string[];
  mix?: boolean;
}

/** A friend who plays cards at home (not a gangster): where their game is, what they text you. You
 *  meet them at their place (Enter beside them), then call them up for a game, or they invite you. */
export interface FriendSpec {
  id: string;
  name: string;
  /** Their game (a TableSpec id). */
  table: string;
  /** Who they look like (a ped archetype). */
  arch: string;
  /** Said when you meet; texted when they invite you; when you call and the game's on; when it isn't. */
  meet: string;
  invite: string[];
  on: string[];
  busy: string[];
}

export interface ServiceSpec {
  id: string;
  name: string;
  verb: ServiceVerb;
  zones: string[];
  count: number;
  sign: string;
  signText: string;             // short text on the storefront sign
  stock?: string[];             // weapon ids (gunshop) or vehicle ids (dealer)
  spawns?: { vehicle: string; count: number }[];
  guards?: { archetype: string; count: number }[];
  price?: number;               // respray cost
  atm?: boolean;                // an ATM on the wall beside the door
  interior?: InteriorLayout;    // walk in: the ground floor is laid out like this (world/interiors.ts)
  robbery?: RobberySpec;        // the counter can be held up
}

/** A walk-in place's counter can be held up at gunpoint: what its till holds when full, and the
 *  chance the clerk pulls a gun instead of handing it over. */
export interface RobberySpec { till: number; fightBack: number }

/** How an enterable place's ground floor is laid out (shared/world/interiors.ts): generated for the
 *  first five, hand-made (packs/interiorPlans.ts) for the rest. */
export type InteriorLayout = 'shop' | 'diner' | 'club' | 'saloon' | 'warehouse' | 'kiosk' | 'bank' | 'precinct' | 'tower' | 'apartments' | 'casino';

/** A hand-made ground floor, in metres: `a` across the room from its left inside corner (seen from the
 *  street), `d` in from the front wall. Rects are [a0, a1, d0, d1]. The shell (with the street door)
 *  is added around it. */
export interface InteriorPlan {
  w: number; d: number;
  walls: { r: [number, number, number, number]; h?: number }[];
  props: { r: [number, number, number, number]; h: number; kind: 'counter' | 'shelf' | 'table' | 'booth' | 'bar' | 'rack' | 'desk' | 'stool' | 'dance' | 'bench' | 'bars' | 'slots' }[];
  counter: [number, number];
  clerk: [number, number];
  /** Who works the counter (a ped archetype); the generated layouts use the clerk. */
  clerkArch?: string;
  guards?: { at: [number, number]; arch: string }[];
  /** A strongroom: its door (a gate that explosions open), the room behind it, where the cash lies. */
  vault?: { door: [number, number, number, number]; room: [number, number, number, number]; cash: [number, number][] };
}

export interface PropertySpec {
  id: string;
  name: string;
  kind: 'home' | 'business';
  zones: string[];
  count: number;
  price: number;
  income: number;               // dollars per game hour (businesses)
  garage: number;               // cars stored (homes)
  signText?: string;            // storefront sign (businesses)
  signColor?: string;
  atm?: boolean;                // an ATM on the wall beside the door
  /** What owning it does besides income: `wash` drive onto its pad and your wanted level clears;
   *  `fence` drive a stolen car onto its pad to sell it above chop-shop prices; `club` meet any gang
   *  that will work with you at its door. */
  perk?: 'wash' | 'fence' | 'club';
  interior?: InteriorLayout;    // walk in: the ground floor is laid out like this
  /** The counter can be held up. Owned by another player, a hold-up takes from its safe instead. */
  robbery?: RobberySpec;
  /** Its own pin on the maps instead of the plain property marker (with its own legend toggle,
   *  `label`): a colour and a glyph, a character or one of the drawn ones (hud/mapGlyphs.ts:
   *  'mug'). Hovering it on the big map also lists the games its tables deal. */
  icon?: { color: string; glyph: string; label: string };
}

export interface Squad { vehicle: string; crew: string[] }

/** Who drives a vehicle that spawns in traffic with this role (a ped archetype), and an optional
 *  partner riding along. `crew`: they get out together and go back to the vehicle (patrols). */
export interface RoleCrew { driver: string; partner?: string; partnerChance?: number; crew?: boolean }

export interface WantedLevel {
  heat: number;                 // heat needed to reach this level
  squads: { squad: Squad; max: number }[];
  lethal: boolean;              // cops shoot instead of arresting
  /** Seconds after reaching this level before its first unit is sent (the call goes out, a car is
   *  free, it drives over), then between units. Patrols already on the street react at once. */
  respond: number;
  every: number;
}

export interface ServiceCall { squad: Squad; maxActive: number }

/** Crimes the engine reports (its verbs); a universe gives each its heat and felony label. */
export type CrimeKind = 'gunfire' | 'assault' | 'assaultLaw' | 'murder' | 'murderLaw' | 'vehicularHomicide'
  | 'carjack' | 'vehicleTheft' | 'explosion' | 'trespass' | 'bankRobbery' | 'robbery';

/**
 * The map a universe plays on: the engine's grid generator (GTA2-style: straight roads between
 * blocks) shaped by these settings. Defaults (shared/world/worldSpec.ts) are Bayhaven's island.
 */
export interface WorldSpec {
  /** Side of the square map, metres. */
  size: number;
  /** Width of the border outside the land: sea (boats, swimming) or cliffs (solid). */
  margin: number;
  edge: 'sea' | 'cliffs';
  /** A river across the map at this fraction of its height (one row of the grid), or none. */
  river: { at: number; width: number } | null;
  /** Gap between road lines, metres: near the centre and toward the edges (scaled ±15%). */
  spacing: { near: number; far: number };
  /** Every n-th road line is an arterial (two lanes each way; the trails in open country). */
  arterialEvery: number;
  /** Colour of bare land where nothing else is drawn (between open-country blocks). */
  ground: string;
  /** A modern place: paved streets with markings and traffic lights, street furniture (lamps,
   *  hydrants, bins, shelters), rooftop machinery (AC units, tanks, vents, solar, helipads,
   *  antennas). Not modern: every road is dirt, and none of that. */
  modern: boolean;
  /** A railway (world/railgen.ts, systems/trains.ts). */
  railway?: RailSpec;
  /** How large people are drawn against life (default 1.55: larger than life, so they read from
   *  the street camera next to cars). Riders are always about 1.1x, to sit a real-size saddle; a
   *  world of real-size horses draws people on foot at the same size. Looks only, not hit boxes. */
  pedScale?: number;
  /** Real hills: open country's ground rises and falls by its zone's WildSpec.relief times `scale`
   *  (world/terrain.ts), with its zones' mesas and gorges; towns, water and the railway stay level.
   *  Without it the world is flat. */
  terrain?: { scale: number };
}

/** A railway along one road line. 'elevated': on a viaduct over the street (a city's L), on its own
 *  strip, reached by the stations' stairs. 'grade': on the ground (a frontier railroad), `offset`
 *  metres beside the road's centre line, crossing the streets it meets; anything on the track when
 *  a train comes gets hit. */
export interface RailSpec {
  style: 'elevated' | 'grade';
  /** The line it follows: 'h' east-west, 'v' north-south, nearest this fraction across the map. */
  axis: 'h' | 'v';
  at: number;
  offset?: number;
  /** A station every this many blocks (and one near each end). */
  stationEvery: number;
  /** Trains in service (one per track: up to two), cars per train, and the vehicle a car is. */
  trains: number;
  cars: number;
  car: string;
  /** Running speed (m/s) and the wait at each station (s). */
  speed: number;
  dwell: number;
  /** What a station is called on the map ("Station", "Depot"). */
  stationName: string;
  /** A vehicle at each end of every train (locomotives), facing outward, so one always leads;
   *  `car` makes up the rest. Without it every car is `car`. */
  ends?: string;
}

/** What open country (zones with layout 'wild') is made of: scattered rock formations (solid,
 *  drawn as buttes and outcrops) and ponds (water), per 10,000 m² of open ground. */
export interface WildSpec {
  rocks: number;
  /** Rock size range (m) and height range (m). */
  rockSize: [number, number];
  rockHeight: [number, number];
  rockColor: string[];
  ponds: number;
  pondSize: [number, number];
  /** Ground colours, blended in broad drifts. */
  ground: string[];
  /** The colour of trails (dirt roads) through it. */
  trail: string;
  /** How hilly it is (m from wash bottom to ridge top, as painted; world/relief.ts; the ground's
   *  real rise is this times WorldSpec.terrain.scale), the colour down in the washes and up on the
   *  ridges, and the rock layers that show in bands on its steeper slopes. Rock formations stand on
   *  the high ground. */
  relief?: number;
  low?: string;
  high?: string;
  strata?: string[];
  /** Loose boulders (solid) per 10,000 m², and brush (low bushes, not solid) per 100 m², in these
   *  colours, this size (m across); it grows thickest down in the washes. */
  boulders?: number;
  brush?: { density: number; colors: string[]; size: [number, number] };
  /** Real landforms (with WorldSpec.terrain; world/terrainGen.ts). Plateaus: flat-topped high
   *  ground `height` m up behind sheer cliffs, over about `cover` of the land (0..1); the broad ones
   *  rise in a second tier, and here and there a slope leads up. Kept back from the trails. */
  mesas?: { cover: number; height: number };
  /** Gorges: winding canyons `depth` m deep and `width` m across at the rim (a range), sheer-walled
   *  with a ledge part way down, over about `cover` of the land; `river`: water along the floor.
   *  A trail crosses one on a timber trestle. */
  gorges?: { cover: number; depth: number; width: [number, number]; river?: boolean };
}

/** A radio station: its folder under the universe's `<contentDir>/radio/`, the name players see,
 *  and `font`, the name's typeface (a CSS font family, bundled by client/audio/radioFonts.ts). */
export interface RadioStation { id: string; name: string; color: string; font: string }

/** Parts of a player character's look (the renderer draws each); a universe lists the choices. */
export type LookPart = 'skin' | 'hair' | 'hairStyle' | 'top' | 'bottom' | 'hat';

// Call scripts as written in a universe's content (see content/README.md).
/** `answer`: they pick up when you ring them; `refuse`: they pick up and won't deal with you (too
 *  many blown jobs); `nudge`: there's work if you want it (said after their job-result call, on
 *  its own when you've been idle); `tip`: after picking up, there's a payphone ringing for you;
 *  `hello`: how they open a call they make to you; `voicemail`: the message they leave when you
 *  miss it (falls back to a nudge).
 *  Face to face (systems/faceTalk.ts): `greet` what they say when you walk up and talk to them;
 *  `rumour` what they've heard (sometimes said after a greeting); `scared` when you're wanted or
 *  have a gun out. A gang's people brief their work with the job kinds, and use `busy`, `nothing`
 *  and `refuse` as on the phone. */
export type CallSituation = 'intro' | 'hit' | 'torch' | 'steal' | 'courier' | 'frenzy' | 'pass' | 'fail' | 'busy' | 'nothing'
  | 'answer' | 'refuse' | 'nudge' | 'tip' | 'hello' | 'voicemail' | 'greet' | 'rumour' | 'scared';
/** What you say on your own in a call the server puts together: `pickup` answering your cell,
 *  `payphone` picking up a ringing payphone, `ask` asking for work when you ring someone, `on_it`
 *  after being sent to a payphone. Face to face (systems/faceTalk.ts): `greet` walking up to
 *  someone, `work` asking one of a gang's people for work, `take` taking the job they brief,
 *  `leave` closing a conversation. A universe without them leaves you silent there. */
export type PlayerSituation = 'pickup' | 'payphone' | 'ask' | 'on_it' | 'greet' | 'work' | 'take' | 'leave';
/** A turn as written: the caller's lines (or a version for a male and a female character), or
 *  the key of your line in player.json. A line's breaks are how it's read and shown. */
export interface TurnFile { say?: string[]; male?: string[]; female?: string[]; you?: string; tone?: string; clip?: string }
export interface VoiceFile { model: string; exaggeration: number; cfg: number }
export interface CharacterFile {
  id: string; name: string; fullName: string; role: string; about: string;
  crew?: string; boss?: boolean; welcome?: boolean; mentor?: boolean; contact?: boolean;
  /** Their reference voice; without one their lines are shown, not spoken. */
  voice?: VoiceFile;
  calls: Partial<Record<CallSituation, TurnFile[][]>>;
}
export interface PlayerFile {
  about: string; default: string;
  voices: ({ id: string; name: string; who: 'man' | 'woman'; about: string } & VoiceFile)[];
  says: Record<PlayerSituation, string[]>;
  lines: Record<string, { say: string[]; tone?: string }>;
}

/**
 * A universe: one whole setting the engine can run (Bayhaven, a western, ...). Every noun the game
 * uses comes from here; the engine installs one per process (packs/index.ts installUniverse) before
 * any game code runs. Lists are in wire order: their indices go over the network and into saves.
 */
export interface Universe {
  id: string;
  name: string;
  /** One line for the universe picker. */
  blurb: string;
  /** Folder (from the project root) holding its content: characters/, player/, radio/. */
  contentDir: string;
  /** Its map; anything left out keeps the engine default (shared/world/worldSpec.ts). */
  world?: Partial<WorldSpec>;
  vehicles: VehicleSpec[];
  weapons: WeaponSpec[];
  peds: PedArchetype[];
  factions: FactionSpec[];
  zones: ZoneSpec[];
  districts: DistrictSpec[];
  services: ServiceSpec[];
  properties: PropertySpec[];
  interiorPlans: Partial<Record<InteriorLayout, InteriorPlan>>;
  missions: MissionSpec[];
  modes: GameMode[];
  /** Names jobs give their marks. */
  markNames: string[];
  wanted: WantedLevel[];
  crimes: Record<CrimeKind, CrimeSpec>;
  serviceCalls: { medic: ServiceCall; fire: ServiceCall };
  roleCrews: Record<string, RoleCrew>;
  /** Overrides of the engine's defaults (packs/defaults.ts). */
  rules: Partial<import('./defaults').Rules>;
  respect: Partial<import('./defaults').Respect>;
  radio: RadioStation[];
  /** Vehicle paint (index = colour id on the wire), its names, and the groups VehicleSpec.colors names. */
  palette: { colors: string[]; names: string[]; civil: number[]; bright: number[]; dull: number[] };
  /** Colours NPCs are dressed in beyond their archetype's look. */
  pedColors: { hair: string[]; shoes: string[] };
  /** Player characters: choices per look part (hat 0 = none, hairStyle names), the default look,
   *  and the parts random names are rolled from. */
  looks: Record<LookPart, string[]>;
  defaultLook: Record<LookPart, number>;
  nameParts: { first: string[]; last: string[] };
  /** Body armour's model in the gun shop. */
  armorModel: WeaponPart[];
  /** Street furniture vehicles can knock over (none: bare streets). */
  streetProps: StreetPropSpec[];
  /** Built and growing things the world places (churches, windmills, corrals, cacti...); none: [] or left out. */
  fixtures?: FixtureSpec[];
  /** Card and casino games: the kinds of table, where they are, and friends with a game at home. */
  tables?: TableSpec[];
  venues?: VenueSpec[];
  friends?: FriendSpec[];
  /** Call scripts: each character's file with its folder under `<contentDir>/characters/`, and the
   *  player's file (`<contentDir>/player/player.json`). */
  cast: [string, CharacterFile][];
  player: PlayerFile;
}
