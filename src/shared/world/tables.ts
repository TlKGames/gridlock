// Where the card and casino games are (packs VENUES, TABLES, FRIENDS): the tables of walk-in places
// laid out for them (a casino's floor, a saloon: each table prop gets a game), a table in the back
// room of a place on each gang's turf, and one in each friend's yard. Each spot has where you stand
// to play and where the others sit. Worked out from the city alone (its own Rng), after the
// interiors, so server and clients agree; the city's other generation is untouched.
import type { Rect } from '../math';
import { FACTIONS, FRIENDS, GANGS, PROPERTIES, TABLES, VENUES, ZONES } from '../packs';
import type { GameKind } from '../packs/types';
export type { GameKind };
import { Rng } from '../rng';
import type { City } from './cityTypes';
import { turfGang } from './gangTurf';
import type { Prop, Spot } from './interiors';

export interface TableSpot {
  id: number;
  /** Index into TABLES. */
  spec: number;
  /** "Craps at the Golden Anchor", "the back room at Rosa's Diner", "Walt's yard". */
  name: string;
  /** Where you stand to play, facing the table. */
  at: Spot;
  /** Where the others sit (poker: the players; house games: the dealer). */
  seats: Spot[];
  rect: Rect;
  host: 'house' | 'gang' | 'friend';
  gang?: string;
  friend?: string;
  /** The walk-in place it's in (index into city.interiors), and the prop it is. */
  interior?: number;
  prop?: Prop;
  /** Out in a yard: drawn and solid on its own (render/cardTables.ts, world/collision.ts). */
  yard?: boolean;
}

export const POKER = new Set<GameKind>(['holdem', 'draw', 'stud']);

/** A place to play cards, for the maps: one per walk-in place's house tables (a saloon, a casino's
 *  floor), gang back room or friend's yard, with the games played there. `pinned`: the place has
 *  its own map pin already (a casino's service icon, a saloon's property icon) that lists them. */
export interface CardVenue {
  key: string;
  x: number;
  y: number;
  name: string;
  games: string[];
  host: TableSpot['host'];
  gang?: string;
  friend?: string;
  pinned: boolean;
}

export function cardVenues(city: City): CardVenue[] {
  const by = new Map<string, CardVenue>();
  for (const t of city.tables) {
    const it = t.interior !== undefined ? city.interiors[t.interior] : undefined;
    // A room's house tables are one place; a back-room game (even in a saloon) is its own.
    const key = it && t.host === 'house' ? `room:${t.interior}` : `table:${t.id}`;
    let v = by.get(key);
    if (!v) {
      const at = it ? it.place : t.at;
      const name = t.host === 'house' ? (it?.place.name ?? t.name) : t.name;
      const pinned = !!it && t.host === 'house' && (!it.property || !!PROPERTIES[it.place.spec]?.icon);
      v = { key, x: at.x, y: at.y, name, games: [], host: t.host, ...(t.gang ? { gang: t.gang } : {}), ...(t.friend ? { friend: t.friend } : {}), pinned };
      by.set(key, v);
    }
    const g = TABLES[t.spec].name;
    if (!v.games.includes(g)) v.games.push(g);
  }
  return [...by.values()];
}
const isPoker = (spec: number) => POKER.has(TABLES[spec].game);
const tableIndex = (id: string) => TABLES.findIndex((t) => t.id === id);

