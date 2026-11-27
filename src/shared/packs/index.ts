// Pack registry: everything the engine reads about the installed universe, plus id -> index
// lookups. Index order is the wire format. One universe per process (a server room worker, a
// browser page, a script): installUniverse fills these exports in place, before any game module
// that reads them at load time is imported. Until then the default universe is installed.
import { DEFAULT_UNIVERSE } from '../../universes';
import { installCalls } from './calls';
import { installLooks } from './characters';
import { installWorld } from '../world/worldSpec';
import { DEFAULT_RESPECT, DEFAULT_RULES, type Respect, type Rules } from './defaults';
import type {
  Behaviour, CrimeKind, CrimeSpec, DistrictSpec, FactionSpec, FixtureSpec, FriendSpec, GameMode, InteriorLayout, InteriorPlan, MissionSpec, PedArchetype, TableSpec, VenueSpec,
  PropertySpec, RadioStation, RoleCrew, ServiceCall, ServiceSpec, StreetPropSpec, Universe, VehicleSpec, WantedLevel, WeaponPart, WeaponSpec, ZoneSpec,
} from './types';

export { CALLERS, CALLS, type Caller, type CallSituation, cleanVoice, MENTOR_CALLER, MENTOR_REMINDER_DISMISSED, namedClip, PEOPLE_CONTACTS, DEFAULT_VOICE, GANG_CALLERS, genderOf, PLAYER_LINES, PLAYER_SAYS, PLAYER_VOICES, type PlayerSituation, type Turn, type Voice, VOICE_SAMPLE, WELCOME_CALLER, YOU, youLineId } from './calls';
export { CHARACTER_LOOKS, type CharacterLast, type CharacterProgress, type CharacterSave, type CharLook, cleanLook, cleanName, DEFAULT_LOOK, LOOK_PARTS, type LookPart, MAX_CHARACTERS, NAME_PARTS } from './characters';
export type { Respect, Rules } from './defaults';
export type * from './types';

/** The installed universe's id, name and blurb (saves and characters are tagged with the id). */
export const UNIVERSE = { id: '', name: '', blurb: '', contentDir: '' };

export const VEHICLES: VehicleSpec[] = [];
export const WEAPONS: WeaponSpec[] = [];
export const PEDS: PedArchetype[] = [];
export const FACTIONS: FactionSpec[] = [];
export const ZONES: ZoneSpec[] = [];
export const DISTRICTS: DistrictSpec[] = [];
export const SERVICES: ServiceSpec[] = [];
export const PROPERTIES: PropertySpec[] = [];
export const INTERIOR_PLANS: Partial<Record<InteriorLayout, InteriorPlan>> = {};
export const MISSIONS: MissionSpec[] = [];
export const MODES: GameMode[] = [];
export const MARK_NAMES: string[] = [];
export const WANTED: WantedLevel[] = [];
export const CRIMES = {} as Record<CrimeKind, CrimeSpec>;
/** Felonies in record order (the order of CRIMES), with their labels. */
export const FELONIES: { kind: CrimeKind; label: string }[] = [];
export const SERVICE_CALLS = {} as { medic: ServiceCall; fire: ServiceCall };
export const ROLE_CREWS: Record<string, RoleCrew> = {};
export const RULES: Rules = { ...DEFAULT_RULES };
export const RESPECT: Respect = { ...DEFAULT_RESPECT };
export const RADIO: RadioStation[] = [];
export const PALETTE: string[] = [];
export const PALETTE_NAMES: string[] = [];
const PAINT_GROUPS = { civil: [] as number[], bright: [] as number[], dull: [] as number[] };
export const HAIR: string[] = [];
export const SHOES: string[] = [];
export const ARMOR_MODEL: WeaponPart[] = [];
/** Street furniture vehicles can knock over (world/breakables.ts places it). */
export const STREET_PROPS: StreetPropSpec[] = [];
/** Built and growing things the world places (world/fixtures.ts). */
export const FIXTURES: FixtureSpec[] = [];
/** Card and casino games (shared/games, world/tables.ts). */
export const TABLES: TableSpec[] = [];
export const VENUES: VenueSpec[] = [];
export const FRIENDS: FriendSpec[] = [];
/** Factions with respect, phones and missions. */
export const GANGS: string[] = [];
/** Archetype used for player avatars (the one whose behaviour is 'player'). */
export let PLAYER_ARCHETYPE = -1;
/** Weapon a ped always has (melee, no ammo, price 0). */
export let UNARMED = -1;

const INDEX = {
  weapon: new Map<string, number>(), vehicle: new Map<string, number>(), ped: new Map<string, number>(), zone: new Map<string, number>(),
  faction: new Map<string, number>(), service: new Map<string, number>(), property: new Map<string, number>(),
};
const LAWFUL_FACTIONS = new Set<string>();
const WITNESS_FACTIONS = new Set<string>();

const refill = <T>(dst: T[], src: T[]) => { dst.length = 0; dst.push(...src); };
const refillObj = (dst: object, src: object) => { for (const k of Object.keys(dst)) delete (dst as Record<string, unknown>)[k]; Object.assign(dst, src); };

function reindex<T extends { id: string }>(map: Map<string, number>, list: T[], kind: string): void {
  map.clear();
  list.forEach((e, i) => {
    if (map.has(e.id)) throw new Error(`duplicate ${kind} id ${e.id}`);
    map.set(e.id, i);
  });
}

const lookup = (map: Map<string, number>, kind: string) => (id: string): number => {
  const i = map.get(id);
  if (i === undefined) throw new Error(`unknown ${kind} id "${id}" (universe ${UNIVERSE.id})`);
  return i;
};

