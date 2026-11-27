# GRIDLOCK

Top-down multiplayer crime sandbox (original city "Bayhaven"), up to 6 players per room.
Server-authoritative Node simulation + three.js browser client. Read `docs/STATUS.md` first.

## Run
- `npm run dev` — game server (tsx watch, port 5228) + Vite client (port 5229, proxies `/ws` and `/api`).
- `npm run play` — local production: builds the client into `dist/` and serves everything on one port (5228).
- `npm start` — serve only (expects `dist/`); Railway runs `npm run build` then this (`railway.json`, honours `PORT`).
- `npm run smoke [seconds]` — headless 6-bot soak test (tick time, NaN checks, message sizes).
- `npx tsx scripts/universe.ts <universe> <script> [args]` — any check in another universe
  (e.g. `redrock smoke 60`); `npx tsx scripts/redrock.ts` checks the western, `scripts/terrain.ts` its hills.
- Client URL `?u=<universe>` boots that universe (the lobby's Universe selector remembers it).
- `npx tsx scripts/citystats.ts [seed]` — city generator stats.
- Client URL params: `?play=Name#CODE` auto-joins (creates a room if no code), `?mute` silences audio.
- Dev hooks in the browser: `window.__game` (client Game), `window.__forceTime = minutes` (local time of day).

## Architecture rules
- **Universes.** The engine runs one "universe" per process (docs/ENGINE.md). Each is a folder
  `src/universes/<id>/` whose `index.ts` exports a `Universe` (types in `src/shared/packs/types.ts`):
  weapons, vehicles + box models, ped archetypes, factions, zones, districts, services, properties,
  wanted levels, crimes, missions, radio, looks, call scripts; `client.ts` its browser assets.
  Bayhaven (`src/universes/bayhaven/`) keeps its content in the top-level `content/`, models in
  `src/client/models`, voices in `src/client/voice`. A new universe is listed in `src/universes/index.ts`
  and `client.ts`. `src/shared/packs/index.ts` is the registry the engine imports (`VEHICLES`, `RULES`,
  ...), filled in place by `installUniverse` (the default universe until something else is installed);
  `packs/defaults.ts` holds the engine's default rules, which a universe overrides.
- **Nouns and verbs.** Universes hold all content. Engine code never names a pack id;
  it reads fields (`behaviour`, `verb`, `roles`, `movement`, ...). Add content by editing a universe only.
  What a verb or movement kind *does* lives in one engine table each: `src/shared/verbs.ts` (service
  verbs: site, pad, garage door, automatic, shop) and `src/shared/sim/kinds.ts` (movement kinds:
  `flies`, `skids`, `floats`), and what a vehicle's `material` does in `src/shared/materials.ts` (metal
  sparks, dents, smokes, burns and blows up; flesh bleeds and lies down; wood). Ask the table
  (`flies(spec)`, `materialOf(spec)`), never compare against a kind, verb or material in a system.
- **Shared determinism.** `generateCity(seed)` runs on server and every client and must stay bit-identical:
  generation uses only `Rng` and arithmetic (no trig). `src/shared/sim/physics.ts` movement is shared so the
  client can predict its own avatar; keep it pure.
- Files stay under ~300 lines; split by responsibility (systems/, ai/, render/, hud/).
- Wire format: `src/shared/protocol.ts`. Entity arrays are positional; change both ends together and bump
  `PROTOCOL_VERSION`.

## Layout
- `src/shared/world` city generation (roads → blocks → lots → places), lookups (`CityMap`), static collision.
- `src/server/game/systems` per-tick systems: players, movement, contacts, projectiles, wanted, dispatch,
  population, economy, snapshot. `ai/` brains: behaviours (personalities) → tasks (verbs), driving, routing.
- `src/client/render` scene, chunked ground canvas, instanced city, vehicle/ped meshes, particles/effects.
- `src/client/hud` DOM HUD, radar/map, slide-in panes (shops, properties, menu).
