// Craps pays what a casino pays: each bet's return over many rolls against its known house edge
// (pass 1.41%, don't pass 1.36%, field 2.78%, place 6 1.52%, place 4 6.67%, hard 8 9.09%, any 7
// 16.67%, odds 0). `npx tsx scripts/craps.ts`
import { type CrapsKind, crapsBet, crapsSettle, newCraps, oddsRoom } from '../src/shared/games/craps';
import { Rng } from '../src/shared/rng';

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const rng = new Rng(12345);
const roll = () => [1 + Math.floor(rng.next() * 6), 1 + Math.floor(rng.next() * 6)] as const;

/** Keeps one bet of `kind` working and measures money lost per dollar wagered (resolved). */
function edge(kind: CrapsKind, n?: number, withOdds = false, rounds = 400000): number {
  const g = newCraps();
  let staked = 0, net = 0, resolved = 0;
  while (resolved < rounds) {
    const line = kind === 'pass' || kind === 'dont';
    const has = g.bets.some((b) => b.kind === kind && (n === undefined || b.n === n || line));
    if (!has && (!line || !g.point)) { crapsBet(g, kind, 60, n); staked += 60; net -= 60; }
    if (withOdds && g.point) for (const b of g.bets) { const r = oddsRoom(b); if (r && !b.odds) { b.odds = r; net -= r; } }
    const before = g.bets.reduce((s, b) => s + b.amount + b.odds, 0);
    const [a, c] = roll();
    const r = crapsSettle(g, a, c);
    net += r.back;
    const after = g.bets.reduce((s, b) => s + b.amount + b.odds, 0);
    if (r.won || r.lost || after < before) resolved++;
  }
  net += g.bets.reduce((s, b) => s + b.amount + b.odds, 0); // what's still down counts as yours
  void staked;
  // Per decision on the $60 flat (a place bet that wins stays up and plays again).
  return -net / (resolved * 60);
}

const cases: [string, CrapsKind, number | undefined, number, boolean?][] = [
  ['pass line', 'pass', undefined, 0.0141], ['don\'t pass', 'dont', undefined, 0.0136], ['field', 'field', undefined, 0.0278],
  ['place 6', 'place', 6, 0.0152], ['place 4', 'place', 4, 0.0667], ['hard 8', 'hard', 8, 0.0909], ['any 7', 'any7', undefined, 0.1667],
  ['pass with full odds (per flat dollar)', 'pass', undefined, 0.0141, true],
];
for (const [name, kind, n, want, odds] of cases) {
  const e = edge(kind, n, odds);
  check(Math.abs(e - want) < Math.max(0.006, want * 0.12), `${name}: house edge ${(e * 100).toFixed(2)}% (real ${(want * 100).toFixed(2)}%)`);
}
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
