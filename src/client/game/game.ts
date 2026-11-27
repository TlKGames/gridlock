// Client game: owns rendering, input, prediction and HUD for one connected session.
import { type BuyKind, type InputMsg, Mode, type PlayerInfo, type Profile, type S2C, type TableView, TICK_HZ, type YouState } from '../../shared/protocol';
import { CityMap, generateCity } from '../../shared/world/city';
import { StaticWorld } from '../../shared/world/collision';
import { groundOf, isWayStrip } from '../../shared/world/levels';
import { heightAt, installWays } from '../../shared/world/ways';
import { installTerrain } from '../../shared/world/terrain';
import { RailwayView } from '../render/railway';
import { joinScreen, tableScreen, type TableSend } from '../hud/cardTable';
import { TableRoom } from '../hud/tableRoom';
import { autoAct } from '../hud/pokerTable';
import { knownVenues } from '../hud/cardMarks';
import { type CardVenue, cardVenues } from '../../shared/world/tables';
import { Radio } from '../audio/radio';
import { Soundtrack } from '../audio/soundtrack';
import { Sound } from '../audio/sound';
import { Hud } from '../hud/hud';
import { openMenu } from '../hud/menu';
import { dealerShop } from '../hud/dealerShop';
import { gunShop } from '../hud/gunShop';
import { Showroom } from '../hud/showroom';
import { verbOf } from '../../shared/verbs';
import { OffscreenPlayers } from '../hud/offscreenPlayers';
import { Phone } from '../hud/phone';
import { Talk } from '../hud/talk';
import { Crosshair, zoomFloor } from '../hud/crosshair';
import { PaintGarage } from '../hud/paintGarage';
import { cleanVoice, RULES, SERVICES, VEHICLES, ZONES } from '../../shared/packs';
import { floats } from '../../shared/sim/kinds';
import { vehicleObstacles } from './obstacles';
import { MAP_SIZE, type Place } from '../../shared/world/cityTypes';
import { BigMap } from '../hud/bigMap';
import { Minimap } from '../hud/minimap';
import { JobRoute, type Mark, Waypoint } from './waypoint';
import { Pane } from '../hud/pane';
import type { Connection } from '../net/connection';
import { EntityStore } from '../net/entities';
import { ChaseCamera } from '../render/camera';
import { CityMeshes } from '../render/cityMeshes';
import { Effects } from '../render/effects';
import { Graffiti } from '../render/graffiti';
import { Ground } from '../render/ground';
import { Tumbleweeds } from '../render/tumbleweeds';
import { Stage } from '../render/scene';
import type { StreetProps } from '../render/streetProps';
import type { StreetPropsView } from '../render/breakables';
import type { FixturesView } from '../render/fixtures';
import { Storefronts } from '../render/storefronts';
import { addAtms } from '../render/atms';
import { GasStations } from '../render/gasStations';
import { Interiors } from '../render/interiors';
import { GameTables } from '../render/gameTables';
import { atmsOf } from '../../shared/world/atms';
import { Water } from '../render/water';
import { type OwnState, type PlayerTag, WorldView } from '../render/worldView';
import { routeFx } from './fxRouter';
import { makeAimAssist } from './aimAssist';
import { Steering } from './steering';
import { Input } from './input';
import { lawUnits, nearestSiren, ownEngine, signalGlows, trafficEngines } from './ambient';
import { FaceTalk } from './faceTalk';
import { Interact } from './interact';
import { Jobs } from './jobs';
import { Predictor } from './predict';
import { QualityGovernor } from './quality';

const STEP = 1 / TICK_HZ;

