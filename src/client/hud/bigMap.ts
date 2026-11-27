// The city map (M): pan by dragging, zoom with the wheel, click to set a waypoint (click it again
// or right-click to clear), hover a pin for its name; the legend (mapLegend.ts) hides or shows kinds.
// A controller pans with the D-pad, zooms with the bumpers and drops the waypoint at the centre.
import { DISTRICTS, FACTIONS, PROPERTIES, RULES, SERVICES } from '../../shared/packs';
import type { PlayerInfo } from '../../shared/protocol';
import type { CityMap } from '../../shared/world/city';
import { type Atm, atmsOf } from '../../shared/world/atms';
import { MAP_SIZE } from '../../shared/world/cityTypes';
import { type CardVenue, cardVenues } from '../../shared/world/tables';
import { CARD_ICON, venueLabel } from './cardMarks';
import type { Blip } from '../game/jobs';
import type { Pt } from '../game/route';
import type { Mark } from '../game/waypoint';
import { bakeCityMap } from './mapArt';
import { drawGlyph } from './mapGlyphs';
import { gamesAt, iconKey } from './mapPlaces';
import { MapLegend } from './mapLegend';
import { phoneBlip } from './phoneIcon';
import { PLACE_ICON } from './minimap';

export const WAYPOINT_COLOR = '#ff4fd8';
const FONT = 'Bahnschrift, "Segoe UI", sans-serif';
const ZOOM_MIN = 0.3, ZOOM_MAX = 3;

export interface MapFrame {
  me: { x: number; y: number; angle: number };
  players: PlayerInfo[]; meId: number;
  owned: Set<number>; owners: Map<number, string>;
  blips: Blip[];
  /** Your own waypoint (clicking it again clears it). */
  waypoint: Pt | null;
  /** Every waypoint to draw (yours and those of whoever rides with you), in its owner's colour. */
  marks: Mark[];
  /** Road route to the job objective (drawn in the objective's yellow). */
  jobRoute: Pt[];
  /** Card games you know of (hud/cardMarks.ts). */
  cards: CardVenue[];
}

const JOB_COLOR = '#ffd21f';

interface Pin { x: number; y: number; label: string }

export class BigMap {
  private baked: HTMLCanvasElement;
  private cx = MAP_SIZE / 2;
  private cy = MAP_SIZE / 2;
  private zoom = 0.9;
  private hidden: Set<string>;
  private legend: MapLegend;
  /** Card rooms with their own pin (a casino's floor): their games go on its hover label. */
  private gameRooms: CardVenue[];
  private atms: Atm[];
  private pins: Pin[] = [];
  private mouse: { x: number; y: number } | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private padMode = false;
  private last: MapFrame | null = null;
  onWaypoint: (p: Pt | null) => void = () => {};

