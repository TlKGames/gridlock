// Redrock Territory: an original frontier territory in the 1870s. Three timber towns on wide dirt
// streets, homesteads, open prairie and red badlands walled in by cliffs, a river with two
// crossings; horses and wagons; three outlaw outfits; deputies, marshals and the cavalry.
// No phones: the outfits post their work on job posts (a brief, no call), and their riders in town
// give it face to face. Its cast (content/redrock/characters) is the people you can walk up and
// talk to, shown in bubbles, not voiced yet; the player's side is its own (content/redrock/player).
import player from '../../../content/redrock/player/player.json';
import bankGuard from '../../../content/redrock/characters/bank_guard/bank_guard.json';
import dryCreek from '../../../content/redrock/characters/dry_creek_hand/dry_creek_hand.json';
import gambler from '../../../content/redrock/characters/gambler/gambler.json';
import lantern from '../../../content/redrock/characters/lantern_hand/lantern_hand.json';
import lawman from '../../../content/redrock/characters/lawman/lawman.json';
import prospector from '../../../content/redrock/characters/prospector/prospector.json';
import settler from '../../../content/redrock/characters/settler/settler.json';
import storekeeper from '../../../content/redrock/characters/storekeeper/storekeeper.json';
import townsfolk from '../../../content/redrock/characters/townsfolk/townsfolk.json';
import trooper from '../../../content/redrock/characters/trooper/trooper.json';
import vulture from '../../../content/redrock/characters/vulture_hand/vulture_hand.json';
import { INTERIOR_PLANS } from '../bayhaven/interiorPlans';
import type { CharacterFile, PlayerFile, Universe, WeaponPart } from '../../shared/packs/types';

const CAST = Object.entries({
  townsfolk, settler, prospector, storekeeper, lawman, trooper, gambler, bank_guard: bankGuard,
  dry_creek_hand: dryCreek, vulture_hand: vulture, lantern_hand: lantern,
}).map(([folder, json]): [string, CharacterFile] => [folder, json as CharacterFile]);
import { MARK_NAMES, MISSIONS, MODES } from './missions';
import { FACTIONS, HAIR, PEDS, SHOES, SKIN } from './peds';
import { PROPERTIES, SERVICES } from './places';
import { CRIMES, RESPECT, ROLE_CREWS, RULES, SERVICE_CALLS, WANTED } from './rules';
import { STREET_PROPS } from './streetProps';
import { FIXTURES } from './fixtures';
import { TABLES, VENUES } from './tables';
import { VEHICLES } from './vehicles';
import { WEAPONS } from './weapons';
import { DISTRICTS, ZONES } from './zones';

/** Paint (index = colour id): horse coats first, then wagon paint. */
const COLORS = ['#6b3e22', '#8a4a24', '#1c1a18', '#8f8f8a', '#e8e4d8', '#c9a05a', '#a88a5e', '#7a5a52',
  '#3e5a3a', '#7a2a20', '#8a7356', '#28324a', '#b8902e'];
const NAMES = ['Bay', 'Chestnut', 'Black', 'Grey', 'White', 'Palomino', 'Dun', 'Roan',
  'Wagon green', 'Barn red', 'Weathered', 'Navy', 'Coach yellow'];

/** The bank (vault) and the lockup use Bayhaven's floor plans, staffed with Redrock's people: the
 *  sheriff's desk by a deputy, the bank by its guard. */
const PLANS = Object.fromEntries(Object.entries(INTERIOR_PLANS).map(([k, p]) => [k, {
  ...p, clerkArch: p.clerkArch === 'cop' ? 'deputy' : p.clerkArch,
  guards: p.guards?.map((g) => ({ ...g, arch: g.arch === 'cop' ? 'deputy' : g.arch })),
}])) as typeof INTERIOR_PLANS;

/** A leather vest, for the gunsmith's armour rack. */
const VEST: WeaponPart[] = [
  { shape: 'box', x: [-0.18, 0.18], y: [0, 0.5], z: [-0.2, 0.2], mat: '#5a3a20' },
  { shape: 'box', x: [-0.02, 0.02], y: [0.05, 0.48], z: [-0.21, 0.21], mat: 'brass' },
];