/** You on the side of the table nearest `from`; the others round the rest of it. */
function seatsAround(r: Rect, from: { x: number; y: number }, others: number): { at: Spot; seats: Spot[] } {
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, hx = (r.x1 - r.x0) / 2, hy = (r.y1 - r.y0) / 2;
  const off = 0.75;
  // Which side faces `from`: the one its direction leaves the table by.
  const dx = (from.x - cx) / Math.max(hx, 0.1), dy = (from.y - cy) / Math.max(hy, 0.1);
  const n: [number, number] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  const t: [number, number] = [-n[1], n[0]];
  const spot = (u: number, v: number): Spot => {
    // u across the side's normal (+ toward you), v along it.
    const ex = n[0] ? hx : hy, ez = n[0] ? hy : hx;
    const x = cx + n[0] * u * (ex + off) + t[0] * v * ez, y = cy + n[1] * u * (ex + off) + t[1] * v * ez;
    return { x, y, angle: Math.atan2(cy - y, cx - x) };
  };
  const ends = (s: number): Spot => {
    const ex = n[0] ? hx : hy, ez = n[0] ? hy : hx;
    const x = cx + t[0] * s * (ez + off), y = cy + t[1] * s * (ez + off);
    void ex;
    return { x, y, angle: Math.atan2(cy - y, cx - x) };
  };
  const candidates = [spot(-1, -0.45), spot(-1, 0.45), ends(-1), ends(1), spot(-1, 0), spot(1, 0.6)];
  return { at: spot(1, 0), seats: others === 1 ? [spot(-1, 0)] : candidates.slice(0, others) };
}

export function placeTables(city: City, districtAt: (x: number, y: number) => number): void {
  city.tables = [];
  if (!TABLES.length || !VENUES.length) return;
  const rng = new Rng(city.seed ^ 0x7ab1e5);
  const add = (spec: number, name: string, rect: Rect, from: { x: number; y: number }, host: TableSpot['host'], extra: Partial<TableSpot>) => {
    const s = TABLES[spec];
    const others = s.prop === 'slots' ? 0 : isPoker(spec) ? (s.players ?? 4) : 1;
    const { at, seats } = seatsAround(rect, from, others);
    city.tables.push({ id: city.tables.length, spec, name, at, seats: s.prop === 'slots' ? [] : seats, rect, host, ...extra });
  };
  for (const v of VENUES) {
    const specs = v.tables.map(tableIndex).filter((i) => i >= 0);
    if (!specs.length && !('home' in v.at)) continue;
    if ('layout' in v.at) {
      const layout = v.at.layout;
      city.interiors.forEach((it, k) => {
        if (it.layout !== layout) return;
        // This place's games: all of them in order, or (mixed) its own shuffled few.
        const own = v.mix ? new Rng(city.seed + k * 7919).shuffle([...specs]) : specs;
        const tables = own.filter((i) => TABLES[i].prop !== 'slots'), slots = own.filter((i) => TABLES[i].prop === 'slots');
        let nt = 0, ns = 0;
        for (const p of it.props) {
          const list = p.kind === 'slots' ? slots : p.kind === 'table' ? tables : null;
          if (!list?.length) continue;
          const spec = list[(p.kind === 'slots' ? ns++ : nt++) % list.length];
          // You play a machine from the floor (facing into the room), a table from the side toward the door.
          const from = p.kind === 'slots' ? { x: (it.room.x0 + it.room.x1) / 2, y: (it.room.y0 + it.room.y1) / 2 } : it.place;
          add(spec, `${TABLES[spec].name} at ${it.place.name.split(',')[0]}`, p.rect, from, 'house', { interior: k, prop: p });
        }
      });
    } else if ('backroom' in v.at) {
      // Each gang's game: a table at the back of a place on its turf, far from the street door.
      for (const gang of GANGS) {
        const spec = specs[GANGS.indexOf(gang) % specs.length];
        const choices = city.interiors.map((it, k) => ({ it, k })).filter(({ it }) =>
          ['diner', 'club', 'warehouse', 'shop', 'saloon'].includes(it.layout) && turfGang(districtAt(it.place.x, it.place.y)) === gang);
        for (const { it, k } of rng.shuffle(choices)) {
          const rect = backTable(it.room, it.place, [...it.props, ...it.walls]);
          if (!rect) continue;
          const prop: Prop = { kind: 'table', rect, h: 0.8 };
          it.props.push(prop);
          const who = FACTIONS.find((f) => f.id === gang)?.name ?? gang;
          add(spec, `${who}'s game at ${it.place.name.split(',')[0]}`, rect, it.place, 'gang', { gang, interior: k, prop });
          break;
        }
      }
    } else {
      // Friends' games: a table in the front yard of a house.
      const yards = city.lots.filter((l) => l.use === 'yard' && l.building && l.front >= 0 && ZONES[l.zone]?.layout === 'houses');
      const used = new Set<number>();
      for (const f of FRIENDS) {
        const spec = tableIndex(f.table);
        if (spec < 0) continue;
        for (let tries = 0; tries < 30 && yards.length; tries++) {
          const lot = yards[Math.floor(rng.next() * yards.length)];
          if (used.has(lot.id)) continue;
          const rect = yardTable(lot.rect, lot.building!.rect);
          if (!rect) continue;
          used.add(lot.id);
          const door = { x: (lot.building!.rect.x0 + lot.building!.rect.x1) / 2, y: (lot.building!.rect.y0 + lot.building!.rect.y1) / 2 };
          // You sit on the side away from the house.
          const away = { x: 2 * (rect.x0 + rect.x1) / 2 - door.x, y: 2 * (rect.y0 + rect.y1) / 2 - door.y };
          add(spec, `${f.name}'s game`, rect, away, 'friend', { friend: f.id, yard: true });
          break;
        }
      }
    }
  }
}