export class Game {
  private map: CityMap;
  private stage: Stage;
  private store = new EntityStore();
  private cam: ChaseCamera;
  private ground: Ground;
  private tumbleweeds: Tumbleweeds;
  private view: WorldView;
  private fx: Effects;
  private input: Input;
  private predict: Predictor;
  private hud = new Hud();
  private radar: Minimap;
  private pane = new Pane();
  private garage = new PaintGarage();
  private shop = new Showroom();
  private offscreen: OffscreenPlayers;
  private phone: Phone;
  private talk: Talk;
  private faceTalk: FaceTalk;
  private crosshair: Crosshair;
  private gas: GasStations;
  private interiors: Interiors;
  /** The client's collision world (prediction); vault gates mirror the server's. */
  private statics: StaticWorld;
  private interact: Interact;
  private jobs: Jobs;
  private sound = new Sound();
  private radio = new Radio(new URLSearchParams(location.search).has('mute'));
  private soundtrack = new Soundtrack(new URLSearchParams(location.search).has('mute'));
  private you: YouState | null = null;
  private players: PlayerInfo[] = [];
  private owners = new Map<number, string>();
  private profile: Profile = { garage: [], owned: [] };
  private gameMinutes = 720;
  private seq = 0;
  private acc = 0;
  private last = performance.now();
  private running = true;
  private bigMap: BigMap;
  private waypoint: Waypoint;
  private jobRoute: JobRoute;
  private chatting = false;

