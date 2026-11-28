// Player characters: how many a player may keep and what their look can be made of (the choices
// come from the installed universe). A look stores indices into those lists, so changing a colour
// there restyles everyone using it.
import type { LookPart, Universe } from './types';

export type { LookPart };

export const MAX_CHARACTERS = 5;

/** Choices per look part (filled by installUniverse). */
export const CHARACTER_LOOKS = {} as Record<LookPart, string[]>;
export const LOOK_PARTS: LookPart[] = ['skin', 'hair', 'hairStyle', 'top', 'bottom', 'hat'];

/** Indices into CHARACTER_LOOKS, one per part. */
export type CharLook = Record<LookPart, number>;

export const DEFAULT_LOOK: CharLook = { skin: 0, hair: 0, hairStyle: 0, top: 0, bottom: 0, hat: 0 };

/** Parts the creator's random names are rolled from (kept short: names cap at 16 characters). */
export const NAME_PARTS: Universe['nameParts'] = { first: [], last: [], male: [], female: [] };

export type Gender = 'male' | 'female';

export function generateName(random: () => number, gender?: Gender): string {
  const first = gender ? NAME_PARTS[gender] : NAME_PARTS.first;
  const family = NAME_PARTS.last[Math.floor(random() * NAME_PARTS.last.length)];
  const choices = first.filter(given => given.length + 1 + family.length <= 16);
  return choices[Math.floor(random() * choices.length)] + ' ' + family;
}

export function installLooks(u: Universe): void {
  for (const k of LOOK_PARTS) CHARACTER_LOOKS[k] = u.looks[k];
  Object.assign(DEFAULT_LOOK, u.defaultLook);
  Object.assign(NAME_PARTS, u.nameParts);
}

/** Clamps untrusted look data to valid palette indices. */
export function cleanLook(raw: unknown): CharLook {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LOOK };
  for (const k of LOOK_PARTS) {
    const v = Number(src[k]);
    if (Number.isInteger(v) && v >= 0 && v < CHARACTER_LOOKS[k].length) out[k] = v;
  }
  return out;
}

/** Character names: letters, digits, space, - . _ ; 2–16 characters. Empty string if invalid. */
export function cleanName(raw: unknown): string {
  const n = String(raw ?? '').replace(/[^\w \-.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length >= 2 ? n : '';
}

/** Where a character was when they last played: they pick up there, in that vehicle. */
export interface CharacterLast {
  room: string;              // room code, for "Continue"
  x: number; y: number; angle: number;
  vehicle?: { type: number; color: number; vin?: string };
}

/** What playing changes on a character; the server sends it back for the browser to save. */
export interface CharacterProgress {
  /** Reference to the server-side wallet at the current craps table. */
  crapsReceipt?: string;
  cash: number;
  /** Money in the bank: safe from death and arrest; shops draw on it once cash runs out. */
  bank: number;
  garage: number[];          // vehicle type indexes
  /** Crime kind → times committed. */
  felonies: Record<string, number>;
  deaths: number;
  respect: Record<string, number>;
  /** Callers (packs/calls.ts) who've introduced themselves: their first call isn't repeated. */
  met?: string[];
  last?: CharacterLast;
}

/** A character as the player's browser keeps it (local storage); brought along to every game. */
export interface CharacterSave extends CharacterProgress {
  id: string;
  /** The universe (pack set and city) the character lives in: UNIVERSE.id. Characters from another
   *  universe aren't listed or let into this one's rooms. */
  universe: string;
  name: string;
  look: CharLook;
  /** Their voice on the phone (packs/calls.ts PLAYER_VOICES); older characters have none yet. */
  voice?: string;
  created: number;
  lastPlayed: number;
}
