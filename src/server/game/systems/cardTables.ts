// Card and casino tables (world/tables.ts): one game per player sat at one, shown in their pane
// (client hud/cardTable.ts). House games bet straight from your cash (then the bank), poker plays
// out of the chips you buy in with (systems/cardPoker.ts). Who may sit: anyone at the house's
// tables; a gang's back-room game once it's invited you (systems/cardInvites.ts), then any time;
// a friend's while their game's on. Walk away and you're cashed out.
import { randomUUID } from 'node:crypto';
import { recordCrapsWallet } from '../../persist';
import { FRIENDS, PEDS, pedWith, RULES, TABLES } from '../../../shared/packs';
import type { TableSpec } from '../../../shared/packs/types';
import type { S2C, TableView } from '../../../shared/protocol';
import { bjAct, bjDeal, bjStake, bjValue, type Blackjack, type Dice, type Faro, faroTurn, newBlackjack, newDice, newFaro, pullSlots, rollDice, ROULETTE_KINDS, rouletteName, spinRoulette, type RouletteBet } from '../../../shared/games/house';
import { faceUp, options, pots } from '../../../shared/games/poker';
import { type Craps, crapsRefund, crapsWalkAway, newCraps } from '../../../shared/games/craps';
import { crapsOp, crapsView } from './cardCraps';
import type { TableSpot } from '../../../shared/world/tables';
import type { Player } from '../entities';
import { removePed, spawnPed } from '../factory';
import { setTask } from '../ai/tasks';
import type { World } from '../world';
import { callOut, cheat, cheatsOpen, endPoker, type PokerGame, pokerMove, shoot, startPoker, tickPoker } from './cardPoker';
import { friendGameOn } from './cardInvites';

interface Session {
  spot: TableSpot;
  spec: TableSpec;
  log: string[];
  poker?: PokerGame;
  bj?: Blackjack;
  dice?: Dice;
  craps?: Craps;
  // Only the server knows the walk-away result until the shooter leaves.
  crapsPayout?: number;
  checkpoint?: { receipt: string; cash?: number; bank?: number };
  faro?: Faro;
  roulette?: { last: number; history: number[]; bets: [string, number, number, number][] };
  slots?: { reels: number[] | null; won: number };
  /** The dealer at a house table (a ped). */
  dealer?: number;
  dirty: boolean;
}

/** How far you can wander from your seat before you've left the table. */
const REACH = 2.6;

export class CardTables {
  private sessions = new Map<number, Session>();

  constructor(private w: World, private save: (pl: Player) => void) {}

  /** Is anyone playing at this table? */
  inUse = (table: number): boolean => [...this.sessions.values()].some((s) => s.spot.id === table);

  handle(pl: Player, m: { op: string; table?: number; n?: number; m?: number; k?: number[]; s?: string; bets?: [string, number, number][] }): void {
    const say = (text: string) => this.w.notify('info', text, pl);
    if (m.op === 'sit') { const err = this.sit(pl, Number(m.table), Number(m.n ?? 0)); if (err) this.w.notify('warn', err, pl); return; }
    const s = this.sessions.get(pl.id);
    if (!s) return;
    if (m.op === 'leave') { this.leave(pl); return; }
    const err = s.poker ? this.pokerOp(pl, s, m) : this.houseOp(pl, s, m);
    if (err) say(err);
    s.dirty = true;
  }

