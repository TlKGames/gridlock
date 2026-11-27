import type { FriendSpec, TableSpec, VenueSpec } from '../../shared/packs/types';

// Bayhaven's card and casino games (shared/games; world/tables.ts places them). Honest odds: the
// house edge is each game's own rules. The better the company at a poker table, the bigger its
// stakes: a buddy's garage game is easy and pays peanuts; a crew's back-room game is sharks.
export const TABLES: TableSpec[] = [
  { id: 'slots', name: 'Slots', game: 'slots', stakes: [1, 25], prop: 'slots' },
  { id: 'roulette', name: 'Roulette', game: 'roulette', stakes: [5, 1000] },
  { id: 'craps', name: 'Craps', game: 'craps', stakes: [5, 1000] },
  { id: 'blackjack', name: 'Blackjack', game: 'blackjack', stakes: [10, 2000] },
  { id: 'holdem_25', name: 'Hold\'em 25/50', game: 'holdem', stakes: [25, 50], buyIn: [1000, 5000], players: 5, skill: 0.5, rake: [0.05, 300], sharps: 0.03, caught: 'throwOut', model: 'poker_oval' },
  { id: 'holdem_100', name: 'High-limit hold\'em 100/200', game: 'holdem', stakes: [100, 200], buyIn: [5000, 20000], players: 5, skill: 0.68, rake: [0.05, 500], sharps: 0.04, caught: 'throwOut', model: 'poker_oval' },
  // The crews' games: invite only the first time, sharks at the table, and they don't throw you out.
  { id: 'backroom', name: 'Back-room hold\'em 500/1000', game: 'holdem', stakes: [500, 1000], buyIn: [20000, 100000], players: 4, skill: 0.88, sharps: 0.15, caught: 'shoot' },
  // Friends' games: penny ante.
  { id: 'garage_holdem', name: 'Garage hold\'em 1/2', game: 'holdem', stakes: [1, 2], buyIn: [40, 200], players: 4, skill: 0.15, caught: 'throwOut', model: 'folding' },
  { id: 'garage_draw', name: 'Garage five-card draw', game: 'draw', stakes: [1, 2], buyIn: [40, 200], players: 3, skill: 0.18, caught: 'throwOut', model: 'folding' },
];

export const VENUES: VenueSpec[] = [
  // In the order of the Golden Anchor's tables (interiorPlans.ts): two blackjack tables.
  { at: { layout: 'casino' }, tables: ['slots', 'roulette', 'craps', 'blackjack', 'blackjack', 'holdem_25', 'holdem_100'] },
  { at: { backroom: true }, tables: ['backroom'] },
  { at: { home: true }, tables: ['garage_holdem', 'garage_draw'] },
];

export const FRIENDS: FriendSpec[] = [
  {
    id: 'walt', name: 'Walt', table: 'garage_holdem', arch: 'worker',
    meet: 'You play cards? Few of us have a game out here most nights. Penny ante, nobody gets hurt. Here, take my number.',
    invite: ['Game\'s on tonight, out front of my place. Bring cash, leave the attitude.', 'Marty\'s bringing chili. Cards at mine, you in?'],
    on: ['Yeah, come on by, we\'re dealing.', 'Pull up a chair, we just started.'],
    busy: ['Not tonight, the wife\'s got her sister over.', 'Nah, Marty owes everybody. Game\'s off till he pays up.'],
  },
  {
    id: 'dee', name: 'Dee', table: 'garage_holdem', arch: 'civilian',
    meet: 'Oh, you\'re the new face. We play hold\'em on the porch some nights. Low stakes, loud mouths. I\'ll text you.',
    invite: ['Porch game, tonight. Bring snacks or bring money, ideally both.', 'We\'re short a player. Get over here.'],
    on: ['Door\'s open, cards are out.', 'Come on, I need someone to take money off.'],
    busy: ['Can\'t tonight, double shift.', 'Not tonight, babe. Rain check.'],
  },
  {
    id: 'lenny', name: 'Lenny', table: 'garage_draw', arch: 'worker',
    meet: 'Draw poker, the old way, none of that hold\'em stuff. Couple of the guys from the yard. You want in, call me.',
    invite: ['Draw tonight, my driveway. Old man rules: jacks to open, no whining.', 'Got a fresh deck and a cold six-pack. You coming?'],
    on: ['Yeah, we\'re on. Get here before the beer\'s gone.', 'Cards are out. Hurry up.'],
    busy: ['Not tonight, my back\'s killing me.', 'Off tonight. Ma\'s birthday.'],
  },
];
