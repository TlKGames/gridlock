// Inspect the current universe's citywide population and check its address and shift assignments.
import assert from 'node:assert/strict';
import { createCensus, scheduledLot } from '../src/server/game/census';
import { RULES } from '../src/shared/packs';
import { generateCity } from '../src/shared/world/city';

const seed = Number(process.argv[2] ?? RULES.citySeed);
const city = generateCity(seed);
const census = createCensus(city, seed);
const sites = new Map(census.addresses.map(a => [a.lot, a]));
assert.equal(sites.size, city.buildings.length);
assert.ok(census.residents.length > 0);
assert.equal(new Set(census.residents.map(r => r.id)).size, census.residents.length);
const used = new Map<number, number>();
for (const resident of census.residents) {
  const home = census.households[resident.household - 1];
  assert.ok(home.unit > 0 && home.unit <= sites.get(home.lot)!.homes);
  const job = resident.job;
  if (!job) continue;
  used.set(job.lot, (used.get(job.lot) ?? 0) + 1);
  assert.equal(scheduledLot(census, resident, (job.start + 479) % 1440), job.lot);
  assert.equal(scheduledLot(census, resident, (job.start + 480) % 1440), home.lot);
}
for (const [lot, staff] of used) assert.ok(staff <= sites.get(lot)!.jobs);
console.log({ seed, addresses: sites.size, households: census.households.length, residents: census.residents.length,
  employed: census.residents.filter(r => r.job).length });
