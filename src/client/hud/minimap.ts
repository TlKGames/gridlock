// Radar: the baked city map around you, place pins, players, hostiles, job blips, and waypoint
// routes as dashed lines in their owners' colours (markers cling to the edge when out of range).
import { PROPERTIES, SERVICES, type ServiceVerb } from '../../shared/packs';
import type { PlayerInfo } from '../../shared/protocol';
import type { CityMap } from '../../shared/world/city';
import type { CardVenue } from '../../shared/world/tables';
import type { Blip } from '../game/jobs';
import { CARD_ICON } from './cardMarks';
import type { Pt } from '../game/route';
import type { Mark } from '../game/waypoint';
import { MAP_COLORS, bakeCityMap } from './mapArt';
import { drawGlyph } from './mapGlyphs';
import { phoneBlip } from './phoneIcon';

const SCALE = 0.5; // px per metre in the baked image
const JOB_COLOR = '#ffd21f';

/** Every service verb's map icon (typed by the verbs, so a new verb can't go without one). */
export const PLACE_ICON: Record<ServiceVerb | 'atm', { color: string; label: string; glyph: string }> = {
  casino: { color: '#d9b53a', label: 'Casino', glyph: '♠' },
  gunshop: { color: '#ff4a3d', label: 'Guns', glyph: 'G' },
  dealer: { color: '#4fa3ff', label: 'Car dealer', glyph: 'D' },
  respray: { color: '#ffd34f', label: 'Paint shop', glyph: 'P' },
  chopshop: { color: '#ff9a3c', label: 'Chop shop', glyph: 'C' },
  hospital: { color: '#ffffff', label: 'Hospital', glyph: '+' },
  police: { color: '#5a7dff', label: 'Police', glyph: '★' },
  fire: { color: '#c0303a', label: 'Fire station', glyph: 'F' },
  helipad: { color: '#e8e8e8', label: 'Heliport', glyph: 'H' },
  military: { color: '#7fa05a', label: 'Military base', glyph: 'M' },
  bank: { color: '#3fbf7f', label: 'Bank', glyph: '$' },
  gas: { color: '#ff7a45', label: 'Gas station', glyph: '⛽' },
  atm: { color: '#8fe0b0', label: 'ATM', glyph: 'A' },
};

export class Minimap {
  readonly baked: HTMLCanvasElement;

  constructor(private map: CityMap) {
    this.baked = bakeCityMap(map, SCALE);
  }

  /** Draws the radar centred on (x, y) with `range` metres to the edge. */
  drawRadar(ctx: CanvasRenderingContext2D, size: number, x: number, y: number, angle: number, range: number, players: PlayerInfo[], meId: number,
    owned: Set<number>, hostiles: { x: number; y: number }[], blips: Blip[] = [], marks: Mark[] = [], jobRoute: Pt[] = [], cards: CardVenue[] = []): void {
    const k = size / 2 / range;
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = MAP_COLORS.water;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    const src = range * 2 * SCALE;
    ctx.drawImage(this.baked, (x - range) * SCALE, (y - range) * SCALE, src, src, 0, 0, size, size);
    const to = (wx: number, wy: number) => [size / 2 + (wx - x) * k, size / 2 + (wy - y) * k] as const;
    const clampEdge = (px: number, py: number) => {
      const dx = px - size / 2, dy = py - size / 2, d = Math.hypot(dx, dy), m = size / 2 - 9;
      return d > m ? [size / 2 + (dx / d) * m, size / 2 + (dy / d) * m] as const : [px, py] as const;
    };
    // Road routes: the job's in the objective's yellow, each waypoint's (yours, and those of whoever
    // rides with you) in its owner's colour.
    for (const [r, color] of [[jobRoute, JOB_COLOR] as const, ...marks.map((m) => [m.route, m.color] as const)]) {
      if (r.length < 2) continue;
      ctx.beginPath();
      r.forEach((p, i) => { const [px, py] = to(p.x, p.y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of this.map.city.services) {
      const icon = PLACE_ICON[SERVICES[s.spec].verb];
      const [px, py] = to(s.x, s.y);
      if (px < -6 || py < -6 || px > size + 6 || py > size + 6) continue;
      ctx.fillStyle = icon.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const v of cards) {
      const [px, py] = to(v.x, v.y);
      if (px < -6 || py < -6 || px > size + 6 || py > size + 6) continue;
      ctx.fillStyle = CARD_ICON.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const p of this.map.city.properties) {
      const [px, py] = to(p.x, p.y);
      if (px < -6 || py < -6 || px > size + 6 || py > size + 6) continue;
      const icon = PROPERTIES[p.spec].icon;
      if (icon) {
        // Its own small pin (a saloon's mug), ringed green when it's yours.
        ctx.fillStyle = icon.color; ctx.strokeStyle = owned.has(p.id) ? '#6fe08a' : '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        drawGlyph(ctx, icon.glyph, px, py, 5.5, 'Bahnschrift, "Segoe UI", sans-serif');
        continue;
      }
      ctx.fillStyle = owned.has(p.id) ? '#6fe08a' : 'rgba(111,224,138,0.35)';
      ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py + 4); ctx.lineTo(px - 5, py + 4); ctx.fill();
    }
    for (const b of blips) {
      // The job objective and ringing phones stick to the radar edge so you always know which way to go.
      const [px, py] = b.shape === 'star' || b.shape === 'phone' ? clampEdge(...to(b.x, b.y)) : to(b.x, b.y);
      if (px < -6 || py < -6 || px > size + 6 || py > size + 6) continue;
      if (b.shape === 'phone') { phoneBlip(ctx, px, py, 6.5, b.color); continue; }
      ctx.fillStyle = b.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (b.shape === 'star') { ctx.moveTo(px, py - 7); ctx.lineTo(px + 6, py + 5); ctx.lineTo(px - 6, py + 5); ctx.closePath(); }
      else ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    for (const m of marks) {
      const [px, py] = clampEdge(...to(m.point.x, m.point.y));
      ctx.fillStyle = m.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    for (const h of hostiles) {
      const [px, py] = to(h.x, h.y);
      ctx.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#ff3b30' : '#3b6bff';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const p of players) {
      if (p.id === meId) continue;
      const [px, py] = clampEdge(...to(p.x, p.y));
      ctx.fillStyle = p.color; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // Self arrow.
    ctx.translate(size / 2, size / 2);
    ctx.rotate(angle);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 5.5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