  constructor(private conn: Connection, private myId: number, private code: string, seed: number, private onLeave: () => void) {
    const city = generateCity(seed);
    installWays(city.ways);
    installTerrain(city.terrain);
    this.map = new CityMap(city);
    const statics = this.statics = new StaticWorld(city);
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    this.stage = new Stage(canvas);
    this.cam = new ChaseCamera(this.stage.camera);
    this.ground = new Ground(this.stage.scene, this.map, this.stage.renderer);
    this.tumbleweeds = new Tumbleweeds(this.stage.scene, this.map);
    const meshes = new CityMeshes(this.stage.scene, city);
    this.fx = new Effects(this.stage.scene, this.stage.flash);
    this.railway = new RailwayView(this.stage.scene, city, (x, y) => this.map.isWater(x, y));
    this.water = new Water(this.stage.scene, this.map);
    this.view = new WorldView(this.stage.scene, this.fx, meshes.lamps, this.railway.fade, this.water.fade);
    this.input = new Input(canvas);
    this.predict = new Predictor(statics, this.map);
    this.furniture = meshes.furniture;
    this.fixtures = meshes.fixtures;
    this.predict.furniture = meshes.furniture; // your car knocks street props over at once
    this.radar = new Minimap(this.map);
    this.jobs = new Jobs(this.stage.scene, this.hud.root, city);
    this.jobs.myId = myId;
    this.offscreen = new OffscreenPlayers(this.hud.root);
    this.phone = new Phone(this.hud.root);
    this.talk = new Talk(this.hud.root, this.sound);
    this.faceTalk = new FaceTalk(this.store, this.talk);
    this.crosshair = new Crosshair(this.hud.root);
    // A call on your cell: the handset shows who's on the line while they talk.
    this.talk.onLine = (who, via) => { if (via === 'cell') this.phone.line(who); };
    this.phone.send = (msg) => conn.send(msg);
    this.phone.ring = () => this.sound.tune('ringtone');
    this.phone.textTone = () => this.sound.tune('text');
    this.phone.onText = (from) => this.hud.notify(`New message from ${from}`, 'info');
    this.phone.playVoicemail = (parts) => this.talk.play({ t: 'talk', via: 'cell', parts });
    this.interact = new Interact(city, this.pane);
    this.hud.onChat = (text) => conn.send({ t: 'chat', text });
    this.input.onUi = (a) => this.ui(a);
    // The pad drives whichever overlay is up: the paint shop, the map (B closes it) or the pane.
    this.input.onNav = (c) => {
      if (this.garage.isOpen) this.garage.nav(c);
      else if (this.shop.isOpen) this.shop.nav(c);
      else if (this.tables.isOpen) this.tables.nav(c);
      else if (this.phone.capturing || this.phone.ringingNow) this.phone.nav(c);
      else if (!this.bigMap.isOpen) this.pane.nav(c);
      else if (c === 'back') this.bigMap.close();
      else this.bigMap.nav(c);
    };
    this.bigMap = new BigMap(this.hud.bigmap, this.hud.bigmapCanvas, this.map);
    this.waypoint = new Waypoint(city);
    this.jobRoute = new JobRoute(city);
    // Your waypoint goes to the server too: whoever rides with you sees it, in your colour.
    this.bigMap.onWaypoint = (p) => {
      const o = this.ownState(1);
      this.waypoint.set(p, o);
      conn.send({ t: 'waypoint', at: p ? [p.x, p.y] : null });
    };
    this.waypoint.onArrive = () => { this.hud.notify('Waypoint reached', 'info'); conn.send({ t: 'waypoint', at: null }); };
    // Browsers only reveal a controller after one of its buttons is pressed: say when one is seen.
    // Only standard gamepads count (sticks, throttles and headsets also report as gamepads).
    const padName = (g: Gamepad) => g.id.replace(/\s*\(.*$/, '') || 'gamepad';
    window.addEventListener('gamepadconnected', (e) => { if (e.gamepad.mapping === 'standard') this.hud.notify(`Controller connected: ${padName(e.gamepad)}`, 'info'); });
    window.addEventListener('gamepaddisconnected', (e) => { if (e.gamepad.mapping === 'standard') this.hud.notify('Controller disconnected', 'warn'); });
    conn.on((m) => this.onMessage(m));
    // Ctrl is the default fire key: guard against Ctrl+W / Ctrl+R closing the game by accident.
    if (import.meta.env.PROD) window.onbeforeunload = (e) => { if (this.running) e.preventDefault(); };
    this.buildingUniforms = meshes.uniforms;
    this.props = meshes.props;
    this.storefronts = new Storefronts(this.stage.scene, city);
    addAtms(this.stage.scene, atmsOf(city));
    this.gas = new GasStations(this.stage.scene, city);
    this.interiors = new Interiors(this.stage.scene, city, new GameTables(this.stage.scene, city).drawn);
    if (RULES.graffiti) new Graffiti(this.stage.scene, city, meshes.graffitiSpots);
    this.quality = new QualityGovernor(this.stage);
    this.quality.onAuto = (q) => this.hud.notify(`Graphics set to ${q} for a smoother frame rate (Esc to change)`, 'info');
    requestAnimationFrame(() => this.frame());
  }

  private railway: RailwayView;
  private buildingUniforms: { uNight: { value: number } };
  /** The table you're sat at, as the server shows it; friends whose number you have. */
  private tableView: TableView | null = null;
  private friends = new Set<string>();
  /** Gangs whose back-room game you've been asked to; the card games on the maps. */
  private gangGames = new Set<string>();
  private cardMarks: CardVenue[] = [];
  private allVenues: CardVenue[] | null = null;
  private refreshCardMarks(): void {
    this.allVenues ??= cardVenues(this.map.city);
    this.cardMarks = knownVenues(this.allVenues, this.friends, this.gangGames);
  }

  /** A card or casino table's screen (hud/tableRoom.ts): sit down (or meet the friend whose game it
   *  is), then play. Leaving it gets you up from the table. */
  private openTable(id: number): void {
    const spot = this.map.city.tables[id];
    if (!spot || !this.you || this.tables.isOpen) return;
    const send: TableSend = (m) => this.conn.send({ t: 'table', ...m });
    this.input.enabled = false;
    this.input.release();
    this.tableSeated = false;
    this.tables.open({
      screen: (a) => (this.tableView && this.tableView.id === id
        ? tableScreen(spot, this.tableView, this.you!, send, a)
        : joinScreen(spot, this.you!, (k) => this.friends.has(k), send)),
      leave: () => { if (this.tableView) send({ op: 'leave' }); },
      close: () => { this.input.enabled = true; this.tableSeated = false; },
    });
  }
  private tables = new TableRoom();
  /** You've sat down at the open table (so its view going away means you were put out). */
  private tableSeated = false;
  private props: StreetProps;
  private furniture: StreetPropsView;
  private fixtures: FixturesView;
  private water: Water;
  private storefronts: Storefronts;
  private quality: QualityGovernor;

  /** Signal lamps follow the server clock; they also cast a small coloured glow. */

  private ui(a: string): void {
    switch (a) {
      case 'action':
        // One key for everything: a shop/property door (or the dealer lot) opens its menu,
        // otherwise get into the nearest car or out of this one.
        if (this.pane.isOpen) { this.pane.close(); break; }
        if (!this.interact.current && this.faceTalk.ped) { this.conn.send({ t: 'talk', ped: this.faceTalk.ped }); break; }
        if (!this.interact.current) { this.input.pressEnter(); break; }
        if (!this.interact.current.property && verbOf(this.interact.current.place.verb)?.shop) { this.openShop(this.interact.current.place); break; } // shop counter (hud/showroom.ts)
        if (this.interact.current.place.verb === 'table') { this.openTable(this.interact.current.place.id); break; } // a card or casino table (hud/cardTable.ts)
        if (this.you) this.interact.toggle(() => this.you!, () => this.profile, this.owners, (kind, id, place) => this.conn.send({ t: 'buy', kind, id, place }));
        break;
      case 'chat':
        if (this.chatting) return;
        this.chatting = true;
        this.input.enabled = false;
        this.input.release();
        this.hud.openChat(() => { this.chatting = false; this.input.enabled = true; });
        break;
      case 'map': {
        const o = this.ownState(1);
        if (this.bigMap.isOpen) this.bigMap.close(); else this.bigMap.open(o?.x ?? MAP_SIZE / 2, o?.y ?? MAP_SIZE / 2);
        break;
      }
      case 'phone': if (RULES.cellPhone && !this.garage.isOpen && !this.shop.isOpen && !this.tables.isOpen) this.phone.button(); break;
      case 'menu':
        if (this.garage.isOpen) { this.garage.leave(); return; }
        if (this.shop.isOpen) { this.shop.leave(); return; }
        if (this.tables.isOpen) { this.tables.back(); return; }
        if (this.phone.isOpen) { this.phone.close(); return; }
        if (this.bigMap.isOpen) { this.bigMap.close(); return; }
        if (this.pane.isOpen) this.pane.close();
        else openMenu({ pane: this.pane, sound: this.sound, quality: this.quality, input: this.input, code: this.code, record: () => this.profile.felonies ?? {}, leave: () => this.leave() });
        break;
      case 'radio': {
        // The car's radio: everybody riding in it hears the change.
        const station = this.radio.next();
        if (station !== null) this.conn.send({ t: 'radio', station });
        break;
      }
      case 'scoreOn': this.hud.showScore(true, this.players, this.code); break;
      case 'scoreOff': this.hud.showScore(false, this.players, this.code); break;
    }
  }

  private onMessage(m: S2C): void {
    if (m.t === 'talk') { this.talk.play(m); return; }
    // No cell phone in this pack: texts are just notices.
    if (m.t === 'text' && !RULES.cellPhone) { this.hud.notify(`${m.from}: ${m.body}`, 'info'); return; }
    if (this.jobs.onMessage(m) || this.phone.onMessage(m)) return;
    switch (m.t) {
      case 's':
        if (!this.you) document.getElementById('loading')!.hidden = true;
        this.store.ingest(m.st, m.e, m.k);
        this.gameMinutes = m.gt;
        this.you = m.you;
        this.predict.reconcile(m.you, m.ack);
        routeFx(m.fx, this.fx, this.sound, this.store, this.cam, (pid) => this.view.swing(pid), m.you.pid, (pid) => this.view.muzzle(pid));
        break;
      case 'players': this.players = m.list; this.jobs.players = m.list; break;
      case 'props': this.furniture.setDown(m.down); break;
      case 'gates':
        this.statics.openGates.clear();
        for (const k of m.open) this.statics.openGates.add(k);
        this.interiors.setVaults(m.open);
        break;
      case 'owners':
        this.owners = new Map(m.list.filter((o): o is [number, string] => o[1] !== null));
        this.storefronts.setOwners(this.owners);
        break;
      case 'profile': this.profile = m.p; break;
      case 'table':
        this.tableView = m.v;
        if (m.v) this.tableSeated = true;
        else if (this.tableSeated && this.tables.isOpen) this.tables.leave(false); // thrown out, or shot
        // Poker: what you ticked to do when it came round to you (hud/pokerTable.ts).
        if (m.v) autoAct(m.v, (msg) => this.conn.send({ t: 'table', ...msg }));
        this.tables.refresh();
        break;
      case 'friends':
        this.friends = new Set(m.list.map(([id]) => id)); this.gangGames = new Set(m.games ?? []);
        this.refreshCardMarks(); this.phone.setFriends(m.list); this.tables.refresh();
        break;
      case 'radio': this.radio.set(m.vid, m.station); break;
      case 'msg':
        if (m.kind === 'chat') this.hud.chatLine(m.text);
        else if (m.kind === 'money') { this.hud.notify(m.text, 'money'); this.sound.play('cash'); }
        else if (m.kind === 'warn') this.hud.notify(m.text, 'warn');
        else this.hud.feedLine(m.text, m.kind);
        break;
    }
  }

  /** Where the local player is right now (predicted when possible). */
  private ownState(alpha: number): OwnState | null {
    const y = this.you;
    if (!y) return null;
    const p = this.predict;
    if (p.active) {
      const b = p.body, a = p.prev;
      const lerp = (u: number, v: number) => u + (v - u) * alpha;
      return { pid: y.pid, vid: y.vid, driving: y.mode === Mode.Driver, x: lerp(a.x, b.x) + p.errX, y: lerp(a.y, b.y) + p.errY,
        angle: y.mode === Mode.Driver ? a.angle + (b.angle - a.angle) * alpha : this.aimAngle, alt: lerp(a.alt, b.alt), vx: b.vx, vy: b.vy,
        trailer: p.prevTrailer + Math.atan2(Math.sin(p.trailer - p.prevTrailer), Math.cos(p.trailer - p.prevTrailer)) * alpha };
    }
    const ent = this.store.all.get(y.vid || y.pid);
    if (ent) return { pid: y.pid, vid: y.vid, driving: false, x: ent.x, y: ent.y, angle: ent.angle, alt: ent.alt, vx: ent.vx, vy: ent.vy };
    return { pid: y.pid, vid: y.vid, driving: false, x: y.body[0], y: y.body[1], angle: y.body[2], alt: y.body[6], vx: 0, vy: 0 };
  }

  private aimAngle = 0;
  private hudFrame = 0;
  private steering = new Steering();
  private autoAim = makeAimAssist(this.store, () => this.you?.pid ?? 0, () => this.you?.w[this.you.wi]?.[0] ?? -1);

  private tick(own: OwnState | null): void {
    const inp = this.input;
    if (!this.you || !own) return;
    const c = this.steering.step(inp, this.you, own.angle, STEP, own, this.autoAim);
    this.aimAngle = c.aim;
    const msg: InputMsg = [
      ++this.seq, c.mx, c.my, c.throttle, c.steer,
      Math.round(c.aim * 1000) / 1000,
      inp.takeButtons(),
      inp.takeWeaponWish(),
    ];
    // Other vehicles where they're drawn: your car or ped stops at them instead of clipping in.
    const vt = this.you.mode === Mode.Driver ? this.you.vt : -1;
    this.predict.obstacles = vehicleObstacles(this.store, own.x, own.y, this.you.vid, vt >= 0 && floats(VEHICLES[vt]));
    this.predict.apply(msg);
    this.conn.send({ t: 'in', i: [msg] });
  }

  private frame(): void {
    if (!this.running) return;
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.input.pollPad(dt, this.pane.isOpen || this.bigMap.isOpen || this.garage.isOpen || this.shop.isOpen || this.tables.isOpen || this.phone.capturing, this.phone.ringingNow);
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      this.acc -= STEP;
      n++;
      this.tick(this.ownState(1));
    }
    if (this.acc > STEP * 4) this.acc = 0;
    this.predict.decay(dt);
    this.radio.update(dt, this.you && this.you.mode !== Mode.Dead ? this.you.vid : 0, this.sound.musicLevel);
    // The soundtrack: each new song from the region you're in (audio/soundtrack.ts).
    const at = this.ownState(1);
    this.soundtrack.update(this.sound.musicLevel, at ? ZONES[this.map.zoneAt(at.x, at.y)]?.id ?? '' : '');
    const gm = Math.floor(this.gameMinutes);
    this.phone.update(dt, this.you, `${String(Math.floor(gm / 60) % 24).padStart(2, '0')}:${String(gm % 60).padStart(2, '0')}`);
    if (this.you && !document.hidden) this.quality.sample(dt);
    this.store.update();
    const own = this.ownState(this.acc / STEP);
    // Where you are over the map (upstairs, world/levels.ts: over your building, at your floor's
    // height; on a train's viaduct, over its corridor at the track's height: world/ways.ts).
    const up = own ? groundOf(own.x, own.y) : null;
    const upH = own ? heightAt(own.x, own.y) : 0;
    const disp = own && up ? { ...own, x: up.x, y: up.y } : null;
    const riding = own?.vid ? VEHICLES[this.you!.vt] : undefined;
    this.water.fade.follow(up?.x ?? 0, up?.y ?? 0, riding?.movement === 'boat' ? riding.length : 0);
    this.railway.fade?.update(up?.x ?? 0, up?.y ?? 0, upH + (own?.alt ?? 0), up?.f === 0);
    if (own && disp && up) {
      // GTA2: centred on you on foot; leads along travel in vehicles.
      this.cam.update(dt, disp.x, disp.y, own.vx, own.vy, own.alt + upH, disp.x, disp.y, !!own.vid, this.input.scoped, zoomFloor(this.input));
      this.sound.listenerX = disp.x; this.sound.listenerY = disp.y; this.sound.listenerZ = upH;
    }
    const vr = this.cam.viewRect();
    this.ground.update(vr);
    this.tumbleweeds.update(dt, vr);
    this.stage.fitShadow(Math.max(vr.x1 - vr.x0, vr.y1 - vr.y0) / 2 - 40);
    // Dev hook: window.__forceTime = minutes previews any time of day locally.
    const forced = (window as unknown as { __forceTime?: number }).__forceTime;
    this.stage.setTime(forced ?? this.gameMinutes, this.cam.x, this.cam.y);
    const night = this.stage.lighting.night;
    this.buildingUniforms.uNight.value = night;
    signalGlows(this.props, this.store, this.fx.glow, night, vr);
    this.storefronts.putGlows(this.fx.glow, night, vr);
    // Tag: a red ring pulsing under whoever's it.
    const it = this.itSpot();
    if (it) this.fx.glow.put(it.x, it.y, 0.09, 3.2 + Math.sin(performance.now() / 160) * 0.7, 1, 0, 1, 0.12, 0.08, 0.7);
    this.gas.putGlows(this.fx.glow, night, vr);
    if (own && up) this.interiors.update(up.x, up.y, !own.vid, isWayStrip(up.f) ? 0 : up.f);
    this.interiors.putGlows(this.fx.glow, night);
    this.view.carTags = this.carTags();
    this.view.sync(this.store, dt, own, this.tags(), night, vr);
    const sq = this.view.skids.squeal;
    this.sound.tyres(sq.k, sq.x, sq.y);
    this.fx.update(dt);
    this.furniture.update(dt);
    this.fixtures.update(dt);
    this.water.update(dt);
    this.jobs.update(dt, this.you, disp, this.fx.glow, night, this.store.serverNow(), this.players.find((p) => p.id === this.myId), this.sound);
    nearestSiren(this.store, disp, this.sound);
    ownEngine(this.store, this.you && this.you.mode !== Mode.Dead ? own : null, this.sound, dt);
    trafficEngines(this.store, disp, this.sound, dt);
    this.stage.render();
    // Call bubbles hang beside your head (upstairs: over your building, at your floor's height).
    this.talk.update(this.stage.camera, own && up ? { x: up.x, h: upH + own.alt + 2.9, y: up.y } : null);
    // Aim held: a crosshair out the way you're aiming.
    this.crosshair.update(this.stage.camera, own && up ? { x: up.x, h: upH + own.alt + 1.2, y: up.y } : null, this.input, this.cam.scope);
    this.offscreen.update(this.stage.camera, this.players, this.myId, (p) => this.playerSpot(p), this.jobs.it);
    this.updateHud(own, disp);
  }