  private sit(pl: Player, id: number, buyIn: number): string | null {
    const w = this.w;
    const spot = w.city.tables[id];
    const p = w.peds.get(pl.pid);
    if (!spot || !p || p.dead || p.vehicle) return null;
    if (Math.hypot(p.body.x - spot.at.x, p.body.y - spot.at.y) > REACH) return 'Get closer to the table.';
    if (this.sessions.has(pl.id)) this.leave(pl);
    if ([...this.sessions.values()].some((o) => o.spot === spot)) return 'Someone\'s already playing here.';
    const spec = TABLES[spot.spec];
    if (spot.host === 'gang' && spot.gang && !pl.met.has(`game:${spot.gang}`) && !pl.met.has(`invite:${spot.gang}`)) return 'Private game. You need an invite.';
    if (spot.host === 'friend' && spot.friend) {
      if (!pl.met.has(`friend:${spot.friend}`)) return 'You don\'t know these people.';
      if (!friendGameOn(w, spot.friend)) return `Nobody's playing right now. Call ${FRIENDS.find((f) => f.id === spot.friend)?.name ?? 'them'} first.`;
    }
    const s: Session = { spot, spec, log: [], dirty: true };
    if (spot.gang) { pl.met.delete(`invite:${spot.gang}`); pl.met.add(`game:${spot.gang}`); }
    if (spec.game === 'holdem' || spec.game === 'draw' || spec.game === 'stud') {
      const [lo, hi] = spec.buyIn ?? [spec.stakes[1] * 40, spec.stakes[1] * 100];
      const want = Math.max(lo, Math.min(hi, Math.round(buyIn || lo)));
      if (pl.cash + pl.bank < want) return `It's a $${lo.toLocaleString('en-US')} buy-in at least.`;
      take(pl, want);
      const friend = spot.friend ? FRIENDS.find((f) => f.id === spot.friend) : undefined;
      s.poker = startPoker(w, pl, spot, spec, want, friend ? { name: friend.name, arch: friend.arch } : undefined);
      s.log.push(`You sit down with $${want.toLocaleString('en-US')} in chips.`);
    } else {
      if (spec.game === 'blackjack' || spec.game === 'twentyone') s.bj = newBlackjack(spec.game);
      if (spec.game === 'hazard') s.dice = newDice(spec.game);
      if (spec.game === 'craps') s.craps = newCraps();
      if (spec.game === 'faro') s.faro = newFaro(w.rng);
      if (spec.game === 'roulette') s.roulette = { last: -1, history: [], bets: [] };
      if (spec.game === 'slots') s.slots = { reels: null, won: 0 };
      s.dealer = dealerFor(w, spot);
    }
    if (s.craps && pl.character) s.checkpoint = { receipt: randomUUID() };
    this.sessions.set(pl.id, s);
    if (s.checkpoint && !this.checkpoint(pl)) {
      this.sessions.delete(pl.id);
      const dealer = s.dealer ? w.peds.get(s.dealer) : undefined;
      if (dealer) removePed(w, dealer);
      return 'The table could not save your balance. Please try again.';
    }
    p.body.vx = 0; p.body.vy = 0;
    return null;
  }

  /** Save the final wallet before showing the table or accepting the next move. */
  checkpoint(pl: Player): string | undefined {
    const s = this.sessions.get(pl.id);
    const cp = s?.checkpoint;
    if (!cp || !pl.character) return;
    const cash = pl.cash + (s.crapsPayout ?? 0);
    if (cash !== cp.cash || pl.bank !== cp.bank) {
      try {
        recordCrapsWallet(pl.character.id, { receipt: cp.receipt, cash, bank: pl.bank });
      } catch (err) {
        console.warn('Could not save the craps wallet', err);
        return;
      }
      cp.cash = cash;
      cp.bank = pl.bank;
    }
    return cp.receipt;
  }

  /** Money the player takes away if the connection ends at this instant. */
  refund(pl: Player): number {
    const s = this.sessions.get(pl.id);
    if (s?.craps) return pl.character ? crapsRefund(s.craps) : s.crapsPayout ?? 0;
    if (s?.poker) return s.poker.t.seats[0].stack;
    if (s?.faro) return [...s.faro.bets.values()].reduce((sum, bet) => sum + bet, 0);
    return s?.dice?.bet ?? 0;
  }

