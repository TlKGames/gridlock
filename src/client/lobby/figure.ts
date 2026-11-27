// Front-view figure of a character look, drawn on a canvas (lobby cards and the creator preview).
import { HAIRSTYLES, type HairBox } from '../../shared/packs/hairstyles';
import { CHARACTER_LOOKS, type CharLook } from '../../shared/packs';

/** Draws on a 10 × 20 unit grid scaled to the canvas. */
export function drawFigure(c: HTMLCanvasElement, look: CharLook): void {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const L = CHARACTER_LOOKS;
  const skin = L.skin[look.skin], top = L.top[look.top], bottom = L.bottom[look.bottom], hair = L.hair[look.hair], hat = L.hat[look.hat];
  const u = Math.min(c.width / 10, c.height / 20);
  const ox = (c.width - 10 * u) / 2;
  ctx.clearRect(0, 0, c.width, c.height);
  const r = (x0: number, y0: number, x1: number, y1: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(ox + x0 * u, y0 * u, (x1 - x0) * u, (y1 - y0) * u);
  };
  r(3, 12, 4.8, 19.2, bottom); r(5.2, 12, 7, 19.2, bottom);       // legs
  r(2.8, 19.2, 4.9, 20, '#141414'); r(5.1, 19.2, 7.2, 20, '#141414'); // shoes
  r(2.6, 6.6, 7.4, 12.3, top);                                     // torso
  r(1.4, 6.9, 2.6, 11.2, top); r(7.4, 6.9, 8.6, 11.2, top);        // arms
  r(1.5, 11.2, 2.5, 12.2, skin); r(7.5, 11.2, 8.5, 12.2, skin);    // hands
  r(2.6, 11.6, 7.4, 12.3, '#2a2622');                              // belt
  r(4.3, 5.6, 5.7, 6.7, skin);                                     // neck
  // Project the hair pieces from the front, with the head occluding the nape.
  const hairPieces = hat ? [] : HAIRSTYLES[look.hairStyle].pieces;
  const strand = ([, h, w, , y, z]: HairBox) =>
    r(5 - (z + w / 2) * 15, 4 - (y + h / 2 - 1.72) * 13.3,
      5 - (z - w / 2) * 15, 4 - (y - h / 2 - 1.72) * 13.3, hair);
  for (const piece of hairPieces) if (piece[3] + piece[0] / 2 <= 0.135) strand(piece);
  r(3.2, 2.2, 6.8, 5.8, skin);
  r(3.9, 3.5, 4.4, 3.9, '#29221f'); r(5.6, 3.5, 6.1, 3.9, '#29221f');
  r(4.65, 4.78, 5.35, 4.99, 'rgba(45,25,20,0.48)');
  for (const piece of hairPieces) if (piece[3] + piece[0] / 2 > 0.135) strand(piece);
  if (hat) {
    r(3.1, 0.6, 6.9, 2.2, hat);
    r(2.6, 1.9, 7.4, 2.6, hat);
  }
}

export function figureCanvas(look: CharLook, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  c.className = 'figure';
  drawFigure(c, look);
  return c;
}
