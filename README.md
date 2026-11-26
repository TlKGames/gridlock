# GRIDLOCK

A top-down multiplayer sandbox for up to six friends in the browser. Choose Bayhaven for city crime and crew jobs, or Redrock Territory for frontier towns, horses and outlaws.

## Play

```
npm install
npm run play
```

Open http://localhost:5228, pick a name, **Create game**, then send friends the invite link
(Esc → Copy invite link, or `http://<your-address>:5228/#CODE`).

- **Same network:** friends use the LAN address the server prints on startup.
- **Over the internet, always on (recommended):** run the server on a host that never sleeps, so
  nobody has to host: any player can carry on a game whenever they like, with or without the
  others. On Railway (`railway.json` sets build `npm run build`, start `npm start` and the health
  check `/api/health`): create a project from this repo, add a **volume** (any mount path, e.g.
  `/data`) and set the variable **`GRIDLOCK_DATA`** to that path, so room saves survive redeploys.
  Share `https://<your-app>.up.railway.app/#CODE`. `/api/health` reports rooms, players, tick
  time and memory (`memMB`: ~80 MB idle, ~140 MB with a room of four, at the cost of a Hobby
  plan's included usage).
- **Over the internet from this PC:** forward TCP port 5228 on your router and share
  `http://<your-public-ip>:5228/#CODE`; the game is only up while this PC runs the server.

Room saves (who owns which property, business safes, the clock) live in `data/` (or
`GRIDLOCK_DATA`). Characters live in the players' browsers. Both are tagged with their universe
and only load where it matches.

**Radio:** each vehicle's radio comes tuned to its own station; press R (controller: D-pad up)
to cycle that vehicle's radio through Off and the stations
(src/universes/bayhaven/radio.ts: 97.1 The Eagle, 98.2 The Spa, 99.9 Jazzy J, 102.2 Funk in the Trunk, 103.3 The Talking Heads, 106.1 KISS FM). Stations are broadcasts on the server's
clock: every player on a station hears the same song at the same moment, and switching cars
never restarts anything (you join whatever is on air). A station plays every audio file
(.m4a, .mp3, .wav; lengths are read from the files) in its folder, with commercial breaks
between songs (one random spot from the folder's `commercials/` subfolder after a song now and
after 1 to 3 songs, never the same spot twice running; a station with no commercials plays songs
back to back). Song titles and artists come from `content/radio/<station id>/tracks.json` (file
name → `{ title, artist }`); a song without an entry shows its file name. The station folder is
`content/radio/<station id>/` in the project. Folders are read live, so new songs just show up.

**Characters:** up to 5 per browser, kept in that browser's local storage: name, look, cash,
cars, felony record, respect. You bring your character when you join; the server checks the
values and sends progress back every few seconds (and right after purchases) to be saved.
Server redeploys can't lose them; clearing the site's data in the browser does. Properties
belong to each room and stay on the server.

**Continue:** each room belongs to one universe. A character remembers its last room,
spot and the vehicle it was driving. "Continue in CODE" in the lobby goes back into that room
(reopened if nobody is in it). Whoever joins a room, by code or by its link, comes back at their
own character's last spot, in that vehicle.

Run `npm test` to typecheck and exercise the core multiplayer, persistence, combat and universe checks.

## Things to do in Bayhaven

- **Gang payphones**: booths in each gang's turf blink in the gang's colour when there's work.
  Walk into a ringing phone to answer it. Jobs: hits, torching rival cars, stealing specific rides, courier runs,
  turf-war rampages. Pay plus respect with the gang (and less with its rivals).
- **Respect**: three meters under your wanted stars. Kill a gang's members and it drops; sink low
  enough and that gang jumps you on sight and stops offering work.
- **Cell phone** (P, controller LB): Contacts, Messages and Bank. Do payphone work for a gang until
  it trusts you and it texts you its number; then its people call with work (paying a bit more), and
  you can ring them to ask. Your businesses and your bank text you too.
- **Banks and ATMs**: dying drops some of the cash you carry and getting busted costs a fine, but
  money in the bank is safe. Bank it at an ATM (on the walls of banks, corner stores, diners, clubs,
  car washes and gas station kiosks) or a bank's counter. Shops take your cash first, then the bank for the rest.
- **Walk-in places**: gun shops, corner stores, gas station kiosks, diners, nightclubs and warehouses
  open up when you walk to their door: the roof comes off and you walk in, past the shelves and booths
  to the counter, where the clerk is and where you do business. Banks and police precincts open up
  too.
- **The bank job**: blow the vault door with an explosion (grenade, rocket, car bomb) and the cash
  inside is yours, if you can get away: the alarm goes out to the whole city and you're on four stars.
  The vault shuts and restocks after a while.
- **Businesses**: income fills each one's safe (up to 8 game hours of it). Empty it at the door, or
  at midnight an armoured car takes it to your bank (less 10%). Gangs that don't respect you send a
  crew to lean on your places: kill them, pay them off at the door, or lose the safe. Your car wash
  takes the heat off, your warehouse fences stolen cars above chop-shop prices, and your nightclub's
  back room puts you in touch with any gang that will work with you.
- **Kill-frenzy crates**: red-and-black crates in parks and lots. Grab one for a weapon and a timer.
- **Room modes** (picked when creating a game): Free roam, Frag race (first to 10 player kills),
  Money race (first to earn $50,000), Tag (one player is "it", marked for everyone; kill someone
  while you're it and they're it; least time it after 10 minutes wins). The winner is announced and
  a new round starts.

## Controls

Keyboard and mouse, or a controller. On foot W/A/S/D (or arrows) run north/west/south/east on
screen and you face the way you run (or aim with right mouse); shots go that way and auto-aim at
whoever is ahead of you (±16°). There is no cursor in play. Esc → Change controls has a Keyboard / Mouse tab (two keys per action;
Delete clears a slot) and a Controller tab (rebind buttons). Every action is its own setting,
grouped On foot / Car / Helicopter / Tank / Weapons / General; one key can do different jobs in
different groups (Space jumps, handbrakes and climbs), and only clashes within a group are cleared.

**Controller** (any standard-mapped pad, no setup; browsers reveal a pad only after you press one
of its buttons on the game page, and only over https or localhost, so a plain-http LAN address
won't see it; the game says "Controller connected" when it does): the left stick moves in any direction and how far
you push sets the pace; the right stick aims (tank turret in a tank). In vehicles the left stick
steers in proportion, RT is the gas, LT the brake and reverse. RT also fires on foot. Defaults: RB fire, Y action,
A jump/handbrake/climb, B sprint/descend, D-pad left/right weapons, D-pad down scores, View map,
Menu pause. Menus: D-pad or stick to move, A to choose, B to go back.

The semi tows an articulated trailer: it swings wide on turns, can jackknife, and scrapes on walls.

| Key | Action |
| --- | --- |
| W/A/S/D or arrows | On foot: run north / west / south / east (diagonals too) |
| W/S · A/D in vehicles | Gas / brake, reverse · steer |
| Left click or Ctrl | Fire / swing ahead (auto-aims at the nearest person in front) |
| Right mouse (hold) | Aim: mouse motion turns you any direction while WASD keeps moving you (no cursor); aims a tank's turret |
| , / . | Tank turret left / right |
| Space | Jump on foot · handbrake in cars · climb in helicopters |
| Shift | Descend in helicopters |
| E or F | Action: get in/out of vehicles (carjack, ride with a friend), or use the shop/property door you're at (paint shop: stop on its pad and pick a colour, previewed on your car, which also repairs it and loses the cops; chop shop: just drive in) |
| Z / X / wheel / 1–9 | Previous / next / pick weapon (no reloading: you fire until the ammo runs out) |
| H | Horn (siren in emergency vehicles) |
| R | Radio: next station / off (in vehicles) |
| T / M / Tab / Esc | Chat / city map / scores / menu |
| P | Phone (arrows + Enter work it, Backspace goes back) |