  /** Tag: where whoever's it is now (their smooth on-screen position when known). */
  private itSpot(): { x: number; y: number } | null {
    const id = this.jobs.it;
    const p = id ? this.players.find((x) => x.id === id) : undefined;
    const e = p ? this.store.all.get(p.pid) : undefined;
    return e ? groundOf(e.x, e.y) : p ?? null;
  }

  private tags(): Map<number, PlayerTag> {
    const m = new Map<number, PlayerTag>();
    for (const p of this.players) m.set(p.pid, { name: p.name, color: p.color, look: p.look });
    const me = this.players.find((p) => p.id === this.myId);
    if (this.you && me) m.set(this.you.pid, { name: me.name, color: me.color, look: me.look, me: true });
    return m;
  }


  /** Your character's voice on the phone (guests and older characters get the default). */
  setVoice(v: string | undefined): void {
    this.talk.voice = cleanVoice(v);
  }

  /** Other players inside vehicles, by vehicle id. Riders drawn on a bike or open top have their own
   *  ped (and tag), so they're left out. */
  private carTags(): Map<number, PlayerTag[]> {
    const m = new Map<number, PlayerTag[]>();
    for (const p of this.players) {
      if (p.id === this.myId || !p.vid || this.store.all.has(p.pid)) continue;
      const list = m.get(p.vid) ?? [];
      list.push({ name: p.name, color: p.color });
      m.set(p.vid, list);
    }
    return m;
  }

