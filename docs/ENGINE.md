# Engine: one engine, many universes

Decided with the user on 2026-11-26. GRIDLOCK's engine becomes shared: a player picks a
"universe" at startup (Bayhaven or Redrock Territory), and the
map, models, vehicles, weapons, people, factions, missions, voices, radio and sounds all come from
that universe's packs. The game feel never changes: top-down, GTA2 movement, camera and controls.
Not a fork: one engine, every universe gets every engine fix.

Universes we build are original settings (genre and mechanics borrowed, never another game's or
film's names, characters, story, map or look).

## Phases

1. **Engine hygiene** (done 2026-11-26, branch `worktree-engine-phase1`). No visible change.
   - Engine code no longer names pack ids: traffic crews come from `ROLE_CREWS` (packs/rules.ts);
     lawful / witness factions are pack flags (`lawful`, `witness`); `RULES.clerk`,
     `RULES.counterGun`; zone flags `warehouses`, `busy`; fallbacks pick by behaviour or role.
   - Service verbs' traits in one table, `src/shared/verbs.ts` (site, pad, garage, automatic,
     driveUp, shop), replacing five scattered sets.
   - Movement kinds' traits in `src/shared/sim/kinds.ts` (`flies`, `skids`, `floats` for boats);
     systems ask `flies(spec)` / `floats(spec)`. `sim/physics.ts` still picks the step per kind (that is the verb).
   - Feature switches: `RULES.cellPhone` (without it, texts are notices and work comes from
     payphones); radio is on when packs/radio.ts lists stations; ATMs where specs say `atm`;
     payphones per `RESPECT.phonesPerGang`.
2. **Universe folders** (done 2026-11-27). `src/universes/<id>/index.ts` exports a `Universe`
   (packs/types.ts): every noun list, rule overrides (engine defaults in packs/defaults.ts), radio,
   looks, call scripts and its `contentDir`; `client.ts` its browser assets (models, voices), a
   chunk of their own. `src/universes/index.ts` / `client.ts` list them. The registry
   (packs/index.ts) keeps the names the engine imports and `installUniverse` fills them in place,
   so call sites didn't change; the default universe is installed until another is. Rule: install
   before importing game code (client/main.ts boots the universe, then imports the lobby). Radio
   routes carry the universe (`/api/radio?u=`, `/radio/<universe>/<station>/<file>`). Bayhaven's
   assets stay where they were (content/, src/client/models, src/client/voice).
3. **Universe per room** (done 2026-11-27). The server (`new Lobby({ universes })`) runs each room
   in a worker thread of its own (server/workerRoom.ts proxy, server/roomWorker.ts entry) that
   installs the room's universe before loading the game; sockets stay on the main thread and the
   room's messages cross as strings. A room's universe is the running room's, else its save's
   (persist.ts savedUniverse), else the creator's; a page from another universe is refused with
   `reject.universe` and switches to it. Characters are fully checked inside the room's thread; the
   lobby only peeks at id/name/universe. Headless scripts keep in-process rooms (roomHost.ts
   LocalRoom). Hello carries `universe`, listings carry it (protocol 17). `scripts/rooms.ts`
   covers both.
4. **Start screen** (done 2026-11-27). The lobby card shows a Universe selector (with its blurb)
   once there's more than one; changing it stores the choice and reloads. Characters and open rooms
   are listed for the current universe only.
5. **Maps as data** (done 2026-11-27). Decided while building it: roads stay axis-aligned. GTA2's
   own world is a tile grid, the feel must stay GTA2's, and keeping the grid means traffic AI,
   routing, GPS and signals work unchanged in every universe. What became data instead:
   `Universe.world` (packs/types.ts WorldSpec; defaults in shared/world/worldSpec.ts = Bayhaven):
   map size, margin, edge (`sea` | `cliffs`: solid rock walls, no coast), a river or none, road
   spacing near the centre / edges, arterial frequency, bare-land colour. MAP_SIZE / LAND0 / LAND1
   are live values from it. Open country: zones with `layout: 'wild'` merge into big blocks between
   arterials; between wild cells there's only a road on arterial lines, drawn as a dirt trail
   (`Segment.trail`, trail-sized crossings, no lights or markings); `ZoneSpec.wild` scatters rock
   formations (`Obstacle.kind 'rock'`, solid: buttes and outcrops) and ponds (`City.ponds`, water
   for isWater / boats) and tints the ground. A hand-made map file and an in-game editor are not
   built; a universe shapes its map with these settings and its districts.
