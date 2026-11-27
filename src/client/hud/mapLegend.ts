// The city map's legend: one button per kind of marker (icon, name, how many there are) that
// shows or hides it with a click, plus All / None. Plain DOM over the map so it reads at full size
// and clicks on it never land on the map underneath. The choice is remembered in this browser.
import { PROPERTIES, RULES, SERVICES } from '../../shared/packs';
import type { CityMap } from '../../shared/world/city';
import { CARD_ICON } from './cardMarks';
import { glyphCanvas } from './mapGlyphs';
import { iconKey } from './mapPlaces';
import { PLACE_ICON } from './minimap';
import { handset } from './phoneIcon';

const STORE = 'gridlock.mapHidden';

interface Row { key: string; label: string; icon: HTMLElement }

export class MapLegend {
  /** Marker kinds switched off: service verbs, 'property' and 'players'. */
  readonly hidden = new Set<string>();
  private buttons = new Map<string, HTMLButtonElement>();

  private counts = new Map<string, HTMLElement>();

  constructor(root: HTMLElement, map: CityMap, atms: number, cards = false) {
    try { for (const k of JSON.parse(localStorage.getItem(STORE) ?? '[]') as string[]) this.hidden.add(k); } catch { /* none saved */ }
    const count = new Map<string, number>();
    for (const s of map.city.services) { const v = SERVICES[s.spec].verb; count.set(v, (count.get(v) ?? 0) + 1); }
    if (atms) count.set('atm', atms);
    // Properties with their own icon (a saloon) get their own row; the rest are plain 'Property'.
    const icons = new Map<string, { color: string; glyph: string; label: string }>();
    let plain = 0;
    for (const p of map.city.properties) {
      const icon = PROPERTIES[p.spec].icon;
      if (!icon) { plain++; continue; }
      icons.set(icon.label, icon);
      count.set(iconKey(icon.label), (count.get(iconKey(icon.label)) ?? 0) + 1);
    }
    count.set('property', plain);
    const rows: Row[] = [
      // A verb's label is the universe's name for its place (the first service with it: Gunsmith,
      // Livery Stable...), else the engine's generic one.
      ...Object.entries(PLACE_ICON).filter(([k]) => count.has(k))
        .map(([key, v]) => ({ key, label: SERVICES.find((s) => s.verb === key)?.name ?? v.label, icon: dot(v.color, v.glyph) })),
      ...[...icons.values()].map((i) => ({ key: iconKey(i.label), label: i.label, icon: glyphCanvas(i.color, i.glyph, 'Bahnschrift, "Segoe UI", sans-serif') as HTMLElement })),
      ...(cards ? [{ key: 'cards', label: CARD_ICON.label, icon: dot(CARD_ICON.color, CARD_ICON.glyph) }] : []),
      { key: 'phones', label: RULES.jobPost === 'post' ? 'Job post with work' : 'Ringing payphone', icon: phone() },
      { key: 'property', label: 'Property', icon: house() },
      { key: 'players', label: 'Players', icon: dot('#ffffff', '') },
    ];
    const box = document.createElement('div');
    box.className = 'map-legend';
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('wheel', (e) => e.stopPropagation());
    const head = document.createElement('div');
    head.className = 'ml-head';
    head.innerHTML = '<span>Show</span>';
    const all = button('All', 'ml-bulk', () => this.set(rows.map((r) => r.key), false));
    const none = button('None', 'ml-bulk', () => this.set(rows.map((r) => r.key), true));
    head.append(all, none);
    box.append(head);
    for (const r of rows) {
      const b = button('', 'ml-row', () => this.set([r.key], !this.hidden.has(r.key)));
      const name = document.createElement('span');
      name.className = 'ml-name';
      name.textContent = r.label;
      b.append(r.icon, name);
      const n = count.get(r.key);
      if (n !== undefined || r.key === 'cards') {
        const c = document.createElement('span'); c.className = 'ml-count'; c.textContent = String(n ?? 0); b.append(c);
        this.counts.set(r.key, c);
      }
      this.buttons.set(r.key, b);
      box.append(b);
    }
    root.append(box);
    this.refresh();
  }

  /** A count that changes as you play (the card games you know of). */
  count(key: string, n: number): void {
    const c = this.counts.get(key);
    if (c && c.textContent !== String(n)) c.textContent = String(n);
  }

  private set(keys: string[], off: boolean): void {
    for (const k of keys) { if (off) this.hidden.add(k); else this.hidden.delete(k); }
    try { localStorage.setItem(STORE, JSON.stringify([...this.hidden])); } catch { /* private window */ }
    this.refresh();
  }

  private refresh(): void {
    for (const [k, b] of this.buttons) {
      const on = !this.hidden.has(k);
      b.classList.toggle('off', !on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.tabIndex = -1; // keys belong to the game; a focused button would eat Space/Enter
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function dot(color: string, glyph: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'ml-icon';
  s.style.background = color;
  s.textContent = glyph;
  return s;
}

function phone(): HTMLElement {
  const c = document.createElement('canvas');
  c.className = 'ml-icon ml-canvas';
  c.width = c.height = 40;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = '#d8dde3'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(10, 10, 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
  handset(g, 10, 10.6, 5.3, '#111');
  return c;
}

function house(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'ml-icon ml-house';
  return s;
}