  constructor(private root: HTMLElement, private canvas: HTMLCanvasElement, private map: CityMap) {
    this.baked = bakeCityMap(map, 1);
    this.atms = atmsOf(map.city);
    const venues = cardVenues(map.city);
    this.gameRooms = venues.filter((v) => v.pinned);
    this.legend = new MapLegend(root, map, this.atms.length, venues.some((v) => !v.pinned));
    this.hidden = this.legend.hidden;
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.drag = { x: e.offsetX, y: e.offsetY, moved: false }; });
    canvas.addEventListener('mousemove', (e) => {
      this.padMode = false;
      this.mouse = { x: e.offsetX, y: e.offsetY };
      if (!this.drag) return;
      const dx = e.offsetX - this.drag.x, dy = e.offsetY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      if (this.drag.moved) { this.cx -= dx / this.zoom; this.cy -= dy / this.zoom; this.drag.x = e.offsetX; this.drag.y = e.offsetY; }
    });
    canvas.addEventListener('mouseleave', () => { this.mouse = null; this.drag = null; });
    window.addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && e.target === canvas) this.click(e.offsetX, e.offsetY);
    });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onWaypoint(null); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY);
    }, { passive: false });
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(x: number, y: number): void {
    this.cx = x; this.cy = y;
    this.root.hidden = false;
  }

  close(): void { this.root.hidden = true; }

  /** Controller: D-pad pans, bumpers zoom, A drops/clears the waypoint at the centre. */
  nav(c: string): void {
    this.padMode = true;
    const step = 140 / this.zoom;
    if (c === 'up') this.cy -= step;
    else if (c === 'down') this.cy += step;
    else if (c === 'left') this.cx -= step;
    else if (c === 'right') this.cx += step;
    else if (c === 'zoomIn') this.zoomAt(1.25);
    else if (c === 'zoomOut') this.zoomAt(1 / 1.25);
    else if (c === 'ok') this.toggleWaypoint({ x: this.cx, y: this.cy });
  }

  private zoomAt(f: number, sx = this.canvas.clientWidth / 2, sy = this.canvas.clientHeight / 2): void {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * f));
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x; this.cy += before.y - after.y;
  }

  private toWorld(sx: number, sy: number): Pt {
    return { x: this.cx + (sx - this.canvas.clientWidth / 2) / this.zoom, y: this.cy + (sy - this.canvas.clientHeight / 2) / this.zoom };
  }

  private toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.zoom + this.canvas.clientWidth / 2, (y - this.cy) * this.zoom + this.canvas.clientHeight / 2];
  }

  private click(sx: number, sy: number): void {
    this.toggleWaypoint(this.toWorld(sx, sy));
  }

  private toggleWaypoint(p: Pt): void {
    const w = this.last?.waypoint;
    if (w && Math.hypot(w.x - p.x, w.y - p.y) * this.zoom < 16) this.onWaypoint(null);
    else this.onWaypoint(p);
  }

  draw(f: MapFrame): void {
    this.last = f;
    const cv = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = this.zoom < 1.5;
    const [ox, oy] = this.toScreen(0, 0);
    ctx.drawImage(this.baked, ox, oy, MAP_SIZE * this.zoom, MAP_SIZE * this.zoom);
    this.labels(ctx);
    this.route(ctx, f);
    this.pins = [];
    this.properties(ctx, f); // each kind hides with its own toggle
    for (const s of this.map.city.services) {
      const verb = SERVICES[s.spec].verb;
      if (this.hidden.has(verb)) continue;
      const icon = PLACE_ICON[verb];
      const [px, py] = this.toScreen(s.x, s.y);
      pin(ctx, px, py, icon.color, icon.glyph);
      // A casino's pin lists the games on its floor, one to a line.
      const floor = this.gameRooms.find((v) => Math.hypot(v.x - s.x, v.y - s.y) < 1);
      this.pins.push({ x: px, y: py, label: floor ? [s.name, ...floor.games].join('\n') : s.name });
    }
    this.legend.count('cards', f.cards.length);
    if (!this.hidden.has('cards')) {
      for (const v of f.cards) {
        const [px, py] = this.toScreen(v.x, v.y);
        pin(ctx, px, py, CARD_ICON.color, CARD_ICON.glyph);
        this.pins.push({ x: px, y: py, label: venueLabel(v) });
      }
    }
    if (!this.hidden.has('atm')) {
      const icon = PLACE_ICON.atm;
      for (const a of this.atms) {
        const [px, py] = this.toScreen(a.x, a.y);
        pin(ctx, px, py, icon.color, icon.glyph, 6.5);
        this.pins.push({ x: px, y: py, label: 'ATM' });
      }
    }
    for (const b of f.blips) {
      const [px, py] = this.toScreen(b.x, b.y);
      if (b.shape === 'phone') {
        if (this.hidden.has('phones')) continue;
        phoneBlip(ctx, px, py, 9, b.color);
        this.pins.push({ x: px, y: py, label: RULES.jobPost === 'post' ? 'Job post with work: walk up to it to take it' : 'Payphone ringing: walk into it to answer' });
        continue;
      }
      ctx.fillStyle = b.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (!this.hidden.has('players')) this.people(ctx, f);
    if (this.padMode) crosshair(ctx, w / 2, h / 2);
    this.tooltip(ctx);
  }

  private labels(ctx: CanvasRenderingContext2D): void {
    if (this.zoom < 0.4) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of DISTRICTS) {
      const [px, py] = this.toScreen(d.x * MAP_SIZE, d.y * MAP_SIZE);
      ctx.font = `600 ${Math.round(11 + this.zoom * 3)}px ${FONT}`;
      halo(ctx, d.name.toUpperCase().split('').join(' '), px, py, 'rgba(235,238,242,0.75)');
      const gang = d.gang ? FACTIONS.find((g) => g.id === d.gang) : undefined;
      if (gang) { ctx.font = `700 ${Math.round(10 + this.zoom * 2)}px ${FONT}`; halo(ctx, gang.name.toUpperCase(), px, py + 15, gang.color); }
    }
  }

  private route(ctx: CanvasRenderingContext2D, f: MapFrame): void {
    for (const [r, color] of [[f.jobRoute, JOB_COLOR] as const, ...f.marks.map((m) => [m.route, m.color] as const)]) {
      if (r.length < 2) continue;
      ctx.beginPath();
      r.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash([]); ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      ctx.setLineDash([12, 8]); ctx.lineWidth = 3.5; ctx.strokeStyle = color; ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const m of f.marks) { const [x, y] = this.toScreen(m.point.x, m.point.y); waypointPin(ctx, x, y, 1.3, m.color); }
  }

  private properties(ctx: CanvasRenderingContext2D, f: MapFrame): void {
    for (const p of this.map.city.properties) {
      const mine = f.owned.has(p.id), owner = f.owners.get(p.id);
      const [px, py] = this.toScreen(p.x, p.y);
      const spec = PROPERTIES[p.spec];
      const icon = spec.icon;
      if (icon) {
        // Its own pin (a saloon's mug), hidden with its own legend toggle; yours ringed green.
        if (this.hidden.has(iconKey(icon.label))) continue;
        pin(ctx, px, py, icon.color, icon.glyph, 8.5);
        if (mine || owner) { ctx.strokeStyle = mine ? '#6fe08a' : '#7d8288'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.stroke(); }
      } else {
        if (this.hidden.has('property')) continue;
        ctx.fillStyle = mine ? '#6fe08a' : owner ? '#7d8288' : 'rgba(111,224,138,0.6)';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py - 7); ctx.lineTo(px + 6, py - 1); ctx.lineTo(px + 6, py + 6); ctx.lineTo(px - 6, py + 6); ctx.lineTo(px - 6, py - 1); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      const own = mine ? 'yours' : owner ?? `$${spec.price.toLocaleString('en-US')}`;
      const games = gamesAt(this.map.city, p.id);
      this.pins.push({ x: px, y: py, label: games ? `${p.name} · ${own}\n${games}` : `${p.name} · ${own}` });
    }
  }

  private people(ctx: CanvasRenderingContext2D, f: MapFrame): void {
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'center';
    for (const p of f.players) {
      if (p.id === f.meId) continue;
      const [px, py] = this.toScreen(p.x, p.y);
      ctx.fillStyle = p.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      halo(ctx, p.name, px, py - 14, '#fff');
    }
    const [mx, my] = this.toScreen(f.me.x, f.me.y);
    ctx.save(); ctx.translate(mx, my); ctx.rotate(f.me.angle);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, 7.5); ctx.lineTo(-4, 0); ctx.lineTo(-8, -7.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private tooltip(ctx: CanvasRenderingContext2D): void {
    const m = this.mouse;
    if (!m || this.drag?.moved) return;
    let best: Pin | null = null, bd = 12;
    for (const p of this.pins) { const d = Math.hypot(p.x - m.x, p.y - m.y); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    // One line, or several (a saloon: its name, then the games it deals, one to a line).
    const lines = best.label.split('\n');
    ctx.font = `600 13px ${FONT}`;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, th = 8 + lines.length * 17;
    ctx.fillStyle = 'rgba(11,13,16,0.92)';
    ctx.beginPath(); ctx.roundRect(best.x + 12, best.y - 10 - th, tw, th, 4); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.fillStyle = i ? '#d9c79a' : '#fff';
      ctx.font = `${i ? 500 : 600} 13px ${FONT}`;
      ctx.fillText(l, best!.x + 20, best!.y - 10 - th + 12.5 + i * 17);
    });
  }
}

/** Round map pin with a glyph. */
export function pin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, glyph: string, r = 9): void {
  ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (!glyph) return;
  drawGlyph(ctx, glyph, x, y, r, FONT);
}

/** Teardrop marker standing on (x, y). */
export function waypointPin(ctx: CanvasRenderingContext2D, x: number, y: number, k = 1, color = WAYPOINT_COLOR): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.bezierCurveTo(-3, -6, -9, -10, -9, -17); ctx.arc(0, -17, 9, Math.PI, 0); ctx.bezierCurveTo(9, -10, 3, -6, 0, 0);
  ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -17, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function crosshair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12); ctx.stroke();
}
