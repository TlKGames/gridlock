// The aisle runs straight in from the street. The same dimensions govern the
// generated parking poses, painted bay boundaries, and the driveway opening.
import { DIR_VEC, type Lot, type ParkSpot } from './cityTypes';

export const BAY_WIDTH = 2.9, BAY_DEPTH = 5.4, DRIVE_WIDTH = 5;

export function lotLayout(lot: Lot) {
  if (lot.use !== 'parking' || lot.front === -1) return;
  const [fx, fy] = DIR_VEC[lot.front], r = lot.rect;
  const width = (fx ? r.y1 - r.y0 : r.x1 - r.x0) - 3;
  const length = (fx ? r.x1 - r.x0 : r.y1 - r.y0) - 3;
  const rows = Math.min(2, Math.floor((width - DRIVE_WIDTH) / BAY_DEPTH));
  const count = Math.floor(length / BAY_WIDTH);
  if (rows < 1 || count < 1) return;
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const offset = rows === 1 ? BAY_DEPTH / 2 : 0;
  const x = cx + fx * (length + 3) / 2 - fy * offset;
  const y = cy + fy * (length + 3) / 2 + fx * offset;
  return { x, y, fx, fy, rows, count, length };
}

export function lotStalls(lot: Lot): ParkSpot[] {
  const a = lotLayout(lot);
  if (!a) return [];
  const spots: ParkSpot[] = [];
  for (let i = 0; i < a.count; i++) {
    const along = 1.5 + (a.length - a.count * BAY_WIDTH) / 2 + (i + 0.5) * BAY_WIDTH;
    for (let row = 0; row < a.rows; row++) {
      const side = row ? 1 : -1;
      const dx = -a.fy * side, dy = a.fx * side;
      const off = (DRIVE_WIDTH + BAY_DEPTH) / 2;
      spots.push({ x: a.x - along * a.fx + dx * off, y: a.y - along * a.fy + dy * off,
        angle: Math.atan2(dy, dx), zone: lot.zone, lot: lot.id });
    }
  }
  return spots;
}