6. **Second universe: Redrock Territory** (first slice done 2026-11-27; `src/universes/redrock/`).
   An original 1870s territory on the same engine and feel: three timber towns (Sulphur Springs,
   Copper Gulch, Calloway) on dirt streets, homesteads, prairie with ponds and outcrops, red
   badlands of buttes, a river with crossings, cliffs all round (2.5 km map). Horses (mustang,
   quarter horse, draft, thoroughbred) and wagons (buckboard, covered wagon, stagecoach; a team in
   harness pulling the wagon on the trailer physics). Six-shooter, double-barrel, lever rifle,
   buffalo rifle, dynamite, lamp oil; gatling wagon at the fort. Three outlaw outfits posting work
   on job posts; deputies, marshals and a posse on horseback, the cavalry at the top. Gunsmith,
   livery stable, doctor, sheriff's office (cells), bank (vault), fire hall; homesteads, saloons,
   general stores, hotels, barns to own. Money in frontier dollars.
   Engine verbs it added: movement kind `legs` (no wheels, rider astride), `VehicleSpec.wrecks:
   'fall'` (goes down, riders thrown, no fire), `WorldSpec.modern` (off: dirt streets, no
   markings/lights/street furniture/rooftop machinery, earthen yards), `RULES.jobPost: 'post'`
   (timber post with a bell, no ring), `RULES.graffiti`, map legend from the universe's place names.
   Checks: `npx tsx scripts/redrock.ts`; any script in a universe: `npx tsx scripts/universe.ts
   redrock smoke 60`.
   Horses (2026-11-27): gaits and wind (`VehicleSpec.stamina`: a canter without Sprint, a gallop
   with it until blown, back to a gallop at 30% wind; AI riders gallop to chase or flee; the wind is
   sent as `YouState.st` so prediction matches; a wind bar on the HUD), the whistle (H on foot /
   L3: `comesWhenCalled`; the last horse you rode comes, round a corner if it's far or stuck;
   server/game/systems/mounts.ts), hitching (G while stopped / X: `VehicleSpec.hitch` and
   `hitchAs`; a wagon unhitches into a team and a seatless standing wagon, and a team backed onto
   a pole hitches on; systems/hitching.ts). Protocol 20.
   Horse movement is its own verb (2026-11-27): sim/mount.ts `stepMount`, chosen by
   `VehicleSpec.gaits` (walk/trot/canter/gallop speeds, pick-up and let-go, turn rate standing and
   at a gallop, backing up): it goes where it points (no slide), eases down through its gaits,
   turns on the spot standing, shies at walls without damage. Breeds differ only in those numbers.
   Legs swing by gait (render/legs.ts): parts tagged `leg_fl/fr/rl/rr` (box or Blender), the gait
   read from the speed it's really going. Blender models (art/horse.py, tack.py, team.py,
   wagon*.py; `build.py --universe redrock` → src/universes/redrock/models/*.glb): six breeds in
   saddle, teams in harness, buckboard, covered wagon, stagecoach, buggy, water and gatling wagons,
   standing wagons, and the period guns.
   What a vehicle is made of is a noun too (`VehicleSpec.material`; shared/materials.ts says what
   each does): metal sparks, dents, smokes and blows up; flesh (horses, teams) bleeds where it's
   hit, never smokes or burns, and dead lies on its side in its own colours; wood (standing
   wagons) kicks up dust and goes down. (Replaced the earlier `wrecks: 'fall'`.)
   Temperament is a noun (`VehicleSpec.temper`: nerve, buck, lame); systems/spook.ts is the verb.
   Gunfire, blasts and deaths nearby (ai/reactions.ts onNoise) can spook a horse: it rears (no
   control for a moment), may throw its rider (hurt, thrown clear), and loose it bolts from the
   noise before settling. A rider's own shots don't spook their own horse. Hurt below `lame`
   (a share of hp) it limps: no gallop, no faster than a trot, the near foreleg favoured; it heals
   slowly. Hot thoroughbreds spook far more than drafts or army horses. Sent as `VF.rearing`,
   `VF.lame` and `YouState.ml` so prediction holds the reins too. Protocol 21.
   Face to face (2026-11-26): on foot, E next to someone talks to them (client game/faceTalk.ts
   finds the nearest talker nearer than any vehicle; server systems/faceTalk.ts). Who they speak as
   is a noun, `PedArchetype.talker` (a cast id); their lines are the cast's call scripts under the
   situations `greet`, `rumour`, `scared`, plus the job kinds, `busy`, `nothing` and `refuse` for a
   gang's people. They stop and face you (AI task `chat`); wanted or aiming, frightened folk say so
   and run; one of a gang's riders gives you its work in person, on the job posts' terms (no work
   below `noWorkBelow`, a wait between jobs). Bubbles are drawn over the speaker with a plain tail
   (`talk` with `via: 'face'` and `ped`). A cast member's `voice` is optional: unvoiced lines show
   for as long as they take to read. Redrock's cast: townsfolk, settlers, prospectors,
   storekeepers, the bank guard, lawmen, troopers, gamblers and a rider for each outfit.
   Protocol 22. Your side too (PlayerSituation `greet`, `work`, `take`, `leave`): you open, they
   answer (and maybe pass on news), you take your leave; with a gang's rider you ask for work,
   he briefs it, you take it. Redrock has its own player file (content/redrock/player), all in a
   frontier voice, and doesn't load Bayhaven's recorded player lines.
   Breeds (2026-11-26) differ like cars: speed, wind, pick-up, turning, size, toughness, price,
   temperament. Ten saddle animals: mustang, quarter horse (sprinter), Morgan, Arabian (longest
   wind), thoroughbred (fastest, tallest), Indian pony (small, nimblest), draft (big, slow), mule
   (slowest, unflappable, goes all day), and the law's and army's horses. The saddle and rider
   heights follow each one's size. Real walk/trot/canter speeds; gallops 10-17 m/s.
   Terrain (2026-11-26), "relief you can see": one height map for the world (shared/world/
   relief.ts: integer-hash value noise, no trig, so server and clients agree) shapes open country
   without changing movement. Nouns per wild zone (WildSpec): `relief` (m), `low`/`high` colours,
   `strata` (rock layers banding steep slopes), `boulders`, `brush`. The ground (render/
   groundRelief.ts) is coloured by height and slope and hillshaded from the north-west, zones fray
   into each other along wandering edges; fine round grain over it. Rock (world/landforms.ts,
   City.rocks) is round in plan and solid as circles: formations of mesa/butte columns on the high
   ground with talus at their feet, and loose boulders (render/rocks.ts: stepped, banded columns and
   faceted stones). Brush (render/brush.ts) is 3D bushes, not solid, thickest in the washes, built
   and dropped with each ground chunk.
   Real land (2026-11-26): WorldSpec.terrain { scale } gives open country real height and
   landforms; Bayhaven has none and stays flat. world/terrainGen.ts builds, in generateCity, smooth
   fields on an 8 m grid (City.terrain): the broad swell (relief.ts `swell`: the long octaves only,
   (swell - 0.5) x WildSpec.relief x scale); plateaus (WildSpec.mesas { cover, height }: rims where
   a noise field crosses the level its cover asks for, held back ~16 m from trails along a wavering
   line, a second tier on tall ones, `ramp` noise breaking a rim into a climbable slope); gorges
   (WildSpec.gorges { cover, depth, width, river }: courses where another field crosses a half,
   opened by a slow gate). Each zone's nouns blend over ~80 m. Towns, ponds and the river (plus a
   step round them) and a grade railway's bed are level, the land easing in over 60 m (wobbled
   distance transform). world/terrain.ts `groundOf` interpolates the fields and applies the sharp
   profiles at each point asked: a mesa's 5 m sheer wall over a talus skirt, a canyon's sheer walls
   (a ledge in wide ones) and flat floor, a river on deep floors (`water`: CityMap.isWater counts
   it). Trestles: wherever a trail crosses a cut over 1.2 m, a deck from rim to rim (Terrain.
   trestles, indexed per cell); groundOf stands you on it (`raw` ignores decks). Generation clears
   rock, fixtures and trees off cliff faces, canyon walls and rivers (clearLand). Redrock: prairie
   swells with low benches and creek ravines; badlands mesas 16 m (+7 tier) and 12 m canyons;
   about -22..+25 m. Bodies keep z over their own ground. Movement (shared, predicted): top speed
   x slopeFactor of the grade (a 10% climb about -25%, descents up to +10%, never below 40%);
   wheels feel 0.6 g along it; moveOnGround holds any ground body back from a step steeper than
   CLIFF (1.25) and slides it along the edge, no crash (one already on a face may move down off it).
   StaticWorld.raycast (shots, lookouts, witnesses, robbery, AI sight) is blocked where the ground
   rises over the line between two eye heights (terrainHit). Lobbed projectiles fly at true height;
   straight shots keep their height over the ground. Client: installTerrain + `groundAt`;
   heightAt (ways.ts) adds it, so everything drawn follows the land, mounts and wagons pitched.
   Ground chunks (render/terrainMesh.ts) are bent planes, a vertex every 2 m (1 m in chunks with
   cliffs), normals from the land itself, casting and receiving shadow; steep faces are drawn in the
   zone's strata by height in the shader. The painting (groundRelief.ts) reads as a relief map from
   straight above: hillshade from the true slopes, darker down in canyons, a bright lip on rims,
   rivers on gorge floors. render/trestles.ts: plank deck, rails, braced bents down to the floor.
   A chunk builds in 11-19 ms. Check: scripts/terrain.ts.
   Soundtrack (2026-11-26): music that isn't a radio (the western has no stations). Songs in
   <contentDir>/soundtrack/, tracks.json giving each its title and `regions` (zone ids; none =
   anywhere). Server: server/soundtrack.ts lists and serves them (/api/soundtrack, /soundtrack/).
   Client: audio/soundtrack.ts plays one at a time, never cut short; after a short quiet the next
   comes from the region you're in then (shared/soundtrack.ts nextSong: your zone's, else the
   untagged, else any; never the same twice running). Music volume; ?mute never starts it.
   Fixtures (2026-11-26): Universe.fixtures (FixtureSpec) are things the world places at
   generation (shared/world/fixtures.ts, City.fixtures): parts in a few shapes (box, cyl, cone,
   gable; `spin` turns), a footprint, solid as a box, a trunk (circle) or a ring with a gate
   (corrals), and a `site`: a street lot in place of its building, a town square, a homestead yard,
   open country (with the rock), or beside a railway station. Drawn merged and instanced
   (render/fixtures.ts). Redrock's: church, water tower, gallows; barn, corral, windmill, well,
   shed, outhouse; saguaro, prickly pear, skulls; depot and the railroad's water tower. Also a
   'saloon' interior layout (bar, back-bar, card tables, piano), WANTED bills on job posts,
   tumbleweeds rolling on the wind (render/tumbleweeds.ts, scenery only), livestock
   (VehicleSpec.grazes, systems/graze.ts: Longhorn cattle graze the range and scatter at gunfire),
   and the railroad (world.railway at grade down a Front Street; RailSpec.ends puts a locomotive
   at each end of a train). WorldSpec.pedScale: Redrock draws people at 1.1x, the size they ride at,
   true to its real-size horses (Bayhaven keeps 1.55x for its cars). Level crossings: a computer-
   driven rider or wagon holds short of the track while a train is within 70 m of the crossing
   (ai/crossings.ts). Blender models for the locomotive and coach (art/rail.py) and the Longhorn
   (art/cow.py: the horse body with a cow's proportions as spec overrides, plus horns).
   Wind (VehicleSpec.stamina.recover): Redrock's saddle horses gallop 25-80 s by breed (most about
   a minute) and get it back about as fast. Card games in the saloons (redrock/tables.ts): draw
   poker from $1/$2 to $10/$25, stud, twenty-one, faro and hazard, each saloon its own mix; an
   outfit's back room plays outlaws' draw; caught cheating, you're shot.
   Not yet: voices for its cast and your lines (they show in bubbles), era
   sounds (a bell, hooves, whinnies); the gatling gun doesn't traverse (trailer parts don't animate).
