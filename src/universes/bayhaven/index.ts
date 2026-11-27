// Bayhaven: the original GRIDLOCK city. A ~2 km island of districts, three crews, the law up to
// the army. Its content (calls, voices, radio) still lives at the project's top-level content/,
// its models in src/client/models and voices in src/client/voice (see ./client.ts).
import type { CharacterFile, PlayerFile, Universe } from '../../shared/packs/types';
import benny from '../../../content/characters/benny_lutz/benny_lutz.json';
import danny from '../../../content/characters/danny_keogh/danny_keogh.json';
import declan from '../../../content/characters/declan_rourke/declan_rourke.json';
import eleni from '../../../content/characters/eleni_kouris/eleni_kouris.json';
import price from '../../../content/characters/harlan_price/harlan_price.json';
import andreou from '../../../content/characters/kostas_andreou/kostas_andreou.json';
import lupe from '../../../content/characters/lupe_reyes/lupe_reyes.json';
import nico from '../../../content/characters/nico_reyes/nico_reyes.json';
import kowalski from '../../../content/characters/ray_kowalski/ray_kowalski.json';
import player from '../../../content/player/player.json';
import { INTERIOR_PLANS } from './interiorPlans';
import { MARK_NAMES, MISSIONS, MODES } from './missions';
import { BRIGHT, CIVIL, DULL, PALETTE, PALETTE_NAMES } from './palette';
import { FACTIONS, HAIR, PEDS, SHOES, SKIN } from './peds';
import { PROPERTIES, SERVICES } from './places';
import { RADIO } from './radio';
import { STREET_PROPS } from './streetProps';
import { CRIMES, RESPECT, ROLE_CREWS, RULES, SERVICE_CALLS, WANTED } from './rules';
import { VEHICLES } from './vehicles';
import { FRIENDS, TABLES, VENUES } from './tables';
import { ARMOR_MODEL } from './weaponModels';
import { WEAPONS } from './weapons';
import { DISTRICTS, ZONES } from './zones';

const cast = ([
  ['benny_lutz', benny], ['nico_reyes', nico], ['lupe_reyes', lupe], ['declan_rourke', declan], ['danny_keogh', danny],
  ['eleni_kouris', eleni], ['kostas_andreou', andreou], ['ray_kowalski', kowalski], ['harlan_price', price],
] as [string, unknown][]).map(([folder, json]): [string, CharacterFile] => [folder, json as CharacterFile]);

export const BAYHAVEN: Universe = {
  id: 'bayhaven',
  name: 'Bayhaven',
  blurb: 'A harbour city run by three crews. Cars, cops, payphones and property.',
  contentDir: 'content',
  vehicles: VEHICLES,
  weapons: WEAPONS,
  peds: PEDS,
  factions: FACTIONS,
  zones: ZONES,
  districts: DISTRICTS,
  services: SERVICES,
  properties: PROPERTIES,
  interiorPlans: INTERIOR_PLANS,
  missions: MISSIONS,
  modes: MODES,
  markNames: MARK_NAMES,
  wanted: WANTED,
  crimes: CRIMES,
  serviceCalls: SERVICE_CALLS,
  roleCrews: ROLE_CREWS,
  rules: RULES,
  respect: RESPECT,
  radio: RADIO,
  palette: { colors: PALETTE, names: PALETTE_NAMES, civil: CIVIL, bright: BRIGHT, dull: DULL },
  pedColors: { hair: HAIR, shoes: SHOES },
  looks: {
    skin: SKIN,
    hair: HAIR,
    hairStyle: ['Short', 'Long', 'Shaved'],
    top: ['#f2f2ee', '#16171a', '#c62a22', '#1f5bff', '#2bb34a', '#e3b30c', '#8a6db0', '#e04e8c', '#d9661b', '#5c7fa3', '#6b5a45', '#9aa5ad'],
    bottom: ['#2c3e57', '#16171a', '#3a3a3a', '#6b5a45', '#e8e2d0', '#25324a', '#7a7466', '#5a1e14'],
    hat: ['', '#16171a', '#c62a22', '#1f5bff', '#e8e2d0', '#e3b30c', '#3c3f2e'],
  },
  defaultLook: { skin: 0, hair: 1, hairStyle: 0, top: 0, bottom: 0, hat: 0 },
  nameParts: {
    first: ['Ace', 'Benny', 'Carmen', 'Dax', 'Eddie', 'Frankie', 'Gigi', 'Hector', 'Ivy', 'Jojo', 'Kat', 'Lou', 'Mack', 'Nico',
      'Ozzy', 'Pia', 'Quinn', 'Rocco', 'Sal', 'Tess', 'Vinnie', 'Wren', 'Yuri', 'Zed', 'Remy', 'Lola', 'Marco', 'Dina', 'Tito', 'Bea'],
    last: ['Moretti', 'Kane', 'Vega', 'Doyle', 'Sloane', 'Petrov', 'Reyes', 'Malone', 'Okafor', 'Brandt', 'Falco', 'Quill', 'Hale',
      'Navarro', 'Cruz', 'Byrne', 'Kovac', 'Laine', 'Price', 'Russo', 'Stone', 'Tran', 'Voss', 'Wilde', 'Ziegler', 'Marsh'],
  },
  armorModel: ARMOR_MODEL,
  streetProps: STREET_PROPS,
  tables: TABLES,
  venues: VENUES,
  friends: FRIENDS,
  // The island's map is the default (worldSpec.ts), plus the L: an elevated railway north-south
  // through town, two trains of three cars.
  world: {
    railway: { style: 'elevated', axis: 'v', at: 0.3, stationEvery: 3, trains: 2, cars: 3, car: 'metro', speed: 16, dwell: 9, stationName: 'Station' },
  },
  cast,
  player: player as unknown as PlayerFile,
};
