# Plan: from sandbox to a city you build a life in

Agreed with the user on 2026-11-23. Killing stays part of the game but isn't the main loop: the main
loop is building an empire (money, property, standing with the gangs). Work goes milestone by milestone;
each ends playable, tested and pushed. Ask the user before starting the next milestone.

## A. Find the work (small)
Jobs existed but nobody could find them: the "booths" were gang-coloured boxes with a blinking lamp.
- A1. (done) Payphones look like payphones: a hooded phone on a pole with a PHONE sign readable from above;
  the gang's colour is a sticker on it, not the whole booth.
- A2. (done) A phone rings only when there's work for you: one phone per gang at a time (the nearest), heard
  from the phone's spot, a pulsing phone icon on the radar and the city map (also from a car).
  Ring sound: CC0 Freesound, fetched after the user's OK.
- A3. (done) Radio: one quiet line at the bottom centre while the radio's on in your vehicle: station,
  title, artist and a small equaliser that moves with the music; brightens on a new song or station,
  then settles dim. Replaces the top-left card.
Done when: a new player finds a ringing phone without being told; the radio line reads well and
doesn't distract.

## B. Money you can keep (medium)
Carried cash is at risk (15% dropped on death, 20% fine when busted); banked money isn't.
- B1. (done) A bank balance on the character (sent and saved like cash, checked by the server).
- B2. (done) ATMs on the walls of banks and of businesses flagged `atm` in the packs (shared/world/atms.ts,
  21 in the city): deposit / withdraw in the slide-in pane.
- B3. (done) Banks (Harbor Trust, 3, downtown / midtown / commercial): the same at the counter;
  business income is paid into the bank.
- B4. (done) Paying: shops, dealers and property take carried cash first, then the bank for the rest.
Done when: money survives death in the bank and purchases draw on it. `npx tsx scripts/bank.ts`.

## C. Cell phone (medium)
- C1. (done) A handset that slides up at the bottom right (P / LB; hud/phone.ts): Contacts, Messages,
  Bank, incoming calls with Answer / Decline; arrows + Enter work it while WASD still walks.
- C2. (done) A gang's first jobs come from its payphones; at RESPECT.cellAt it texts its number, then
  calls every 2-4 min while you're free (answer, decline, or miss it), and you can ring it for work
  (90 s before the same contact has more). Phone work pays x1.25 (server/game/missions/cell.ts).
- C3. (done for income) The bank texts business income. "Trouble" texts come with milestone D.
`npx tsx scripts/cell.ts` checks it.

## Gas stations (asked 2026-11-23; done)
Six "Gas & Go" forecourts (packs service `gas`; layout shared/world/gas.ts; render/gasStations.ts):
the building shrinks to a kiosk at the back (sign + ATM), two solid pump islands under a branded
canopy on pillars, a pole price sign at the street corner, canopy light pooling at night.
Not built (ask first): exploding pumps, a kiosk counter, a fuel gauge.

## D. Businesses that matter (medium)
- D1. (done) Income fills each business's safe (up to RULES.safeHours of it, a text when full); empty
  it at the door as cash, or the midnight armoured car takes it to the bank less RULES.safeSweepFee.
- D2. (done) Each game hour a gang that respects you under RULES.troubleBelow may send a crew to the
  door of a business on its turf (text + red marker): kill them, pay them off at the door (respect
  up), or after RULES.troubleSeconds they empty the safe.
- D3. (done) Perks (packs `perk`): your car wash's bay takes the heat off, your warehouse's bay fences
  stolen cars at RULES.fenceMul x chop price, your nightclub's back room meets any gang that will work
  with you. ("Goods" have no system yet.)
server/game/systems/business.ts; `npx tsx scripts/business.ts`.

## E. Tag (small; done)
A room mode next to free roam, frag race and money race (server/rounds.ts): one player is "it" (red
ring, radar/map marker, "IT ·" off-screen); when "it" kills a player, that player is it; killing "it"
only slows them down. 10-minute rounds (while two or more play); least time "it" wins.
`npx tsx scripts/tag.ts`.

## F. Going into buildings, in place (large)
Walk through a door and the roof fades away: the floor plan shows from the same camera in the same
world, so friends see you inside and the city keeps running around you.
- F0. Design note (before code): docs/INTERIORS.md (written 2026-11-23; waiting on the user's two
  decisions: who sees inside, which buildings open).
