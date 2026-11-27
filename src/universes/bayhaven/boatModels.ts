import { b, p } from './modelParts';
import type { Part } from '../../shared/packs/types';

// Boats. Side profiles run from the stern (x -0.5) to a raked bow (+0.5), z from the keel (0) up;
// the plan-view shape (vehicles.ts) draws the bow to a point. The renderer sits each hull down in
// the water to its waterline (render/boats.ts).

/** An open speedboat: low hull, windscreen, two seats in the cockpit, an outboard on the transom. */
export const speedboat = (): Part[] => [
  // The extrusion bevel raises the hull top. Keep it inside the white gunwale.
  p([[-0.5, 0.0], [0.22, 0.0], [0.5, 0.42], [0.5, 0.50], [-0.5, 0.50]], -0.5, 0.5, 'body'),
  b(-0.5, 0.48, -0.5, 0.5, 0.52, 0.56, 'white'),            // gunwale
  b(-0.42, 0.06, -0.4, 0.4, 0.53, 0.58, '#2b2f34'),         // cockpit sole
  b(0.08, 0.14, -0.42, 0.42, 0.56, 0.86, 'glass'),          // windscreen
  b(-0.08, 0.02, -0.34, -0.06, 0.56, 0.74, 'trim'),         // seats
  b(-0.08, 0.02, 0.06, 0.34, 0.56, 0.74, 'trim'),
  b(-0.4, -0.26, -0.36, 0.36, 0.56, 0.7, 'trim'),           // stern bench
  b(-0.57, -0.47, -0.12, 0.12, 0.28, 0.92, 'dark'),         // outboard
  b(-0.5, 0.3, -0.505, 0.505, 0.3, 0.36, 'white'),          // boot stripe
];

/** A small open skiff: a tiller outboard, two thwarts. */
export const skiff = (): Part[] => [
  // The bevel adds 0.04 of hull height. Let the floorboards cover it and the benches sit above them.
  p([[-0.5, 0.0], [0.3, 0.0], [0.5, 0.56], [0.5, 0.60], [-0.5, 0.60]], -0.5, 0.5, 'body'),
  b(-0.46, 0.34, -0.42, 0.42, 0.62, 0.66, '#3a3f44'),       // floorboards
  b(-0.12, -0.02, -0.42, 0.42, 0.66, 0.74, 'trim'),         // thwarts
  b(0.18, 0.26, -0.42, 0.42, 0.66, 0.74, 'trim'),
  b(-0.6, -0.48, -0.1, 0.1, 0.4, 1.0, 'dark'),              // outboard
];

/** A cabin cruiser: white hull, teak deck, a cabin with a windscreen and a flybridge rail. */
export const cruiser = (): Part[] => [
  p([[-0.5, 0.0], [0.26, 0.0], [0.5, 0.32], [0.5, 0.36], [-0.5, 0.36]], -0.5, 0.5, 'white'),
  b(-0.5, 0.4, -0.505, 0.505, 0.18, 0.27, 'body'),          // hull band
  b(-0.5, 0.46, -0.48, 0.48, 0.38, 0.41, '#b89a6a'),        // teak deck
  p([[-0.3, 0.4], [0.18, 0.4], [0.3, 0.62], [0.0, 0.64], [-0.3, 0.64]], -0.38, 0.38, 'white'), // cabin
  b(-0.26, 0.24, -0.385, 0.385, 0.48, 0.58, 'glass'),       // cabin windows
  b(0.18, 0.28, -0.34, 0.34, 0.5, 0.62, 'glass'),           // windscreen
  b(-0.28, -0.04, -0.3, 0.3, 0.664, 0.72, 'trim'),           // flybridge rail
  b(-0.54, -0.5, -0.4, 0.4, 0.12, 0.17, '#b89a6a'),         // swim platform
];
