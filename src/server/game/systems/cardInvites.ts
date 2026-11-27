// Who gets into which game (world/tables.ts): a gang texts you an invite to its back-room game once
// it respects you enough (RULES.cardInviteRespect); after you've sat in once you're known there. A
// friend is met at their place (they hang about by their card table), gives you their number, and
// then either texts you when there's a game on or answers when you call; a game runs for
// RULES.friendGameMinutes of game time. Caught cheating at a friend's, and they're done with you.
import { FACTIONS, FRIENDS, GANGS, pedIndex, RULES, TABLES } from '../../../shared/packs';
import type { S2C } from '../../../shared/protocol';
import type { Player } from '../entities';
import { removePed, spawnPed } from '../factory';
import { setTask } from '../ai/tasks';
import { textTo } from '../missions/cell';
import type { World } from '../world';

interface State { on: Map<string, number>; standing: Map<string, number>; checkT: number; nextInvite: number; sent: Map<number, string> }
const states = new WeakMap<World, State>();
const state = (w: World): State => {
  let s = states.get(w);
  if (!s) states.set(w, (s = { on: new Map(), standing: new Map(), checkT: 0, nextInvite: w.time + 240, sent: new Map() }));
  return s;
};

/** Is a friend's game on right now? */
export const friendGameOn = (w: World, id: string): boolean => (state(w).on.get(id) ?? 0) > w.time;

const gameSeconds = () => RULES.friendGameMinutes / RULES.gameMinutesPerSecond;

/** Meeting a friend at their table: you get their number. */
export function meetFriend(w: World, pl: Player, table: number): string | null {
  const spot = w.city.tables[table];
  const p = w.peds.get(pl.pid);
  const f = spot?.friend ? FRIENDS.find((x) => x.id === spot.friend) : undefined;
  if (!spot || !f || !p || Math.hypot(p.body.x - spot.at.x, p.body.y - spot.at.y) > 4) return null;
  if (pl.met.has(`friend:${f.id}`)) return null;
  pl.met.add(`friend:${f.id}`);
  textTo(pl, f.name, f.meet);
  sendFriends(pl);
  return null;
}

/** Calling a friend: a game's on now, or not tonight. */
export function dialFriend(w: World, pl: Player, id: string): void {
  const f = FRIENDS.find((x) => x.id === id);
  if (!f || !pl.met.has(`friend:${id}`)) return;
  const s = state(w);
  if (pl.met.has(`sore:${id}`)) { textTo(pl, f.name, 'After what you pulled at my table? Lose my number.'); return; }
  if (friendGameOn(w, id) || w.rng.chance(0.6)) {
    s.on.set(id, Math.max(s.on.get(id) ?? 0, w.time + gameSeconds()));
    textTo(pl, f.name, w.rng.pick(f.on));
  } else textTo(pl, f.name, w.rng.pick(f.busy));
}

/** The friends whose number you have, for the phone's contacts. */
export function sendFriends(pl: Player): void {
  const list = FRIENDS.filter((f) => pl.met.has(`friend:${f.id}`)).map((f): [string, string] => [`friend:${f.id}`, f.name]);
  const games = GANGS.filter((g) => pl.met.has(`invite:${g}`) || pl.met.has(`game:${g}`));
  pl.send({ t: 'friends', list, games } satisfies S2C);
}

/** Every so often: gangs' invites, friends' invites, and each friend standing by their table while
 *  someone's about (not while their game's being played: they're sat at it). */
export function updateInvites(w: World, dt: number, playing: (table: number) => boolean): void {
  const s = state(w);
  s.checkT -= dt;
  if (s.checkT > 0) return;
  s.checkT = 2;
  for (const pl of w.players.values()) {
    for (const t of w.city.tables) {
      if (t.host !== 'gang' || !t.gang) continue;
      const key = `invite:${t.gang}`;
      if (pl.met.has(key) || pl.met.has(`game:${t.gang}`) || (pl.respect[t.gang] ?? 0) < RULES.cardInviteRespect) continue;
      pl.met.add(key);
      sendFriends(pl); // the game shows on your map now
      const spec = TABLES[t.spec];
      const gang = FACTIONS.find((f) => f.id === t.gang)?.name ?? t.gang;
      textTo(pl, gang, `There's a game in the back of ${t.name.split(' at ')[1] ?? 'the usual place'}. ${spec.buyIn ? `$${spec.buyIn[0].toLocaleString('en-US')} to sit down. ` : ''}Come alone, and come straight.`);
    }
  }
  // A friend texts someone they know that there's a game on.
  if (w.time >= s.nextInvite) {
    s.nextInvite = w.time + w.rng.range(300, 600);
    for (const pl of w.players.values()) {
      const known = FRIENDS.filter((f) => pl.met.has(`friend:${f.id}`) && !pl.met.has(`sore:${f.id}`) && !friendGameOn(w, f.id));
      if (!known.length || !w.rng.chance(0.5)) continue;
      const f = w.rng.pick(known);
      s.on.set(f.id, w.time + gameSeconds());
      textTo(pl, f.name, w.rng.pick(f.invite));
    }
  }
  // Friends about their place.
  for (const t of w.city.tables) {
    if (t.host !== 'friend' || !t.friend) continue;
    const f = FRIENDS.find((x) => x.id === t.friend)!;
    const id = s.standing.get(f.id);
    const near = w.nearestPlayerDist2(t.at.x, t.at.y);
    const want = near < 90 * 90 && !playing(t.id);
    const p = id ? w.peds.get(id) : undefined;
    if (want && (!p || p.dead)) {
      const at = t.seats[0] ?? t.at;
      const np = spawnPed(w, pedIndex(f.arch), at.x, at.y, at.angle);
      np.persistent = true;
      setTask(np, 'stand');
      np.ai!.post = { x: at.x, y: at.y, angle: at.angle };
      s.standing.set(f.id, np.id);
    } else if (!want && p) {
      if (!p.dead) removePed(w, p);
      s.standing.delete(f.id);
    }
  }
}
