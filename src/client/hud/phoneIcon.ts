// The ringing-payphone icon: a handset on a disc in the gang's colour, used by the radar, the city
// map and the payphone's own sign.

/** A telephone handset (earpiece and mouthpiece joined by a curved grip), centred on (x, y). */
export function handset(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(-Math.PI / 4);
  g.strokeStyle = color; g.fillStyle = color;
  g.lineWidth = r * 0.32; g.lineCap = 'round';
  g.beginPath(); g.arc(0, r * 0.55, r * 0.95, Math.PI * 1.22, Math.PI * 1.78); g.stroke();
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * r * 0.62, -r * 0.08, r * 0.3, r * 0.2, s * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** A ringing phone on a map: gang-coloured disc, dark handset, throbbing in time with the rings
 *  pulsing out of it (two at once, staggered, out to three times its size) so it can't be missed. */
export function phoneBlip(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, now = performance.now()): void {
  const PERIOD = 1100;
  g.save();
  for (const lag of [0, 0.5]) {
    const t = ((now / PERIOD + lag) % 1);
    // Bright most of the way out, fading only at the end.
    const rr = r * (1.05 + t * 2.3), a = Math.min(1, (1 - t) * 1.6);
    // A dark edge under each ring keeps it readable on any ground.
    g.globalAlpha = a * 0.6; g.strokeStyle = '#000'; g.lineWidth = 5.5;
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = a; g.strokeStyle = color; g.lineWidth = 3.2;
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
  }
  // A soft halo, brightest as each ring leaves.
  const beat = 0.5 + 0.5 * Math.cos(((now % PERIOD) / PERIOD) * Math.PI * 2);
  g.globalAlpha = 0.25 + beat * 0.25; g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r * 1.45, 0, Math.PI * 2); g.fill();
  g.restore();
  const s = r * (1 + beat * 0.16);
  g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); g.stroke();
  handset(g, x, y + s * 0.08, s * 0.62, '#111');
}
