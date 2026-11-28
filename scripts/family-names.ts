import assert from 'node:assert/strict';
import { RULES } from '../src/shared/packs';
import { NAME_PARTS, generateName } from '../src/shared/packs/characters';
import { World } from '../src/server/game/world';
import { createCensus, type Census } from '../src/server/game/census';
import { assignFamilyNames } from '../src/server/game/familyNames';

const seed = RULES.citySeed;
const census = createCensus(new World(seed).city, seed);
const second = structuredClone(census);
assignFamilyNames(census, seed);
assignFamilyNames(second, seed);
assert.deepEqual(second, census);
assignFamilyNames(second, seed + 1);
assert.deepEqual(second, census);
const names = new Set<string>();
for (const r of census.residents) {
  const { name, gender } = r.identity!;
  const [given, surname] = name.split(' ');
  assert(NAME_PARTS[gender].includes(given));
  assert.equal(census.households[r.household - 1].surname, surname);
  assert(name.length <= 16 && !names.has(name));
  names.add(name);
}
for (const surname of NAME_PARTS.last) {
  for (const gender of ['male', 'female'] as const) {
    assert(NAME_PARTS[gender].some(g => g.length + 1 + surname.length <= 16));
  }
}
assert(generateName(() => 0.99999).length <= 16);
const legacy: Census = { addresses: [], households: [{ id: 1, lot: 0, unit: 1 }, { id: 2, lot: 0, unit: 2 }], residents: [
  { id: 1, household: 1, job: null, identity: { gender: 'female', name: 'Clara Hale' } },
  { id: 2, household: 1, job: null, identity: { gender: 'male', name: 'John Pike' } },
  { id: 3, household: 2, job: null, identity: { gender: 'female', name: 'Alice Dunn' } },
] };
assignFamilyNames(legacy, seed);
assert.deepEqual(legacy.households.map(h => h.surname), ['Pike', 'Dunn']);
assert(legacy.residents[0].identity!.name.endsWith(' Pike'));
const crowded = structuredClone(census);
for (const h of crowded.households) delete h.surname;
for (const r of crowded.residents) r.identity!.name = r.identity!.gender === 'male' ? 'John Pike' : 'Alice Pike';
assignFamilyNames(crowded, seed);
assert.equal(new Set(crowded.residents.map(r => r.identity!.name)).size, names.size);
console.log(names.size + ' distinct census names; household inheritance, migration and reload passed.');
