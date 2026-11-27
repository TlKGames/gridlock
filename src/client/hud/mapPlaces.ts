// What the maps say about a place: the legend key of a property's own icon (PropertySpec.icon), and
// the games its card tables deal (world/tables.ts), for the big map's hover label.
import { TABLES } from '../../shared/packs';
import type { City } from '../../shared/world/cityTypes';

/** The legend toggle for a property icon (its label). */
export const iconKey = (label: string): string => `icon:${label}`;

/** The games dealt at a place's tables, one to a line ("Five-card draw, $1/$2"), or '' if none. */
export function gamesAt(city: City, placeId: number): string {
  const names = new Set<string>();
  for (const t of city.tables) {
    if (t.host !== 'house' || t.interior === undefined) continue;
    if (city.interiors[t.interior]?.place.id === placeId) names.add(TABLES[t.spec].name);
  }
  return [...names].join('\n');
}
