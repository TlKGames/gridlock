// Redrock Territory's land: three towns of timber false-fronts on wide dirt streets, homesteads
// round them, open prairie with ponds and outcrops, red badlands of buttes to the east, and the
// cavalry's fort. Prairie and badlands are open country (layout 'wild'): trails cross them on the
// arterial lines.
import type { DistrictSpec, WeightedId, ZoneSpec } from '../../shared/packs/types';

const riders: WeightedId[] = [{ id: 'quarter_horse', weight: 5 }, { id: 'mustang', weight: 3 }, { id: 'morgan', weight: 2 },
  { id: 'indian_pony', weight: 1 }, { id: 'mule', weight: 1 }, { id: 'buckboard', weight: 2 }];
const tied: WeightedId[] = [{ id: 'quarter_horse', weight: 5 }, { id: 'mustang', weight: 3 }, { id: 'morgan', weight: 2 },
  { id: 'draft_horse', weight: 2 }, { id: 'mule', weight: 1.5 }, { id: 'indian_pony', weight: 1 }, { id: 'arabian', weight: 0.4 },
  { id: 'thoroughbred', weight: 0.4 }, { id: 'buckboard', weight: 1.5 }];
const lawRide: WeightedId = { id: 'law_horse', weight: 1.2 };
const folk: WeightedId[] = [{ id: 'townsfolk', weight: 10 }, { id: 'rancher', weight: 3 }, { id: 'prospector', weight: 1.5 }];
const ROCK = ['#a8644a', '#9a5a3e', '#b8785a', '#8a4e36'];
const noLot = { min: 999, max: 999, setback: [0, 0] as [number, number], height: [0, 0] as [number, number], coverage: 0 };

export const ZONES: ZoneSpec[] = [
  {
    id: 'town', name: 'Town', mapColor: '#7a5a3a', ground: '#a88a62', sidewalk: '#7a5c3c',
    // Lots deep enough for a livery's or the sheriff's yard out front (a pad needs ~22 m of depth).
    lot: { min: 14, max: 28, setback: [0, 1.5], height: [4.5, 9], coverage: 0.85 }, layout: 'buildings',
    wall: ['#8a6a4a', '#a07a52', '#6e5238', '#b89a72', '#9a5a3a', '#cfc2a2', '#7a6a5a'], roof: ['#5a4632', '#4a3a2a', '#6a5642'],
    trees: 0.05, parkingChance: 0.04, plazaChance: 0.05, pedDensity: 6,
    peds: [...folk, { id: 'gambler', weight: 0.6 }, { id: 'deputy', weight: 0.8 }],
    trafficDensity: 0.5, traffic: [...riders, lawRide], parked: tied, parkedDensity: 1.0, roadDrop: 0.05, windows: 0.3, busy: true,
  },
  {
    id: 'homesteads', name: 'Homesteads', mapColor: '#6a6a3a', ground: '#a89a62', sidewalk: '#a89a62',
    // Claims, not suburbs: a cabin or farmhouse well back on a wide plot of open ground.
    lot: { min: 40, max: 64, setback: [8, 18], height: [3.5, 5.5], coverage: 0.4, width: [8, 14] }, layout: 'houses',
    wall: ['#8a6a4a', '#a07a52', '#cfc2a2', '#7a3a2a', '#6e5238'], roof: ['#5a4632', '#4a3a2a', '#6a5642'],
    trees: 0.25, parkingChance: 0, plazaChance: 0, pedDensity: 0.8,
    peds: [{ id: 'homesteader', weight: 6 }, { id: 'rancher', weight: 3 }],
    trafficDensity: 0.25, traffic: riders, parked: [...tied, { id: 'buckboard_standing', weight: 2 }, { id: 'cattle', weight: 3 }], parkedDensity: 0.5, roadDrop: 0.3, windows: 0.2,
  },
  {
    id: 'prairie', name: 'Prairie', mapColor: '#8a7a4a', ground: '#c4a274', sidewalk: '#c4a274', lot: noLot, layout: 'wild',
    wild: { rocks: 0.5, rockSize: [6, 18], rockHeight: [2.5, 8], rockColor: ROCK, ponds: 0.12, pondSize: [10, 28],
      ground: ['#b5a06a', '#d0b07e', '#a89a62', '#c8b48a', '#9a9a5a'], trail: '#9a7a52',
      // Rolling grass and sage: gentle swells, pale sandy washes, drier tops.
      relief: 17, low: '#c9b47c', high: '#9a945c', boulders: 1.5,
      brush: { density: 1.1, colors: ['#7a8a5a', '#6a7a4a', '#8a8a62', '#5e6a42'], size: [0.8, 2.2] },
      // Rolling range with the odd low bench, and creeks cut into shallow ravines.
      mesas: { cover: 0.08, height: 7 }, gorges: { cover: 0.35, depth: 5, width: [7, 11], river: true } },
    wall: ['#888'], roof: ['#666'], trees: 0.06, parkingChance: 0, plazaChance: 0, pedDensity: 0.15,
    peds: [{ id: 'prospector', weight: 3 }, { id: 'rancher', weight: 3 }, { id: 'dry_creek_rider', weight: 0.6 }],
    trafficDensity: 0.25, traffic: [...riders, { id: 'covered_wagon', weight: 1.5 }, { id: 'stagecoach', weight: 1 }, lawRide],
    // Cattle on the open range, found by the trails, grazing off from them.
    parked: [{ id: 'cattle', weight: 1 }], parkedDensity: 0.35, roadDrop: 0, windows: 0,
  },
  {
    id: 'badlands', name: 'Badlands', mapColor: '#8a4a32', ground: '#b8785a', sidewalk: '#b8785a', lot: noLot, layout: 'wild',
    // Rock spires and hoodoos between the mesas (the mesas themselves are the land: `mesas`).
    wild: { rocks: 1.2, rockSize: [6, 18], rockHeight: [4, 14], rockColor: ROCK, ponds: 0.02, pondSize: [8, 14],
      ground: ['#b06a4a', '#c88a62', '#a85a3e', '#d0a070'], trail: '#8a5a3a',
      // Broken red country: steep rises banded in rock layers, pale sand in the washes.
      relief: 38, low: '#d6a87c', high: '#98503a', strata: ['#c88a62', '#a85a3e', '#d8b08a', '#8a4a32', '#b8785a'], boulders: 3,
      brush: { density: 0.25, colors: ['#7a7a52', '#6a6a4a', '#8a7a5a'], size: [0.6, 1.6] },
      // Mesas behind sheer red walls, and canyons cut deep with a river at the bottom.
      mesas: { cover: 0.3, height: 16 }, gorges: { cover: 0.6, depth: 12, width: [10, 17], river: true } },
    wall: ['#888'], roof: ['#666'], trees: 0.01, parkingChance: 0, plazaChance: 0, pedDensity: 0.1,
    peds: [{ id: 'vulture', weight: 3 }, { id: 'prospector', weight: 2 }],
    trafficDensity: 0.12, traffic: [{ id: 'mustang', weight: 3 }, { id: 'covered_wagon', weight: 1 }],
    parked: tied, parkedDensity: 0, roadDrop: 0, windows: 0,
  },
  {
    id: 'fort', name: 'Fort Garnet', mapColor: '#4a5238', ground: '#a89a72', sidewalk: '#8a7a5a',
    lot: { min: 24, max: 40, setback: [5, 8], height: [4, 7], coverage: 0.4 }, layout: 'compound',
    wall: ['#7a6a52', '#8a7a5a'], roof: ['#4a4e3a', '#55584a'],
    trees: 0.05, parkingChance: 0.3, plazaChance: 0, pedDensity: 2,
    peds: [{ id: 'trooper', weight: 10 }],
    trafficDensity: 0.2, traffic: [{ id: 'cavalry_horse', weight: 4 }], parked: [{ id: 'cavalry_horse', weight: 3 }],
    parkedDensity: 0.6, roadDrop: 0, fenced: true, windows: 0.1,
    // A log palisade round timber barracks and stables.
    perimeter: { color: '#6a4a2e', h: 4.2 }, compoundKind: 'block',
  },
];