export const REDROCK: Universe = {
  id: 'redrock',
  name: 'Redrock Territory',
  blurb: 'An 1870s frontier territory: timber towns, prairie and badlands, horses, outlaws and the law.',
  contentDir: 'content/redrock',
  world: {
    size: 2560, margin: 60, edge: 'cliffs', river: { at: 0.42, width: 40 },
    spacing: { near: 84, far: 150 }, arterialEvery: 3, ground: '#c4a274', modern: false,
    // People drawn the size they ride at, true to the horses beside them.
    pedScale: 1.1,
    // Real land in open country: rolling prairie, mesas and canyons in the badlands; the towns
    // stand on the flat.
    terrain: { scale: 0.9 },
    // The railroad: one track down the middle of an east-west street (a Front Street), a depot in
    // each town it passes; a locomotive at each end of the train, two coaches between.
    railway: { style: 'grade', axis: 'h', at: 0.55, offset: 0, stationEvery: 3, trains: 1, cars: 4, car: 'coach', ends: 'locomotive',
      speed: 11, dwell: 14, stationName: 'Depot' },
  },
  vehicles: VEHICLES,
  weapons: WEAPONS,
  peds: PEDS,
  factions: FACTIONS,
  zones: ZONES,
  districts: DISTRICTS,
  services: SERVICES,
  properties: PROPERTIES,
  interiorPlans: PLANS,
  missions: MISSIONS,
  modes: MODES,
  markNames: MARK_NAMES,
  wanted: WANTED,
  crimes: CRIMES,
  serviceCalls: SERVICE_CALLS,
  roleCrews: ROLE_CREWS,
  rules: RULES,
  respect: RESPECT,
  radio: [],
  palette: { colors: COLORS, names: NAMES, civil: [0, 1, 2, 3, 6, 7], bright: [4, 5, 8, 9, 12], dull: [2, 3, 6, 10] },
  pedColors: { hair: HAIR, shoes: SHOES },
  looks: {
    skin: SKIN,
    hair: HAIR,
    hairStyle: ['Short', 'Long', 'Shaved'],
    top: ['#e6dcc0', '#c9b48a', '#8a6a4a', '#5a6a7a', '#7a3a2a', '#1a1612', '#4a5a3a', '#9a8a6a', '#d9a62b', '#28324a'],
    bottom: ['#3a3024', '#4a3a2a', '#2a2a30', '#5a4a3a', '#6a5a44', '#1a1612'],
    hat: ['', '#4a3a2a', '#2a2018', '#8a6a4a', '#c9b48a', '#1a1612', '#e6dcc0'],
  },
  defaultLook: { skin: 0, hair: 1, hairStyle: 0, top: 1, bottom: 0, hat: 1 },
  nameParts: {
    first: ['Abe', 'Clem', 'Cora', 'Eli', 'Etta', 'Hattie', 'Jeb', 'Josiah', 'Lottie', 'Mabel', 'Ned', 'Orrin', 'Percy', 'Ruth',
      'Silas', 'Tobias', 'Wade', 'Zeke', 'Nell', 'Amos', 'Belle', 'Cyrus', 'Dell', 'Ezra', 'Ida', 'Luke', 'Mattie', 'Rufus'],
    last: ['Bright', 'Dunn', 'Fairbanks', 'Grady', 'Holt', 'Keene', 'Larkin', 'Pruitt', 'Sutter', 'Tate', 'Vance', 'Wheeler',
      'Yancey', 'Corbin', 'Ashby', 'Pike', 'Hatch', 'Merritt', 'Coley', 'Bram', 'Starling', 'Thorne'],
  },
  armorModel: VEST,
  streetProps: STREET_PROPS,
  fixtures: FIXTURES,
  tables: TABLES,
  venues: VENUES,
  cast: CAST,
  player: player as unknown as PlayerFile,
};
