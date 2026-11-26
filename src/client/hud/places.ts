// What each place's pane offers. Content comes from the packs; this only maps verbs to rows.
import { FACTIONS, GANGS, PROPERTIES, RESPECT, RULES, SERVICES, VEHICLES, WEAPONS, vehicleIndex, weaponIndex } from '../../shared/packs';
import { type BuyKind, Mode, type Profile, type YouState } from '../../shared/protocol';
import type { Place } from '../../shared/world/cityTypes';
import type { PaneContent, PaneRow } from './pane';

export type Buy = (kind: BuyKind, id: string, place: number) => void;

const $ = (n: number) => `$${n.toLocaleString('en-US')}`;

/** An ATM or a bank's counter: your balance, deposit, withdraw. */
function bankContent(place: Place, you: YouState, buy: Buy): PaneContent {
  const rows: PaneRow[] = [
    { name: 'Deposit all cash', sub: 'Banked money is safe if you die or get busted', price: $(you.cash), disabled: you.cash <= 0, group: 'Deposit', onClick: () => buy('deposit', 'all', place.id) },
  ];
  for (const n of [100, 500, 1000, 5000]) {
    rows.push({ name: `Withdraw ${$(n)}`, disabled: you.bank < n, group: 'Withdraw', onClick: () => buy('withdraw', String(n), place.id) });
  }
  rows.push({ name: 'Withdraw everything', price: $(you.bank), disabled: you.bank <= 0, group: 'Withdraw', onClick: () => buy('withdraw', 'all', place.id) });
  return { title: place.name, subtitle: `Cash ${$(you.cash)} · Bank ${$(you.bank)}`, rows };
}

/** A tower's elevator or an apartment block's stairs (game/interact.ts: id is the interior index,
 *  `spec` how many floors are above the lobby, `lot` the floor this lift stop is on). */
function liftContent(place: Place, buy: Buy): PaneContent {
  // Up to the roof: back into a helicopter you set down there.
  const rows: PaneRow[] = [{ name: 'Roof', sub: 'Helicopter', onClick: () => buy('floor', 'roof', place.id) }];
  for (let f = place.spec; f >= 0; f--) {
    rows.push({ name: f === 0 ? 'Lobby' : `Floor ${f + 1}`, sub: f === place.lot ? 'You are here' : undefined, disabled: f === place.lot,
      onClick: () => buy('floor', String(f), place.id) });
  }
  return { title: place.name, rows };
}

export function serviceContent(place: Place, you: YouState, buy: Buy): PaneContent {
  if (place.verb === 'atm' || place.verb === 'bank') return bankContent(place, you, buy);
  if (place.verb === 'lift') return liftContent(place, buy);
  const spec = SERVICES[place.spec];
  const cash = you.cash + you.bank; // shops take cash first, then the bank
  const rows: PaneRow[] = [];
  const driving = you.mode === Mode.Driver;
  switch (spec.verb) {
    case 'gunshop': {
      rows.push({ name: 'Body Armor', sub: 'Full armor plate', price: $(RULES.armorPrice), affordable: cash >= RULES.armorPrice, group: 'Protection', onClick: () => buy('armor', '', place.id) });
      for (const id of spec.stock ?? []) {
        const wi = weaponIndex(id), w = WEAPONS[wi];
        const owned = you.w.some((h) => h[0] === wi);
        const group = ['Melee', 'Pistols', 'SMGs', 'Shotguns', 'Rifles', 'Sniper', 'Heavy', 'Heavy', 'Throwables', 'Launchers'][w.slot];
        if (owned && w.clip === 0) { rows.push({ name: w.name, sub: 'Owned', group, disabled: true }); continue; }
        const price = owned ? w.ammoPrice : w.price;
        rows.push({ name: w.name, sub: owned ? `+${w.ammoBundle} ammo` : `${w.damage ? `${w.damage}${w.pellets ? `×${w.pellets}` : ''} dmg` : 'explosive'}${w.clip ? ` · ${w.clip} rnd` : ''}`,
          price: $(price), affordable: cash >= price, group, onClick: () => buy(owned ? 'ammo' : 'weapon', id, place.id) });
      }
      break;
    }
    case 'dealer':
      for (const id of spec.stock ?? []) {
        const v = VEHICLES[vehicleIndex(id)];
        rows.push({ name: v.name, sub: `${Math.round(v.maxSpeed * 3.6)} km/h · ${v.seats} seats`, price: $(v.price), affordable: cash >= v.price, onClick: () => buy('vehicle', id, place.id) });
      }
      return { title: place.name, subtitle: 'Bought vehicles go to your garage and are delivered here.', rows };
    case 'hospital':
      rows.push({ name: 'Patch me up', sub: 'Restore full health', price: $(RULES.healPrice), affordable: cash >= RULES.healPrice, onClick: () => buy('heal', '', place.id) });
      break;
    case 'respray':
      rows.push(driving
        ? { name: 'Respray & repair', sub: 'New paint, repaired, wanted level cleared', price: $(spec.price ?? 500), affordable: cash >= (spec.price ?? 500), onClick: () => buy('respray', '', place.id) }
        : { name: 'Drive a vehicle onto the pad', disabled: true });
      break;
    case 'chopshop':
      rows.push(driving && you.vt >= 0
        ? { name: `Sell this ${VEHICLES[you.vt].name}`, sub: 'Cash for stolen vehicles, paid by condition', price: `~${$(Math.round(VEHICLES[you.vt].price * RULES.chopValue * Math.max(0.2, you.vhp)))}`, onClick: () => buy('chop', '', place.id) }
        : { name: 'Bring us a vehicle', disabled: true });
      break;
    default:
      rows.push({ name: 'Nothing for sale here', disabled: true });
  }
  return { title: place.name, rows };
}