/** Makes `u` the universe this process runs. Call it before importing game code (anything that
 *  reads packs at load time); a process never switches universes after that. */
export function installUniverse(u: Universe): void {
  Object.assign(UNIVERSE, { id: u.id, name: u.name, blurb: u.blurb, contentDir: u.contentDir });
  refill(VEHICLES, u.vehicles); refill(WEAPONS, u.weapons); refill(PEDS, u.peds); refill(FACTIONS, u.factions);
  refill(ZONES, u.zones); refill(DISTRICTS, u.districts); refill(SERVICES, u.services); refill(PROPERTIES, u.properties);
  refillObj(INTERIOR_PLANS, u.interiorPlans);
  refill(MISSIONS, u.missions); refill(MODES, u.modes); refill(MARK_NAMES, u.markNames); refill(WANTED, u.wanted);
  refillObj(CRIMES, u.crimes);
  refill(FELONIES, (Object.entries(u.crimes) as [CrimeKind, CrimeSpec][]).filter(([, c]) => c.felony).map(([kind, c]) => ({ kind, label: c.felony! })));
  refillObj(SERVICE_CALLS, u.serviceCalls);
  refillObj(ROLE_CREWS, u.roleCrews);
  refillObj(RULES, { ...DEFAULT_RULES, ...u.rules });
  refillObj(RESPECT, { ...DEFAULT_RESPECT, ...u.respect });
  refill(RADIO, u.radio);
  refill(PALETTE, u.palette.colors); refill(PALETTE_NAMES, u.palette.names);
  PAINT_GROUPS.civil = u.palette.civil; PAINT_GROUPS.bright = u.palette.bright; PAINT_GROUPS.dull = u.palette.dull;
  refill(HAIR, u.pedColors.hair); refill(SHOES, u.pedColors.shoes);
  refill(ARMOR_MODEL, u.armorModel);
  refill(STREET_PROPS, u.streetProps);
  refill(FIXTURES, u.fixtures ?? []);
  refill(TABLES, u.tables ?? []); refill(VENUES, u.venues ?? []); refill(FRIENDS, u.friends ?? []);
  reindex(INDEX.weapon, WEAPONS, 'weapon'); reindex(INDEX.vehicle, VEHICLES, 'vehicle'); reindex(INDEX.ped, PEDS, 'ped');
  reindex(INDEX.zone, ZONES, 'zone'); reindex(INDEX.faction, FACTIONS, 'faction'); reindex(INDEX.service, SERVICES, 'service');
  reindex(INDEX.property, PROPERTIES, 'property');
  refill(GANGS, FACTIONS.filter((f) => f.gang).map((f) => f.id));
  PLAYER_ARCHETYPE = PEDS.findIndex((p) => p.behaviour === 'player');
  UNARMED = WEAPONS.findIndex((w) => w.kind === 'melee' && w.price === 0);
  LAWFUL_FACTIONS.clear(); for (const f of FACTIONS) if (f.lawful) LAWFUL_FACTIONS.add(f.id);
  WITNESS_FACTIONS.clear(); for (const f of FACTIONS) if (f.witness) WITNESS_FACTIONS.add(f.id);
  installCalls(u);
  installLooks(u);
  installWorld(u.world);
  if (PLAYER_ARCHETYPE < 0) throw new Error(`universe ${u.id}: no ped archetype with behaviour 'player'`);
  if (UNARMED < 0) throw new Error(`universe ${u.id}: no unarmed weapon (melee, price 0)`);
}

export const weaponIndex = lookup(INDEX.weapon, 'weapon');
export const vehicleIndex = lookup(INDEX.vehicle, 'vehicle');
export const pedIndex = lookup(INDEX.ped, 'ped');
export const zoneIndex = lookup(INDEX.zone, 'zone');
export const factionIndex = lookup(INDEX.faction, 'faction');
export const serviceIndex = lookup(INDEX.service, 'service');
export const propertyIndex = lookup(INDEX.property, 'property');

export const weapon = (id: string): WeaponSpec => WEAPONS[weaponIndex(id)];
export const vehicle = (id: string): VehicleSpec => VEHICLES[vehicleIndex(id)];
export const ped = (id: string): PedArchetype => PEDS[pedIndex(id)];
export const zone = (id: string): ZoneSpec => ZONES[zoneIndex(id)];
export const faction = (id: string): FactionSpec => FACTIONS[factionIndex(id)];
export const service = (id: string): ServiceSpec => SERVICES[serviceIndex(id)];
export const property = (id: string): PropertySpec => PROPERTIES[propertyIndex(id)];

/** Colours a vehicle may spawn in: its own list, or one of the universe's paint groups. */
export function paletteFor(colors: number[] | 'civil' | 'bright' | 'dull'): number[] {
  return typeof colors === 'string' ? PAINT_GROUPS[colors] : colors;
}

/** The first ped archetype with this behaviour (-1 if the pack has none). */
export const pedWith = (b: Behaviour): number => PEDS.findIndex((p) => p.behaviour === b);

/** Factions whose members enforce the law (`lawful`). */
export const lawfulFaction = (id: string): boolean => LAWFUL_FACTIONS.has(id);
export const witnessFaction = (id: string): boolean => WITNESS_FACTIONS.has(id);

export function hostile(a: string, b: string): boolean {
  return faction(a).hostile.includes(b) || faction(b).hostile.includes(a);
}

installUniverse(DEFAULT_UNIVERSE);