  leave(pl: Player, why?: string): void {
    const s = this.sessions.get(pl.id);
    if (!s) return;
    this.checkpoint(pl);
    const chips = s.craps ? 0 : this.refund(pl);
    pl.cash += chips;
    this.sessions.delete(pl.id);
    if (s.poker) {
      if (chips > 0) this.w.notify('money', `You cash out $${chips.toLocaleString('en-US')}.`, pl);
      endPoker(this.w, s.poker);
    }
    // Full craps settles outstanding line bets on departure. Its result includes open stakes.
    if (s.craps) {
      const back = s.crapsPayout ?? 0;
      if (back) this.w.earn(pl, back);
    }
    if (s.dealer) { const d = this.w.peds.get(s.dealer); if (d && !d.dead) removePed(this.w, d); }
    if (why) this.w.notify('info', why, pl);
    this.save(pl);
    pl.send({ t: 'table', v: null } satisfies S2C);
  }

  update(dt: number): void {
    for (const [id, s] of [...this.sessions]) {
      const pl = this.w.players.get(id);
      const p = pl ? this.w.peds.get(pl.pid) : undefined;
      if (!pl) { this.sessions.delete(id); if (s.poker) endPoker(this.w, s.poker); continue; }
      if (!p || p.dead || p.vehicle || Math.hypot(p.body.x - s.spot.at.x, p.body.y - s.spot.at.y) > REACH + 1.5) { this.leave(pl); continue; }
      if (s.poker && tickPoker(this.w, s.poker, dt, (t) => s.log.push(t))) s.dirty = true;
      if (s.dirty) { this.save(pl); s.dirty = false; pl.send({ t: 'table', v: this.view(s) } satisfies S2C); }
    }
  }

  // ---- Poker --------------------------------------------------------------------------------------

  private pokerOp(pl: Player, s: Session, m: { op: string; n?: number; k?: number[]; s?: string }): string | null {
    const g = s.poker!, t = g.t;
    const me = this.w.peds.get(pl.pid)!;
    switch (m.op) {
      case 'fold': case 'check': case 'call': return pokerMove(this.w, g, { kind: m.op });
      case 'raise': return pokerMove(this.w, g, { kind: 'raise', to: Number(m.n) });
      case 'draw': return pokerMove(this.w, g, { kind: 'draw', discard: (m.k ?? []).map(Number).filter((k) => k >= 0 && k < 5) });
      case 'rebuy': {
        if (t.seats[0].stack > 0 || (t.street !== 'show' && t.street !== 'idle')) return 'Not now.';
        const [lo] = g.spec.buyIn ?? [g.spec.stakes[1] * 40];
        if (pl.cash + pl.bank < lo) return `You need $${lo.toLocaleString('en-US')}.`;
        take(pl, lo); t.seats[0].stack = lo; s.log.push(`You buy back in for $${lo.toLocaleString('en-US')}.`);
        return null;
      }
      case 'topup': {
        // Between hands, more chips up to the table's biggest buy-in.
        if (t.street !== 'show' && t.street !== 'idle') return 'Between hands.';
        const [, hi] = g.spec.buyIn ?? [0, g.spec.stakes[1] * 100];
        const add = Math.min(Math.round(Number(m.n)), hi - t.seats[0].stack, pl.cash + pl.bank);
        if (!(add > 0)) return t.seats[0].stack >= hi ? 'You\'ve got the most this table takes.' : 'Not enough money.';
        take(pl, add); t.seats[0].stack += add; s.log.push(`You add $${add.toLocaleString('en-US')} in chips.`);
        return null;
      }
      case 'cheat': {
        const kind = String(m.s);
        const r = cheat(this.w, g, kind);
        s.log.push(r.text);
        if (r.caught) this.caught(pl, s, r.by ?? 1);
        return null;
      }
      case 'callout': {
        if (!RULES.cardCheats) return 'Not here.';
        const k = Number(m.n);
        const r = callOut(this.w, g, k, me);
        s.log.push(r.text);
        if (!r.right) this.shootout(pl, s, k);
        return null;
      }
    }
    return 'Not a move.';
  }

