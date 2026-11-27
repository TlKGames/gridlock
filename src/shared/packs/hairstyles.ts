// Box dimensions and centres in the player model's coordinates (+X faces forward).
export type HairBox = [depth: number, height: number, width: number, x: number, y: number, z: number];
const crown: HairBox = [0.27, 0.07, 0.25, -0.01, 1.87, 0];
const nape: HairBox = [0.08, 0.18, 0.25, -0.12, 1.74, 0];
const longBack: HairBox = [0.09, 0.34, 0.26, -0.12, 1.66, 0];
function sides(length: number): HairBox[] {
  return [-0.118, 0.118].map(z => [0.217, length, 0.045, -0.019, 1.85 - length / 2, z]);
}

// Step each short cut down from the crown, leaving a higher hairline over the
// ear and a lower one at the temple. Mirrored pieces cover both side faces.
function taperedSides(temple: number, behindEar: number): HairBox[] {
  return [-0.118, 0.118].flatMap(z => [
    [0.052, temple, 0.029, 0.078, 1.854 - temple / 2, z],
    [0.103, temple * 0.7, 0.03, 0.001, 1.854 - temple * 0.35, z],
    [0.081, behindEar, 0.032, -0.09, 1.854 - behindEar / 2, z],
  ] as HairBox[]);
}

// Saved looks store these indices. Keep the original short, long and shaved slots first.
export const HAIRSTYLES: { name: string; pieces: HairBox[] }[] = [
  { name: 'Crew Cut', pieces: [crown, nape, ...taperedSides(0.105, 0.14)] },
  { name: 'Long Straight', pieces: [crown, longBack, ...sides(0.32)] },
  { name: 'Clean Shave', pieces: [] },
  { name: 'Side Part', pieces: [crown, nape, ...taperedSides(0.15, 0.17), [0.24, 0.045, 0.15, 0.014, 1.92, -0.04], [0.045, 0.07, 0.09, 0.123, 1.84, -0.067]] },
  { name: 'Pompadour', pieces: [crown, nape, ...taperedSides(0.12, 0.16), [0.17, 0.12, 0.235, 0.058, 1.947, 0], [0.10, 0.06, 0.21, -0.063, 1.922, 0]] },
  { name: 'Flat Top', pieces: [[0.244, 0.14, 0.228, -0.004, 1.906, 0], nape, ...taperedSides(0.09, 0.12)] },
  { name: 'Blunt Bob', pieces: [crown, [0.09, 0.25, 0.263, -0.121, 1.737, 0], ...sides(0.22), [0.043, 0.07, 0.235, 0.127, 1.825, 0]] },
  { name: 'High Bun', pieces: [crown, nape, ...taperedSides(0.12, 0.18), [0.145, 0.13, 0.15, -0.10, 1.954, 0]] },
  { name: 'High Ponytail', pieces: [crown, nape, ...taperedSides(0.125, 0.17), [0.13, 0.09, 0.11, -0.167, 1.869, 0], [0.092, 0.32, 0.103, -0.206, 1.718, 0]] },
  { name: 'Twin Braids', pieces: [crown, nape, ...taperedSides(0.145, 0.18), ...[-0.113, 0.113].flatMap(z => [
    [0.095, 0.135, 0.078, -0.071, 1.76, z], [0.083, 0.12, 0.067, -0.056, 1.64, z],
    [0.063, 0.085, 0.054, -0.042, 1.543, z],
  ] as HairBox[])] },
];

// Let the hat cover the crown while leaving hair below its band visible.
export function visibleHair(style: number, hat: boolean): HairBox[] {
  const pieces = HAIRSTYLES[style].pieces;
  if (!hat) return pieces;
  const band = 1.836;
  return pieces.flatMap(([d, h, w, x, y, z]) => {
    const bottom = y - h / 2, top = Math.min(y + h / 2, band);
    return top > bottom ? [[d, top - bottom, w, x, (top + bottom) / 2, z] as HairBox] : [];
  });
}