  /** Where a player is on the map: their ped if it's drawn, else the vehicle they're in (smooth),
   *  else the player list's once-a-second position. */
  private playerSpot(p: PlayerInfo): { x: number; y: number } {
    const e = this.store.all.get(p.pid) ?? (p.vid ? this.store.all.get(p.vid) : undefined);
    return e ? groundOf(e.x, e.y) : p;
  }

  /** `own` where you really are (lifts, doors); `disp` where you are over the map (radar, map, route). */
  private updateHud(own: OwnState | null, disp: OwnState | null): void {
    const you = this.you;
    if (!you || !own || !disp) return;
    const seen = you.wl > 0;
    this.hud.update(you, this.gameMinutes, seen);
    // Radar, place lookup and pane refresh don't need full frame rate.
    if ((this.hudFrame = (this.hudFrame + 1) % 2) !== 0) return;
    const spot = this.interact.find(own.x, own.y, you);
    this.interact.current = spot;
    const ring = this.jobs.touch(you, own);
    if (ring) this.conn.send({ t: 'job', booth: ring.id });
    // No door or counter here: someone to talk to, if they're the nearest thing (client/game/faceTalk.ts).
    const chat = spot || you.mode !== Mode.Foot ? null : this.faceTalk.find(own, own.alt + 2.9);
    this.hud.setPrompt(this.pane.isOpen ? null : this.interact.promptText(spot, this.owners, this.profile) ?? chat);
    this.interact.tick(own.x, own.y);
    this.interact.paintShop(own.x, own.y, Math.hypot(own.vx, own.vy), you, (place) => this.openPaint(place));
    this.pane.refresh();
    const ctx = this.hud.radar.getContext('2d')!;
    const range = own.vid ? 260 : 170;
    const hostiles = you.wl > 0 ? lawUnits(this.store) : [];
    const owned = new Set(this.profile.owned);
    const wp = this.waypoint;
    wp.update(disp);
    const job = this.jobRoute;
    job.update(you.mt ? { x: you.mt[0], y: you.mt[1] } : null, disp);
    const marks = this.waypointMarks(wp, disp, you.vid);
    // Job blips, a red marker on any of your businesses a gang is leaning on, and (tag) whoever's it.
    const blips = [...this.jobs.blips(you), ...(this.profile.trouble ?? []).map(([id]) => {
      const p = this.map.city.properties[id];
      return { x: p.x, y: p.y, color: '#ff3b30', shape: 'star' as const };
    })];
    const it = this.itSpot();
    if (it && this.jobs.it !== this.myId) blips.push({ x: it.x, y: it.y, color: '#ff2a2a', shape: 'star' });
    if (!this.allVenues) this.refreshCardMarks();
    this.radar.drawRadar(ctx, 220, disp.x, disp.y, own.angle, range, this.players, this.myId, owned, hostiles, blips, marks, job.route, this.cardMarks);
    if (this.bigMap.isOpen) {
      this.bigMap.draw({ me: { x: disp.x, y: disp.y, angle: own.angle }, players: this.players, meId: this.myId, owned, owners: this.owners,
        blips, waypoint: wp.point, marks, jobRoute: job.route, cards: this.cardMarks });
    }
  }

