// What's printed on a game table's felt (render/gameTables.ts lays it over the model's `felt`
// plate): a poker table's betting line and the house's name, blackjack's arc and betting circles,
// the roulette and craps layouts, faro's spade layout; a plain card table's stitched border. The
// canvas's top edge is the dealer's side and its bottom the player's, so it reads from the seat.
import * as THREE from 'three';

const GOLD = '#e3c26a', CREAM = 'rgba(243,234,210,0.9)', SERIF = 'Georgia, "Times New Roman", serif', SANS = 'Bahnschrift, "Segoe UI", sans-serif';

export interface FeltText { house: string; game: string; blackjack: boolean }

export function feltTexture(model: string, aspect: number, t: FeltText): THREE.CanvasTexture {
  const w = 1024, h = Math.max(256, Math.round(w / Math.max(0.3, aspect)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const vinyl = model === 'folding';
  const base = vinyl ? ['#2f6b47', '#28603f'] : ['#2a8550', '#17552f'];
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
  grad.addColorStop(0, base[0]); grad.addColorStop(1, base[1]);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // Baize nap: faint fibres.
  g.globalAlpha = vinyl ? 0.03 : 0.06;
  for (let i = 0; i < 2400; i++) { g.fillStyle = i % 2 ? '#000' : '#fff'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1); }
  g.globalAlpha = 1;
  ({ poker_oval: poker, blackjack: bj, blackjack_wood: bj, roulette, craps, faro } as Record<string, (g: CanvasRenderingContext2D, w: number, h: number, t: FeltText) => void>)[model]?.(g, w, h, t)
    ?? plain(g, w, h, vinyl);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stadiumPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
}

function poker(g: CanvasRenderingContext2D, w: number, h: number, t: FeltText): void {
  g.strokeStyle = GOLD; g.lineWidth = 4;
  stadiumPath(g, w * 0.1, h * 0.16, w * 0.8, h * 0.68); g.stroke();
  g.lineWidth = 1.5; stadiumPath(g, w * 0.115, h * 0.185, w * 0.77, h * 0.63); g.stroke();
  g.fillStyle = CREAM; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 700 ${Math.round(h * 0.13)}px ${SERIF}`;
  g.globalAlpha = 0.55; g.fillText(t.house, w / 2, h * 0.47); g.globalAlpha = 0.45;
  g.font = `600 ${Math.round(h * 0.06)}px ${SANS}`; g.fillText(t.game.toUpperCase().split('').join(' '), w / 2, h * 0.6);
  g.globalAlpha = 1;
}

/** Text set round an arc centred on (cx, cy), reading left to right along its bottom. */
function arcText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, span: number): void {
  const chars = [...text];
  chars.forEach((ch, i) => {
    const a = Math.PI / 2 + span / 2 - (span * (i + 0.5)) / chars.length;
    g.save(); g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a)); g.rotate(a - Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
  });
}

function bj(g: CanvasRenderingContext2D, w: number, h: number, t: FeltText): void {
  // The flat edge (the dealer) is the top; the curve comes down toward the players.
  const cx = w / 2, cy = 0;
  g.fillStyle = CREAM; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h * 0.075)}px ${SERIF}`;
  arcText(g, t.blackjack ? 'BLACKJACK PAYS 3 TO 2' : t.game.toUpperCase(), cx, cy, h * 0.42, 1.5);
  g.strokeStyle = GOLD; g.lineWidth = 3;
  g.beginPath(); g.ellipse(cx, cy, w * 0.33, h * 0.55, 0, 0.12 * Math.PI, 0.88 * Math.PI); g.stroke();
  // Betting circles round the curve, one a player.
  for (let k = 0; k < 5; k++) {
    const a = Math.PI * (0.18 + 0.64 * (k / 4));
    const x = cx + w * 0.41 * Math.cos(a), y = cy + h * 0.76 * Math.sin(a);
    g.beginPath(); g.arc(x, y, h * 0.07, 0, Math.PI * 2); g.stroke();
  }
}

function roulette(g: CanvasRenderingContext2D, w: number, h: number): void {
  // The wheel is at the right; the layout runs from it along the table to the left.
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const x1 = w * 0.62, x0 = w * 0.04, y0 = h * 0.14, y1 = h * 0.62;
  const cw = (x1 - x0) / 13, ch = (y1 - y0) / 3;
  g.strokeStyle = CREAM; g.lineWidth = 2; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(ch * 0.45)}px ${SANS}`;
  // 0 and 00 by the wheel.
  for (const [k, label] of [[0, '0'], [1, '00']] as const) {
    const y = y0 + k * ch * 1.5;
    g.fillStyle = '#13804a'; g.fillRect(x1 - cw, y, cw, ch * 1.5); g.strokeRect(x1 - cw, y, cw, ch * 1.5);
    g.fillStyle = '#fff'; g.fillText(label, x1 - cw / 2, y + ch * 0.75);
  }
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 3; row++) {
      const n = col * 3 + (3 - row);
      const x = x1 - cw * (col + 2), y = y0 + row * ch;
      g.strokeRect(x, y, cw, ch);
      g.fillStyle = REDS.has(n) ? '#b3262c' : '#1b1b1e';
      g.beginPath(); g.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.36, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.fillText(String(n), x + cw / 2, y + ch / 2 + 1);
    }
  }
  const band = (y: number, hh: number, labels: string[]) => labels.forEach((l, i) => {
    const bw = (x1 - cw - x0) / labels.length, x = x1 - cw - bw * (i + 1);
    g.strokeRect(x, y, bw, hh);
    if (l === 'RED' || l === 'BLACK') { g.fillStyle = l === 'RED' ? '#b3262c' : '#1b1b1e'; g.beginPath(); g.moveTo(x + bw / 2, y + hh * 0.18); g.lineTo(x + bw * 0.75, y + hh / 2); g.lineTo(x + bw / 2, y + hh * 0.82); g.lineTo(x + bw * 0.25, y + hh / 2); g.fill(); }
    else { g.fillStyle = CREAM; g.fillText(l, x + bw / 2, y + hh / 2); }
  });
  g.font = `700 ${Math.round(ch * 0.36)}px ${SANS}`;
  band(y1, ch * 0.8, ['1st 12', '2nd 12', '3rd 12']);
  band(y1 + ch * 0.8, ch * 0.8, ['1-18', 'EVEN', 'RED', 'BLACK', 'ODD', '19-36']);
}

function craps(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.strokeStyle = CREAM; g.lineWidth = 3; g.fillStyle = CREAM; g.textAlign = 'center'; g.textBaseline = 'middle';
  const m = w * 0.03;
  // The pass line round the outside of both ends, the don't pass bar inside it.
  g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  g.font = `700 ${Math.round(h * 0.07)}px ${SANS}`;
  g.fillText('PASS LINE', w * 0.2, h - m - h * 0.06); g.fillText('PASS LINE', w * 0.8, h - m - h * 0.06);
  g.beginPath(); g.moveTo(m, h - m - h * 0.12); g.lineTo(w * 0.36, h - m - h * 0.12); g.moveTo(w * 0.64, h - m - h * 0.12); g.lineTo(w - m, h - m - h * 0.12); g.stroke();
  g.font = `700 ${Math.round(h * 0.045)}px ${SANS}`;
  g.fillText('DON\'T PASS BAR', w * 0.2, h - m - h * 0.17); g.fillText('DON\'T PASS BAR', w * 0.8, h - m - h * 0.17);
  // Each end: the place numbers along the far side, come and the field in front of them.
  const NUMS = ['4', '5', 'SIX', '8', 'NINE', '10'];
  for (const [xa, xb] of [[m + w * 0.04, w * 0.36], [w * 0.64, w - m - w * 0.04]]) {
    const bw = (xb - xa) / 6, top = m + h * 0.04, bh = h * 0.2;
    g.font = `700 ${Math.round(bh * 0.42)}px ${SERIF}`;
    NUMS.forEach((n, i) => { g.strokeRect(xa + i * bw, top, bw, bh); g.fillStyle = '#ffe38a'; g.fillText(n, xa + (i + 0.5) * bw, top + bh / 2); });
    g.fillStyle = '#ffe38a'; g.font = `700 ${Math.round(h * 0.11)}px ${SERIF}`;
    g.strokeRect(xa, top + bh, xb - xa, h * 0.2); g.fillText('COME', (xa + xb) / 2, top + bh + h * 0.1);
    g.fillStyle = CREAM; g.font = `700 ${Math.round(h * 0.05)}px ${SANS}`;
    g.strokeRect(xa, top + bh + h * 0.2, xb - xa, h * 0.16); g.fillText('FIELD  2 · 3 · 4 · 9 · 10 · 11 · 12', (xa + xb) / 2, top + bh + h * 0.28);
  }
  // The centre box: the one-roll and hardway bets.
  const cx0 = w * 0.39, cx1 = w * 0.61;
  g.strokeRect(cx0, h * 0.2, cx1 - cx0, h * 0.6);
  g.fillStyle = '#ff8a80'; g.font = `700 ${Math.round(h * 0.055)}px ${SANS}`;
  g.fillText('SEVEN · 4 TO 1', w / 2, h * 0.27);
  g.fillStyle = CREAM; g.font = `600 ${Math.round(h * 0.045)}px ${SANS}`;
  ['HARD 6 · 9 TO 1', 'HARD 10 · 7 TO 1', 'HARD 8 · 9 TO 1', 'HARD 4 · 7 TO 1', '2 · 3 · 11 · 12', 'ANY CRAPS · 7 TO 1'].forEach((l, i) => g.fillText(l, w / 2, h * (0.36 + i * 0.07)));
}

function faro(g: CanvasRenderingContext2D, w: number, h: number): void {
  // The spade suit enamelled on the board: A to 6 along the top, 7 at the end, K to 8 below.
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cw = w * 0.085, ch = cw * 1.4, gap = w * 0.012;
  const x0 = w / 2 - (6 * cw + 5 * gap) / 2 - cw / 2;
  const card = (r: number, x: number, y: number) => {
    g.fillStyle = '#f4efe2'; g.fillRect(x, y, cw, ch); g.strokeStyle = '#3a2a1a'; g.lineWidth = 2; g.strokeRect(x, y, cw, ch);
    g.fillStyle = '#17181b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.round(cw * 0.32)}px ${SERIF}`; g.fillText(RANKS[r], x + cw / 2, y + ch * 0.3);
    g.font = `${Math.round(cw * 0.45)}px ${SERIF}`; g.fillText('♠', x + cw / 2, y + ch * 0.68);
  };
  const yA = h * 0.5 - ch - gap, yB = h * 0.5 + gap;
  for (let i = 0; i < 6; i++) card(i, x0 + i * (cw + gap), yA);
  for (let i = 0; i < 6; i++) card(12 - i, x0 + i * (cw + gap), yB);
  card(6, x0 + 6 * (cw + gap), h / 2 - ch / 2);
}