  /** Caught cheating: shot where you sit, or thrown out (the house keeps your chips). */
  private caught(pl: Player, s: Session, by: number): void {
    const w = this.w, g = s.poker!;
    const me = w.peds.get(pl.pid);
    const them = w.peds.get(g.peds[by]);
    if (s.spec.caught === 'shoot' && me && them && !them.dead) {
      s.log.push(`${g.t.seats[by].name} stands up and draws.`);
      g.t.seats[0].stack = 0;
      shoot(w, them, me);
      this.leave(pl, 'Caught cheating.');
      return;
    }
    g.t.seats[0].stack = 0;
    this.leave(pl, s.spot.host === 'friend' ? 'Caught cheating. They keep your money and tell you to get lost.' : 'Caught cheating. Security walks you out; the house keeps your chips.');
    if (me && s.spot.interior !== undefined) { const door = w.city.interiors[s.spot.interior].place; me.body.x = door.x; me.body.y = door.y; }
    if (s.spot.friend) pl.met.add(`sore:${s.spot.friend}`);
  }

  /** You called out an honest man: he and his friends go for their guns. */
  private shootout(pl: Player, s: Session, k: number): void {
    const w = this.w, g = s.poker!;
    const me = w.peds.get(pl.pid);
    if (!me) return;
    const angry = s.spot.gang ? g.peds.slice(1) : [g.peds[k]];
    for (const id of angry) {
      const o = w.peds.get(id);
      if (!o || o.dead || !o.ai) continue;
      o.persistent = false;
      setTask(o, 'attack', me.id);
    }
    // They're not sat at a table any more: nobody to hand back to endPoker.
    g.peds = [g.peds[0]];
    this.leave(pl, 'It\'s a shootout.');
  }

  // ---- House games --------------------------------------------------------------------------------