- F1. (done) 30 walk-in ground floors (packs `interior`: gun shops, corner stores, gas kiosks, diners,
  clubs, warehouses; shared/world/interiors.ts): a room behind the storefront door, shell walls with a
  1.6 m door gap (people and bikes fit, cars don't), furniture by layout, the rest of the building
  solid; the building hides (render/hideable.ts) when you're at or in it on foot; a clerk behind
  each counter; business happens at the counter. Ground floor only, so no "floor" field yet: the
  walls are ordinary collision (bullets and sight stop at them). `npx tsx scripts/interiors.ts`.
  Police and gangs follow you in and out through the door gap, and patrol cars stop at the door and
  send their crew in (server/game/ai/doors.ts; 2026-11-23, `npx tsx scripts/indoors.ts`).
  Not yet: the dealership office; owners' back-room desk.
- F2. (done) Hand-made plans (packs/interiorPlans.ts) for the bank (lobby, tellers' counter, office,
  vault) and the police precinct (front desk with a desk sergeant, three barred cells, office). The
  bank job: the vault door is a collision gate; an explosion at it blows it open for everyone
  (`gates` message), six cash piles lie inside, the alarm goes out, the robber gets 4+ stars and a
  bank robbery on the record; it shuts and clears after RULES.vaultReset once nobody's inside
  (server/game/systems/vaults.ts). `npx tsx scripts/vault.ts`.
- F3. (done) Upper floors in the 3 office towers (elevator, offices off a corridor) and 12 apartment
  blocks (stairs, flats with a bed and a booth): up to 5 floors by building height. Each floor lives
  on its own strip off the map (shared/world/levels.ts, x + f·2560), so collision, the spatial hash,
  bullets and sight need no floor field: different floors simply never meet. Stand at the lift and
  press E for a floor list (server/game/systems/lifts.ts); AI chasing you walks to the door, the lift,
  and comes up after you. The client maps strip positions back over the building at the floor's
  height: the building hides, only your floor is drawn (render/interiors.ts), people on other upper
  floors aren't drawn, and sounds muffle per floor between you. Upstairs, snapshots still carry the
  street around the building. `npx tsx scripts/floors.ts`.

## Shop robberies (asked 2026-11-23; done)
Hold up the counter of a walk-in place whose pack spec has `robbery` (gun shops, gas kiosks, corner
stores, diners, nightclubs): hold Aim with a gun on the clerk and their hands go up; the till comes
out a little at a time while you keep them covered (RULES.robSeconds empties it). A few seconds in,
the silent alarm puts you on RULES.robWanted stars and an armed robbery on the record. Look away
too long, shoot the clerk or leave and it's over; some clerks go for a gun (`fightBack`). Tills
refill over RULES.tillRefill; another player's business is robbed from its safe and they get a
text; your own staff won't play along. server/game/systems/robbery.ts; `npx tsx scripts/robbery.ts`.

## H. Jobs with teeth (started 2026-11-23; story and cast in docs/STORY.md)
H1 first pass done: voiced calls (packs/calls.ts; clips by `npx tsx scripts/voice-calls.ts` with the
workbench voice tools) played as comic bubbles beside you through a payphone or cell line
(hud/talk.ts, audio/phoneVoice.ts): Benny's welcome on a newcomer's cell, each boss's introduction,
briefs per job kind, done / blown calls, busy and nothing-on. H2-H4 next.
The user: payphone jobs need better interaction, "comic bubbles or something", "GTA style scripts".
Today a job is one of five fixed kinds with a one-line brief in a banner.
- H1. The call: answering a payphone (or the cell) plays a short scripted exchange in comic speech
  bubbles: the gang's boss (a named character per gang, their own voice in the writing) and your
  replies, typed out, Enter / E / A to move on. You can still move while it plays (shared world, no
  pause). Hanging up mid-call turns the job down.
- H2. Scripts: a job is a list of steps in packs/ (nouns), run by engine verbs: go to, collect,
  kill, steal, deliver, destroy, survive, wait, follow, escort, defend, and `say` (the boss rings
  mid-job, or a bubble over someone in the world: the mark taunting, a lookout yelling). Steps can
  branch on what happened (the mark got away, the car's damaged).
- H3. Teeth: twists the script can throw (an ambush, the mark bolts in a car, a cop tip-off with
  stars, the package is a bomb on a timer, a double-cross by the giver); failing costs respect, and
  blowing a job badly can get a crew sent after you.
- H4. Story chains: each gang has a run of scripted jobs that unlock as they respect you more and
  end in a big job with a payoff (cash, a perk, the gang's turf going friendly); random odd jobs
  stay in between.

## I. Getting airborne (asked 2026-11-26)
Vehicles can leave the ground when they hit the right thing at speed: a ramp, a kerb or a car taken
at an angle, a raised road's edge, a bridge hump. Today car physics is flat (alt is helicopters only).
- I1. A vertical axis for wheeled vehicles in shared physics (height, vertical speed, gravity) with
  launch from sloped surfaces and hard hits, flight that keeps its heading and spin, and landings
  that hurt in proportion to the drop (damage, bounce, a lost wheel's worth of grip).
- I2. Things to launch off: ramps and jump spots as city props (packs: shapes and where they go),
  loading docks, parked trucks with lowered tailgates.
- I3. The view and sound: shadow left on the ground under a car in the air, the camera pulling out
  with height, a landing thump; other players see it (alt in the snapshot, as helicopters do).

## Monster truck (asked 2026-11-26; done)
The Earthshaker (packs `monster`, art/monster.py): a pickup shell on 1.7 m paddle tyres, coil-overs,
roll bar; `crushes` like the tank (a sedan it rams is wrecked, it takes ~2%). Sold at the dealer,
now and then parked in industrial lots. `npx tsx scripts/monster.ts`. Still to come with I: big
launches and surviving landings, the body bouncing on its suspension.

## J. Highways (asked 2026-11-26; removed)
Built, reworked three times, and taken out at the user's word: the user didn't want them. The
engine has no highway code any more. Lessons, if they ever come back: never on a street line; a
city takes the land out of its blocks; level on the ground, bridging only main streets.

## K. Trains (asked 2026-11-26; Bayhaven done, Redrock nouns with the Old West session)
A railway along one line (WorldSpec.railway: RailSpec; world/railgen.ts, server
systems/trains.ts, render/railway.ts). 'elevated' (Bayhaven's L): a viaduct on its own corridor
through the middle of the blocks (world/corridors.ts: a line with no street, the blocks backing onto
it, an alley under the viaduct), on its own way strip, its columns in that strip; stations
mid-block every few blocks with side platforms, canopies and named stair towers in the alley.
'grade' (meant for Redrock): track on the ground beside (or down) a road, low platforms, crossbucks.
Each train runs its own track end to end and back, stopping at every station. Press Enter at a
stair tower's door to take the next train (you wait there); Enter at a station gets you off by the
nearest exit. Cars are `movement: 'rail'` vehicles laid along the track (no physics), never
boarded like a car. `npx tsx scripts/trains.ts`. Not yet: AI traffic stopping at grade crossings,
riders other than players.

## Casino (asked 2026-11-26)
A walk-in casino (world/interiors.ts layout): gaming floor, cashier cage, security; games to play with
your money (cards, wheel, slots, kept simple and readable from the top-down view), house edge in the
pack's numbers; a heist hook later (the cage and the vault, like the bank).
Built (2026-11-27): rules in shared/games (cards, poker + pokerAi, house), tables placed by
world/tables.ts from packs TABLES / VENUES / FRIENDS, run by server systems/cardTables.ts,
cardPoker.ts (seated NPC players, cheats, call-outs), cardInvites.ts (gang invites, friends), shown in
the pane by client hud/cardTable.ts. Bayhaven: the Golden Anchor (verb 'casino', plan 'casino'),
three gang back rooms, Walt / Dee / Lenny's yard games. `npx tsx scripts/cards.ts`, `scripts/tables.ts`.
Redrock's saloons get theirs from the Old West session (a VenueSpec on layout 'saloon', mix: true).
Decided with the user (2026-11-26):
- Games open in the slide-in pane, the same pattern as the shops.
- Bayhaven's casino: craps, slots, roulette, blackjack, Texas hold'em.
- Redrock's saloons (the casino of the western): 5-card draw, 5-card stud, twenty-one, faro,
  hazard; not every saloon has every game, a bigger saloon more of them (mix and match).
- Bayhaven: gang-run poker games, mob style, high stakes, invite only the first time.
- Bayhaven: house games with civilian friends (buddies in a garage, not gangsters): you meet them,
  call them up for a game, or they invite you.
- Poker AI gets better as the stakes rise: a garage game isn't hard but doesn't pay much.
- Cheating (a pack switch, on in the western, switchable in Bayhaven): slip in an ace, stack the
  deck on your own deal, peek at the cards of the players next to you. Caught: the man across stands,
  draws and shoots you dead. AI cheats too, rarely; call one out: right, you draw and kill him, no
  shootout; wrong, a shootout. Cheating mustn't be rampant.

## Scopes decide the aim zoom (asked 2026-11-26)
Holding Aim zooms the camera in (render/camera.ts SCOPE_ZOOM, one fixed amount today). Make the zoom
come from the weapon in hand: a scope attachment (a pack noun: its magnification, the reticle it
shows) sets how far the view closes in and how far out you can aim; no scope, a small zoom or
none. Needs weapon attachments: which weapons take a scope, buying or finding one, fitting it, and
the scope showing on the weapon model and the HUD.

## G. Mobile (parked, 2026-11-23)
The user wants the website usable on a phone: not a mobile port (no touch-control scheme, app install
or radio re-encodes unless asked). Parked for now; when it comes back, keep it to that.
