// Card games on the maps (world/tables.ts cardVenues): the walk-in ones (a saloon, a casino's
// floor) always; a gang's back room once they've invited you; a friend's yard once you've met them.
// A place with its own pin (a casino, a saloon) lists its games on that pin, so it isn't marked twice.
import type { CardVenue } from '../../shared/world/tables';

export const CARD_ICON = { color: '#b07cff', label: 'Card games', glyph: '♣' };

export function knownVenues(all: CardVenue[], friends: ReadonlySet<string>, gangs: ReadonlySet<string>): CardVenue[] {
  return all.filter((v) => !v.pinned && (v.host === 'house'
    || (v.host === 'gang' && !!v.gang && gangs.has(v.gang))
    || (v.host === 'friend' && !!v.friend && friends.has(`friend:${v.friend}`))));
}

/** A pin's hover label: the place, then its games one to a line (as a saloon's pin has them). */
export const venueLabel = (v: CardVenue): string => [v.name, ...v.games].join('\n');