  private houseOp(pl: Player, s: Session, m: { op: string; n?: number; m?: number; s?: string; bets?: [string, number, number][] }): string | null {
    const w = this.w, spec = s.spec;
    const [lo, hi] = spec.stakes;
    const stake = (n: unknown): number | string => {
      const v = Math.round(Number(n));
      if (!(v >= lo && v <= hi)) return `Bets here are $${lo}-$${hi.toLocaleString('en-US')}.`;
      if (pl.cash + pl.bank < v) return 'Not enough money.';
      take(pl, v);
      return v;
    };
    const win = (back: number) => { if (back > 0) w.earn(pl, back); };
    if (s.bj) {
      const g = s.bj;
      const before = m.op === 'deal' ? 'bet' : g.phase;
      if (m.op === 'deal') {
        if (g.phase === 'play') return 'Finish this hand first.';
        const v = stake(m.n); if (typeof v === 'string') return v;
        bjDeal(g, w.rng, v);
      } else if (m.op === 'hit' || m.op === 'stand') bjAct(g, w.rng, m.op);
      else if (m.op === 'double' || m.op === 'split') {
        const extra = bjStake(g, m.op); if (typeof extra === 'string') return extra;
        if (pl.cash + pl.bank < extra) return 'Not enough money.';
        take(pl, extra); bjAct(g, w.rng, m.op);
      } else return 'Not a move.';
      // Settled by this move (not already settled before it): paid once.
      if (g.phase === 'done' && before !== 'done') { win(g.paid); s.log.push(...g.outcome); }
      return null;
    }
    if (s.roulette) {
      if (m.op !== 'spin') return 'Not a move.';
      // Every chip on the layout rides one spin: each bet within the table's limits, all of them
      // paid for up front.
      const list: [string, number, number][] = m.bets?.length ? m.bets.slice(0, 60) : [[String(m.s), Number(m.m ?? 0), Number(m.n)]];
      const bets: RouletteBet[] = [];
      for (const [kind, num, amt] of list) {
        if (!ROULETTE_KINDS.has(kind)) return 'Not a bet on this layout.';
        const a = Math.round(Number(amt));
        if (!(a >= lo && a <= hi)) return `Bets here are $${lo}-$${hi.toLocaleString('en-US')} each.`;
        bets.push({ on: kind as RouletteBet['on'], amount: a, ...(kind === 'number' ? { n: Math.max(0, Math.min(37, Math.round(Number(num)))) } : {}) });
      }
      const total = bets.reduce((t, b) => t + b.amount, 0);
      if (!bets.length) return 'Put a chip down first.';
      if (pl.cash + pl.bank < total) return 'Not enough money.';
      take(pl, total);
      const r = spinRoulette(w.rng, bets);
      const back = r.back.reduce((t, b) => t + b, 0);
      s.roulette.last = r.n; s.roulette.history = [r.n, ...s.roulette.history].slice(0, 20);
      s.roulette.bets = bets.map((b, i) => [b.on, b.n ?? 0, b.amount, r.back[i]]);
      win(back);
      s.log.push(`${rouletteName(r.n)}. ${back > total ? `You win $${(back - total).toLocaleString('en-US')}.` : back === total ? 'You break even.' : back ? `You get $${back.toLocaleString('en-US')} back.` : `You lose $${total.toLocaleString('en-US')}.`}`);
      return null;
    }
    if (s.craps) {
      const previous = { craps: structuredClone(s.craps), crapsPayout: s.crapsPayout };
      const wallet = { cash: pl.cash, bank: pl.bank, earned: pl.earned };
      const logLength = s.log.length;
      const err = crapsOp(s.craps, m, {
        stake, rng: w.rng, log: (t) => s.log.push(t), pay: win,
        take: (n) => { if (!(n > 0) || pl.cash + pl.bank < n) return false; take(pl, n); return true; },
      });
      if (err) return err;
      s.crapsPayout = crapsWalkAway(structuredClone(s.craps), w.rng);
      if (s.checkpoint && !this.checkpoint(pl)) {
        Object.assign(s, previous);
        Object.assign(pl, wallet);
        s.log.length = logLength;
        return 'Your move could not be saved. Please try again.';
      }
      return null;
    }
    if (s.dice) {
      const g = s.dice;
      if (m.op === 'bet') {
        if (g.bet) return 'Your bet\'s already down.';
        const v = stake(m.n); if (typeof v === 'string') return v;
        g.bet = v;
        if (g.variant === 'craps') g.side = m.s === 'dont' ? 'dont' : 'pass';
        else g.main = Math.max(5, Math.min(9, Math.round(Number(m.m) || 7)));
        return null;
      }
      if (m.op !== 'roll') return 'Not a move.';
      if (!g.bet) return 'Put a bet down first.';
      const staked = g.bet;
      const back = rollDice(g, w.rng);
      s.log.push(g.said);
      if (back !== null) { win(back); s.log.push(back > staked ? `You win $${(back - staked).toLocaleString('en-US')}.` : back === staked ? 'Your bet comes back.' : `You lose $${staked.toLocaleString('en-US')}.`); }
      return null;
    }
    if (s.slots) {
      if (m.op !== 'pull') return 'Not a move.';
      const v = stake(m.n); if (typeof v === 'string') return v;
      const r = pullSlots(w.rng, v);
      s.slots = { reels: r.reels, won: r.back };
      win(r.back);
      if (r.back) s.log.push(`Pays $${r.back.toLocaleString('en-US')}.`);
      return null;
    }
    if (s.faro) {
      const g = s.faro;
      if (m.op === 'bet') {
        const r = Math.round(Number(m.m));
        if (!(r >= 0 && r <= 12)) return 'Pick a card on the layout.';
        const v = stake(m.n); if (typeof v === 'string') return v;
        g.bets.set(r, (g.bets.get(r) ?? 0) + v);
        return null;
      }
      if (m.op !== 'turn') return 'Not a move.';
      win(faroTurn(g, w.rng));
      s.log.push(g.said);
      return null;
    }
    return 'Not a move.';
  }

  // ---- What you see -------------------------------------------------------------------------------

