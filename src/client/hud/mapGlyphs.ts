// Glyphs drawn on map pins (a pack names one in PropertySpec.icon; any other string is drawn as
// text). Each draws centred on (x, y) inside a pin of radius r, in the pin's ink colour.

type Draw = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string) => void;

/** A beer mug: the glass, its handle, a head of foam. */
const mug: Draw = (ctx, x, y, r, ink) => {
  const w = r * 0.78, h = r * 0.95, x0 = x - w * 0.62, y0 = y - h * 0.42;
  ctx.fillStyle = ink;
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1.2, r * 0.17);
  ctx.beginPath(); ctx.arc(x0 + w, y0 + h * 0.48, h * 0.26, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.fillStyle = '#fff6e0';
  ctx.beginPath(); ctx.ellipse(x0 + w / 2, y0, w * 0.6, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
};

const GLYPHS: Record<string, Draw> = { mug };

/** Draws a glyph: a drawn one by name, else the text itself. */
export function drawGlyph(ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, r: number, font: string, ink = '#111'): void {
  const d = GLYPHS[glyph];
  if (d) { d(ctx, x, y, r, ink); return; }
  ctx.fillStyle = ink;
  ctx.font = `800 ${Math.round(r * 1.15)}px ${font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y + 0.5);
}

/** The same glyph as a small canvas, for the legend. */
export function glyphCanvas(color: string, glyph: string, font: string, size = 18): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); g.fill(); g.stroke();
  drawGlyph(g, glyph, size / 2, size / 2, size / 2 - 1, font);
  c.style.width = c.style.height = `${size}px`;
  return c;
}