function plain(g: CanvasRenderingContext2D, w: number, h: number, vinyl: boolean): void {
  g.strokeStyle = vinyl ? 'rgba(255,255,255,0.12)' : 'rgba(227,194,106,0.45)'; g.lineWidth = 3;
  g.setLineDash(vinyl ? [] : [10, 7]);
  g.strokeRect(w * 0.04, h * 0.06, w * 0.92, h * 0.88);
  g.setLineDash([]);
  g.fillStyle = 'rgba(243,234,210,0.12)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${Math.round(h * 0.18)}px ${SERIF}`;
  g.fillText('♠  ♥  ♣  ♦', w / 2, h / 2);
}

/** A slot machine's glass: three reels behind it, the pay line across. */
export function reelTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 200;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1b1e'; g.fillRect(0, 0, 256, 200);
  const SYM = ['7', 'BAR', '🍒', '🔔', '🍋'];
  for (let k = 0; k < 3; k++) {
    const x = 14 + k * 78;
    const grd = g.createLinearGradient(0, 30, 0, 170);
    grd.addColorStop(0, '#9a9a9a'); grd.addColorStop(0.3, '#fff'); grd.addColorStop(0.7, '#fff'); grd.addColorStop(1, '#9a9a9a');
    g.fillStyle = grd; g.fillRect(x, 30, 70, 140);
    g.fillStyle = '#b3262c'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const s = SYM[(seed * 7 + k * 3) % SYM.length];
    g.font = s.length > 2 ? '900 26px Bahnschrift, sans-serif' : '900 44px Georgia, serif';
    g.fillText(s, x + 35, 100);
  }
  g.fillStyle = '#d62828'; g.fillRect(8, 98, 240, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The lit sign on top of a slot machine. */
export function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 112;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 112);
  grd.addColorStop(0, '#ffe38a'); grd.addColorStop(1, '#c98a1a');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 112);
  g.fillStyle = '#b3262c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 64px Georgia, serif'; g.fillText('7 7 7', 128, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
