// A census household is the family unit. Its surname survives changes in membership.
import { NAME_PARTS, type Gender } from '../../shared/packs/characters';
import { Rng } from '../../shared/rng';
import type { Census, Resident } from './census';

export function assignFamilyNames(census: Census, seed: number): void {
  const members = new Map<number, Resident[]>();
  const used = new Set<string>();
  const frequency = new Map<string, number>();
  const remember = (name: string) => {
    used.add(name);
    const given = name.split(' ')[0];
    frequency.set(given, (frequency.get(given) ?? 0) + 1);
  };
  for (const r of census.residents) {
    let family = members.get(r.household);
    if (!family) members.set(r.household, family = []);
    family.push(r);
    if (census.households[r.household - 1].surname && r.identity) remember(r.identity.name);
  }

  const rng = new Rng(seed ^ 0x5355524e);
  const surnameUse = new Map<string, number>();
  const countSurname = (s: string) => surnameUse.set(s, (surnameUse.get(s) ?? 0) + 1);
  for (const h of census.households) if (h.surname) countSurname(h.surname);
  const target = Math.ceil(census.households.length / NAME_PARTS.last.length);
  for (const h of census.households) {
    const family = members.get(h.id);
    if (!family?.length) continue;
    const established = !!h.surname;
    // Older rooms recorded separate names for each relative. The first male member by
    // census order supplies the married surname. A family with no male keeps its own.
    const anchor = family.find(r => r.identity?.gender === 'male') ?? family.find(r => r.identity);
    if (!h.surname) {
      const inherited = anchor?.identity?.name.split(' ')[1];
      if (inherited && (surnameUse.get(inherited) ?? 0) < target) h.surname = inherited;
      else {
        // Spread new and overrepresented legacy families across the expanded pool.
        const least = Math.min(...NAME_PARTS.last.map(s => surnameUse.get(s) ?? 0));
        h.surname = rng.pick(NAME_PARTS.last.filter(s => (surnameUse.get(s) ?? 0) === least));
      }
      countSurname(h.surname);
    }
    const surname = h.surname;
    for (const r of family) {
      if (established && r.identity) continue;
      const gender: Gender = r.identity?.gender ??
        (new Rng(seed ^ Math.imul(r.id, 0x85ebca6b)).chance(0.5) ? 'male' : 'female');
      const choices = NAME_PARTS[gender].filter(g => g.length + surname.length < 16);
      const unused = choices.filter(g => !used.has(g + ' ' + surname));
      const pool = unused.length ? unused : choices;
      const least = Math.min(...pool.map(g => frequency.get(g) ?? 0));
      const previous = r.identity?.name.split(' ')[0];
      const given = previous && pool.includes(previous) && (frequency.get(previous) ?? 0) <= least
        ? previous : rng.pick(pool.filter(g => (frequency.get(g) ?? 0) === least));
      r.identity = { gender, name: given + ' ' + surname };
      remember(r.identity.name);
    }
  }
}