/** Your business: the safe, any crew at the door, and what the place does for you (packs `perk`). */
function businessRows(place: Place, you: YouState, profile: Profile, buy: Buy): PaneRow[] {
  const spec = PROPERTIES[place.spec];
  const rows: PaneRow[] = [];
  const trouble = profile.trouble?.find((t) => t[0] === place.id);
  if (trouble) {
    const price = spec.income * RULES.payoffHours;
    const gang = FACTIONS.find((f) => f.id === trouble[1])?.name ?? trouble[1];
    rows.push({ name: `Pay off the ${gang}`, sub: 'Or deal with them yourself before they hit the safe', price: $(price), affordable: you.cash + you.bank >= price, group: 'Trouble', onClick: () => buy('payoff', '', place.id) });
  }
  const safe = profile.safes?.find((s) => s[0] === place.id)?.[1] ?? 0;
  rows.push({ name: 'Empty the safe', sub: `Holds up to ${$(spec.income * RULES.safeHours)}. Left at midnight, it goes to your bank less ${Math.round(RULES.safeSweepFee * 100)}%`,
    price: $(safe), disabled: safe <= 0 || !!trouble, group: 'Safe', onClick: () => buy('collect', '', place.id) });
  if (spec.perk === 'club') {
    GANGS.forEach((g, i) => {
      if ((you.rs[i] ?? 0) < RESPECT.noWorkBelow) return;
      const name = FACTIONS.find((f) => f.id === g)?.name ?? g;
      rows.push({ name: `Meet the ${name}`, sub: 'They have work, paid like a phone job', group: 'In the back room', onClick: () => buy('meet', g, place.id) });
    });
  }
  if (spec.perk === 'wash') rows.push({ name: 'Drive onto the wash bay', sub: 'Your own wash takes the heat off', group: 'Perk', disabled: true });
  if (spec.perk === 'fence') rows.push({ name: 'Drive a stolen car into the loading bay', sub: `Sold at ${RULES.fenceMul}× what the chop shop pays`, group: 'Perk', disabled: true });
  return rows;
}

export function propertyContent(place: Place, you: YouState, profile: Profile, owner: string | null, buy: Buy): PaneContent {
  const spec = PROPERTIES[place.spec];
  const mine = profile.owned.includes(place.id);
  const rows: PaneRow[] = [];
  const info = spec.kind === 'home'
    ? `Home · garage for ${spec.garage} · respawn point`
    : `Business · earns ${$(spec.income)} every game hour`;
  if (!owner) {
    rows.push({ name: `Buy ${spec.name}`, sub: info, price: $(spec.price), affordable: you.cash + you.bank >= spec.price, onClick: () => buy('property', '', place.id) });
  } else if (!mine) {
    rows.push({ name: `Owned by ${owner}`, sub: info, disabled: true });
  } else {
    rows.push({ name: 'You own this', sub: info, disabled: true });
    if (spec.kind === 'business') rows.push(...businessRows(place, you, profile, buy));
    if (spec.kind === 'home') {
      const seen = new Set<number>();
      for (const vi of profile.garage) {
        if (seen.has(vi)) continue;
        seen.add(vi);
        rows.push({ name: VEHICLES[vi].name, sub: 'Bring it out', group: 'Garage', onClick: () => buy('garage', String(vi), place.id) });
      }
      if (!seen.size) rows.push({ name: 'Garage is empty', sub: 'Buy vehicles at a dealer', group: 'Garage', disabled: true });
    }
  }
  return { title: place.name, subtitle: spec.kind === 'home' ? 'Residence' : 'Business', rows };
}
