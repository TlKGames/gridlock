// Redrock Territory's places: the gunsmith, the livery stable (horses and wagons for sale), the
// doctor, the sheriff's office (cells: the engine's precinct plan), the bank (vault), the fort; and
// what a player can own: homesteads and cabins, the saloon, the general store, the hotel.
import type { PropertySpec, ServiceSpec } from '../../shared/packs/types';

const GUNS = ['knife', 'hatchet', 'derringer', 'revolver', 'shotgun', 'lever_rifle', 'long_rifle', 'dynamite', 'lamp_oil'];

export const SERVICES: ServiceSpec[] = [
  { id: 'gunsmith', name: 'Gunsmith', verb: 'gunshop', zones: ['town'], count: 3, sign: '#5a3a20', signText: 'GUNSMITH', stock: GUNS, interior: 'shop',
    robbery: { till: 60, fightBack: 0.5 } },
  { id: 'livery', name: 'Livery Stable', verb: 'dealer', zones: ['town', 'homesteads'], count: 3, sign: '#7a5a3a', signText: 'LIVERY',
    stock: ['mule', 'indian_pony', 'draft_horse', 'quarter_horse', 'mustang', 'morgan', 'arabian', 'thoroughbred', 'buckboard', 'covered_wagon'] },
  { id: 'doctor', name: "Doctor's Office", verb: 'hospital', zones: ['town'], count: 3, sign: '#e6dcc0', signText: 'DOCTOR',
    spawns: [{ vehicle: 'doctor_buggy', count: 1 }] },
  { id: 'sheriff', name: "Sheriff's Office", verb: 'police', zones: ['town'], count: 3, sign: '#c9a227', signText: 'SHERIFF',
    spawns: [{ vehicle: 'law_horse', count: 2 }], interior: 'precinct' },
  { id: 'fire_hall', name: 'Fire Hall', verb: 'fire', zones: ['town'], count: 1, sign: '#7a2a20', signText: 'FIRE HALL',
    spawns: [{ vehicle: 'water_wagon', count: 1 }] },
  { id: 'fort_garnet', name: 'Fort Garnet', verb: 'military', zones: ['fort'], count: 1, sign: '#28324a', signText: 'FORT GARNET',
    spawns: [{ vehicle: 'cavalry_horse', count: 4 }, { vehicle: 'gatling_wagon', count: 1 }],
    guards: [{ archetype: 'trooper', count: 6 }] },
  { id: 'bank', name: 'Territorial Bank', verb: 'bank', zones: ['town'], count: 2, sign: '#3e5a3a', signText: 'BANK', interior: 'bank' },
];

export const PROPERTIES: PropertySpec[] = [
  { id: 'cabin', name: 'Cabin', kind: 'home', zones: ['homesteads'], count: 8, price: 300, income: 0, garage: 2 },
  { id: 'homestead', name: 'Homestead', kind: 'home', zones: ['homesteads'], count: 6, price: 800, income: 0, garage: 4 },
  { id: 'town_house', name: 'House in Town', kind: 'home', zones: ['town'], count: 4, price: 1200, income: 0, garage: 2 },
  { id: 'general_store', name: 'General Store', kind: 'business', zones: ['town'], count: 4, price: 900, income: 12, garage: 0, signText: 'GENERAL STORE',
    signColor: '#3e5a3a', interior: 'shop', robbery: { till: 40, fightBack: 0.3 } },
  { id: 'saloon', name: 'Saloon', kind: 'business', zones: ['town'], count: 4, price: 2500, income: 35, garage: 0, signText: 'SALOON',
    signColor: '#7a2a20', perk: 'club', interior: 'saloon', robbery: { till: 80, fightBack: 0.6 },
    // On the map: a beer mug; hover for the games it deals.
    icon: { color: '#d9a23a', glyph: 'mug', label: 'Saloon' } },
  { id: 'hotel', name: 'Hotel', kind: 'business', zones: ['town'], count: 2, price: 4000, income: 55, garage: 0, signText: 'HOTEL',
    signColor: '#b8902e', interior: 'diner', robbery: { till: 60, fightBack: 0.3 } },
  { id: 'barn', name: 'Barn', kind: 'business', zones: ['homesteads'], count: 3, price: 1500, income: 18, garage: 0, signText: 'FEED & GRAIN',
    signColor: '#7a3a2a', perk: 'fence', interior: 'warehouse' },
];
