// Finds the shop/property the player is standing at and drives its pane.
import { PROPERTIES, SERVICES } from '../../shared/packs';
import { Mode, type Profile, type YouState } from '../../shared/protocol';
import { VERBS, verbOf } from '../../shared/verbs';
import { atmsOf } from '../../shared/world/atms';
import type { City, Place } from '../../shared/world/cityTypes';
import type { Pane } from '../hud/pane';
import { type Buy, propertyContent, serviceContent } from '../hud/places';

// Respray and chop shop work like GTA2 garages: just drive in (handled by the server). Gas kiosks
// and police front desks have nothing to sell (yet); the kiosk's ATM works. (shared/verbs.ts)

export interface Spot { place: Place; property: boolean }

export class Interact {
  current: Spot | null = null;
  private openSpot: Spot | null = null;

  /** ATMs as places to walk up to (verb 'atm'; id -1 - the ATM's id, which the server expects). */
  private atms: Place[];

  constructor(private city: City, private pane: Pane) {
    this.atms = atmsOf(city).map((a) => ({ id: -1 - a.id, lot: -1, verb: 'atm', spec: -1, x: a.x, y: a.y, name: 'ATM' }));
    // Every elevator stop (lobby and each floor, in world coords): id the interior, lot the floor, spec
    // the floors above. Stairwells are walked, not picked from a menu (world/stairs.ts).
    city.interiors.forEach((i, k) => {
      if (!i.lift || !i.elevator) return;
      const name = i.layout === 'tower' ? 'Elevator' : 'Stairs';
      [i.lift, ...i.floors.map((f) => f.lift)].forEach((s, f) =>
        this.lifts.push({ id: k, lot: f, verb: 'lift', spec: i.floors.length, x: s.x, y: s.y, name }));
    });
    this.tables = city.tables.map((t) => ({ id: t.id, lot: -1, verb: 'table', spec: t.spec, x: t.at.x, y: t.at.y, name: t.name }));
  }

  private lifts: Place[] = [];
  /** Card and casino tables (world/tables.ts): where you stand to play each (verb 'table', id the table). */
  private tables: Place[] = [];

  /** Nearest usable place for the current position/mode, or null. */
  find(x: number, y: number, you: YouState): Spot | null {
    if (you.mode === Mode.Dead || you.mode === Mode.Busted || you.mode === Mode.Passenger) return null;
    const driving = you.mode === Mode.Driver;
    let best: Spot | null = null, bd = Infinity;
    const consider = (place: Place, property: boolean) => {
      const verb = property ? PROPERTIES[place.spec].kind : place.verb;
      // Walk-in places do business at the counter inside; walking through their door is just a door.
      const dDoor = place.counter ? Math.hypot(place.counter.x - x, place.counter.y - y) : Math.hypot(place.x - x, place.y - y);
      const dPad = place.pad ? Math.hypot(place.pad.x - x, place.pad.y - y) : Infinity;
      let d = Infinity;
      if (!driving && dDoor < 3.2) d = dDoor;
      const driveUp = !property && verbOf(verb)?.driveUp;
      if (driving && driveUp && dPad < 8) d = dPad;
      if (!driving && driveUp && dPad < 5) d = dPad;
      if (d < bd) { bd = d; best = { place, property }; }
    };
    for (const s of this.city.services) if (!VERBS[SERVICES[s.spec].verb].automatic) consider(s, false);
    for (const p of this.city.properties) consider(p, true);
    for (const a of this.atms) consider(a, false);
    for (const l of this.lifts) if (Math.hypot(l.x - x, l.y - y) < 2.3) consider(l, false);
    // Tables stand close together (a row of slot machines): only the one you're right at.
    if (!driving) for (const t of this.tables) if (Math.hypot(t.x - x, t.y - y) < 1.4) { const d = Math.hypot(t.x - x, t.y - y) - 1; if (d < bd) { bd = d; best = { place: t, property: false }; } }
    return best;
  }

  promptText(s: Spot | null, owners: Map<number, string>, profile: Profile): string | null {
    if (!s) return null;
    if (!s.property) return s.place.name;
    const owner = owners.get(s.place.id);
    const spec = PROPERTIES[s.place.spec];
    if (!owner) return `${s.place.name} · for sale $${spec.price.toLocaleString('en-US')}`;
    return profile.owned.includes(s.place.id) ? `${s.place.name} · yours` : `${s.place.name} · owned by ${owner}`;
  }

  toggle(you: () => YouState, profile: () => Profile, owners: Map<number, string>, buy: Buy): void {
    if (this.pane.isOpen && this.openSpot) { this.pane.close(); return; }
    const s = this.current;
    if (!s) return;
    this.openSpot = s;
    this.pane.onClose = () => { this.openSpot = null; };
    this.pane.open(() => s.property
      ? propertyContent(s.place, you(), profile(), owners.get(s.place.id) ?? null, buy)
      : serviceContent(s.place, you(), buy));
  }

  /** Paint shop pad the menu last opened for; it opens once per visit, not again until you leave. */
  private visited = -1;

  /** GTA-style paint shop: stopping your car on the pad opens the colour menu. */
  paintShop(x: number, y: number, speed: number, you: YouState, open: (place: Place) => void): void {
    const place = you.mode === Mode.Driver
      ? this.city.services.find((s) => SERVICES[s.spec].verb === 'respray' && s.pad && Math.hypot(s.pad.x - x, s.pad.y - y) < 6)
      : undefined;
    if (!place) { this.visited = -1; return; }
    if (this.pane.isOpen || speed > 3 || this.visited === place.id) return;
    this.visited = place.id;
    this.openSpot = { place, property: false };
    open(place);
  }

  /** Closes the pane when the player walks away. */
  tick(x: number, y: number): void {
    if (!this.openSpot || !this.pane.isOpen) return;
    const p = this.openSpot.place;
    const d = Math.min(Math.hypot(p.x - x, p.y - y), p.pad ? Math.hypot(p.pad.x - x, p.pad.y - y) : Infinity,
      p.counter ? Math.hypot(p.counter.x - x, p.counter.y - y) : Infinity);
    if (d > 11) this.pane.close();
  }
}