// Each block takes the zone of its nearest district (x, y are 0..1; a bigger weight reaches further).
// Towns are small and far apart; prairie and badlands fill the territory between them.
export const DISTRICTS: DistrictSpec[] = [
  { name: 'Sulphur Springs', zone: 'town', x: 0.47, y: 0.5, weight: 0.36 },
  { name: 'Copper Gulch', zone: 'town', x: 0.22, y: 0.24, weight: 0.3, gang: 'dry_creek' },
  { name: 'Calloway', zone: 'town', x: 0.74, y: 0.76, weight: 0.3, gang: 'lantern' },
  { name: 'Mill Flats', zone: 'homesteads', x: 0.4, y: 0.62, weight: 0.4 },
  { name: 'Brannock Farms', zone: 'homesteads', x: 0.58, y: 0.36, weight: 0.4 },
  { name: 'Gulch Road', zone: 'homesteads', x: 0.3, y: 0.34, weight: 0.32 },
  { name: 'Calloway Fields', zone: 'homesteads', x: 0.64, y: 0.68, weight: 0.32 },
  { name: 'Fort Garnet', zone: 'fort', x: 0.86, y: 0.16, weight: 0.42 },
  { name: 'Long Grass', zone: 'prairie', x: 0.15, y: 0.6, weight: 1.3 },
  { name: 'Sage Plain', zone: 'prairie', x: 0.35, y: 0.85, weight: 1.3 },
  { name: 'Coyote Flats', zone: 'prairie', x: 0.55, y: 0.15, weight: 1.2 },
  { name: 'Hollow Creek', zone: 'prairie', x: 0.12, y: 0.1, weight: 1.1 },
  { name: 'Wide Meadow', zone: 'prairie', x: 0.62, y: 0.92, weight: 1.1 },
  { name: 'Red Mesas', zone: 'badlands', x: 0.88, y: 0.45, weight: 1.3, gang: 'vultures' },
  { name: 'Vulture Ridge', zone: 'badlands', x: 0.92, y: 0.85, weight: 1.0, gang: 'vultures' },
  { name: 'Broken Hills', zone: 'badlands', x: 0.7, y: 0.3, weight: 0.9 },
];