  private view(s: Session): TableView {
    const spec = s.spec;
    const v: TableView = { id: s.spot.id, name: s.spot.name, game: spec.game, stakes: spec.stakes, chips: 0, log: s.log.slice(-30) };
    if (s.poker) {
      const g = s.poker, t = g.t, o = t.toAct === 0 ? options(t, 0) : null;
      const between = t.street === 'show' || t.street === 'idle';
      v.chips = t.seats[0].stack;
      v.log = [...t.log.slice(-30), ...s.log.slice(-3)].slice(-30);
      v.poker = {
        street: t.street, board: t.board, pot: t.seats.reduce((a, q) => a + q.total, 0), toCall: o?.toCall ?? 0, minTo: o?.minTo ?? 0, maxTo: o?.maxTo ?? 0,
        yourTurn: t.toAct === 0, you: 0, dealer: t.dealer, acting: t.toAct, between,
        seats: t.seats.map((q, k) => ({
          name: q.name, stack: q.stack, bet: q.bet, folded: q.folded, allIn: q.allIn, out: q.out, ...(q.drew !== undefined ? { drew: q.drew } : {}), ...(q.last ? { last: q.last } : {}),
          // Your own cards; everyone's up cards; theirs at a showdown (if they're still in).
          cards: q.cards.map((c, i) => (k === 0 || faceUp(t, i) && (!q.folded || t.street !== 'show') || g.peeked.has(k) ? c : -1)),
        })),
        pots: pots(t), big: t.variant === 'holdem' ? t.blinds[1] : t.blinds[1], result: t.result,
        // Someone else thinking it over, or the next deal coming: how long they've got.
        clock: (t.toAct > 0 || (between && t.seats[0].stack > 0)) && g.wait > 0 ? [g.wait, Math.max(g.wait, g.waitTotal)] : null,
        topTo: (spec.buyIn ?? [0, spec.stakes[1] * 100])[1],
      };
      const open = cheatsOpen(g);
      if (open.length) v.cheats = open;
      if (g.peeked.size) v.peeked = [...g.peeked].map((k) => [k, t.seats[k].cards]);
    }
    if (s.bj) {
      const g = s.bj;
      v.bj = {
        hands: g.hands.map((h) => ({ cards: h.cards, bet: h.bet, total: bjValue(h.cards).total })), active: g.active,
        dealer: g.phase === 'play' ? [-1, g.dealer[1]] : g.dealer, dealerTotal: g.phase === 'play' ? bjValue([g.dealer[1]]).total : bjValue(g.dealer).total,
        phase: g.phase, outcome: g.outcome,
      };
    }
    if (s.roulette) v.roulette = s.roulette;
    if (s.dice) v.dice = { variant: s.dice.variant, point: s.dice.point, main: s.dice.main, bet: s.dice.bet, side: s.dice.side, last: s.dice.last, said: s.dice.said, history: s.dice.history };
    if (s.craps) v.craps = crapsView(s.craps);
    if (s.slots) v.slots = s.slots;
    if (s.faro) {
      // The casekeeper: how many of each rank have come out of the box (four of each in a deck).
      const left = new Array(13).fill(0);
      for (const c of s.faro.box) left[c % 13]++;
      v.faro = { turn: s.faro.turn, bets: [...s.faro.bets], left: s.faro.box.length, said: s.faro.said, dealt: left.map((n) => 4 - n) };
    }
    return v;
  }
}

/** Money out of your pocket, then the bank (as the shops take it). */
function take(pl: Player, amount: number): void {
  const fromCash = Math.min(pl.cash, amount);
  pl.cash -= fromCash;
  pl.bank -= amount - fromCash;
}

/** A dealer across a house table (a ped standing there while you play): the place's clerk, or a
 *  civilian; none at a machine. */
function dealerFor(w: World, spot: TableSpot): number | undefined {
  const at = spot.seats[0];
  if (!at) return undefined;
  const clerk = w.city.interiors[spot.interior ?? -1]?.clerkArch;
  const a = clerk ? PEDS.findIndex((p) => p.id === clerk) : pedWith('civilian');
  if (a < 0) return undefined;
  const d = spawnPed(w, a, at.x, at.y, at.angle);
  d.persistent = true;
  setTask(d, 'stand');
  d.ai!.post = { x: at.x, y: at.y, angle: at.angle };
  return d.id;
}