const overlap = (a: Rect, b: Rect, m = 0.6) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;

/** A 2.2 x 1.3 m table in the far part of a room (away from its door), clear of what's there. */
function backTable(room: Rect, door: { x: number; y: number }, solid: { rect: Rect }[]): Rect | null {
  const cx = (room.x0 + room.x1) / 2, cy = (room.y0 + room.y1) / 2;
  const alongX = Math.abs(door.x - cx) > Math.abs(door.y - cy);
  const depth = alongX ? room.x1 - room.x0 : room.y1 - room.y0;
  if (depth < 9) return null;
  // Try spots from the back wall forward, across the room.
  for (const back of [1.9, 2.5, 3.4, 4.5]) {
    for (const across of [0, -0.12, 0.12, -0.25, 0.25, -0.35, 0.35]) {
      const r = alongX
        ? (() => { const x = door.x < cx ? room.x1 - back : room.x0 + back, y = cy + across * (room.y1 - room.y0); return { x0: x - 0.65, x1: x + 0.65, y0: y - 1.1, y1: y + 1.1 }; })()
        : (() => { const y = door.y < cy ? room.y1 - back : room.y0 + back, x = cx + across * (room.x1 - room.x0); return { x0: x - 1.1, x1: x + 1.1, y0: y - 0.65, y1: y + 0.65 }; })();
      const inside = r.x0 > room.x0 + 0.9 && r.x1 < room.x1 - 0.9 && r.y0 > room.y0 + 0.9 && r.y1 < room.y1 - 0.9;
      if (inside && !solid.some((s) => overlap(r, s.rect, 0.7))) return r;
    }
  }
  return null;
}

/** A card table in a house's front yard: between the house and the street, with room round it. */
function yardTable(lot: Rect, house: Rect): Rect | null {
  const gaps = [
    { r: { x0: lot.x0, x1: lot.x1, y0: lot.y0, y1: house.y0 } }, { r: { x0: lot.x0, x1: lot.x1, y0: house.y1, y1: lot.y1 } },
    { r: { x0: lot.x0, x1: house.x0, y0: lot.y0, y1: lot.y1 } }, { r: { x0: house.x1, x1: lot.x1, y0: lot.y0, y1: lot.y1 } },
  ];
  for (const { r } of gaps) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (w < 5.5 || h < 5.5) continue;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    return w > h ? { x0: cx - 1.1, x1: cx + 1.1, y0: cy - 0.65, y1: cy + 0.65 } : { x0: cx - 0.65, x1: cx + 0.65, y0: cy - 1.1, y1: cy + 1.1 };
  }
  return null;
}