  /** Routes to riders' waypoints, by player id (re-planned as you go). */
  private mateRoutes = new Map<number, JobRoute>();

  /** Waypoints to draw: yours, and those of the other players riding in your vehicle, each in its
   *  owner's colour with a road route from where you are. */
  private waypointMarks(wp: Waypoint, from: { x: number; y: number }, vid: number): Mark[] {
    const mine = this.players.find((p) => p.id === this.myId);
    const marks: Mark[] = wp.point ? [{ point: wp.point, route: wp.route, color: mine?.color ?? '#ff4fd8' }] : [];
    const seen = new Set<number>();
    for (const p of this.players) {
      if (p.id === this.myId || !vid || p.vid !== vid || !p.wp) continue;
      let r = this.mateRoutes.get(p.id);
      if (!r) this.mateRoutes.set(p.id, r = new JobRoute(this.map.city));
      const point = { x: p.wp[0], y: p.wp[1] };
      r.update(point, from);
      marks.push({ point, route: r.route, color: p.color });
      seen.add(p.id);
    }
    for (const id of this.mateRoutes.keys()) if (!seen.has(id)) this.mateRoutes.delete(id);
    return marks;
  }

  /** Shops with a counter (gun shop, dealership): you step up to it (controls off) till you walk out. */
  private openShop(place: Place): void {
    if (this.shop.isOpen || !this.you) return;
    const stock = SERVICES[place.spec].stock ?? [];
    const send = (kind: BuyKind, id: string) => this.conn.send({ t: 'buy', kind, id, place: place.id });
    const close = () => { this.input.enabled = true; };
    this.input.enabled = false;
    this.input.release();
    if (place.verb === 'gunshop') this.shop.open(gunShop({ shop: place.name, stock, you: () => this.you, buy: send, close }));
    else this.shop.open(dealerShop({ shop: place.name, stock, you: () => this.you, buy: (id) => send('vehicle', id), close }));
  }

  /** Paint shop: the car goes into the garage (hidden on the street, controls off) till it's done. */
  private openPaint(place: Place): void {
    const you = this.you;
    if (!you?.vid || this.garage.isOpen) return;
    const vid = you.vid;
    this.view.hiddenVehicle = vid;
    this.input.enabled = false;
    this.input.release();
    this.garage.open({ shop: place.name, type: you.vt, color: this.store.all.get(vid)?.data[6] ?? 0, price: SERVICES[place.spec].price ?? 500,
      cash: you.cash + you.bank, wanted: you.wl > 0, buy: (id) => this.conn.send({ t: 'buy', kind: 'respray', id, place: place.id }),
      paintNow: () => this.store.all.get(vid)?.data[6] ?? -1, close: () => { this.view.hiddenVehicle = 0; this.input.enabled = true; } });
  }

  private leave(): void {
    this.running = false;
    this.soundtrack.stop();
    this.conn.close();
    this.onLeave();
  }
}
