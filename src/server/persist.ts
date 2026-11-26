// Room save files: property ownership and player profiles survive server restarts. A room belongs
// to one universe (UNIVERSE.id); saves from another, or from an older save version, aren't loaded.
// On a hosted server, point GRIDLOCK_DATA at a persistent volume so rooms outlive redeploys.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNIVERSE } from '../shared/packs';

/** Bumped when the save format changes (v2: the universe); older saves are left unread. */
export const SAVE_VERSION = 2;

export interface SavedProfile { name?: string; cash: number; bank?: number; garage: number[]; owned: number[]; felonies?: Record<string, number>; deaths: number; respect?: Record<string, number>; met?: string[] }

export interface RoomSave {
  version: typeof SAVE_VERSION;
  universe: string;
  seed: number;
  mode?: string;
  gameMinutes: number;
  owners: [number, string][];
  /** Business safes: [property id, dollars]. */
  safes?: [number, number][];
  profiles: Record<string, SavedProfile>;
}

const DIR = process.env.GRIDLOCK_DATA ?? join(process.cwd(), 'data');

const file = (code: string) => join(DIR, `room-${code.replace(/[^A-Z0-9]/gi, '')}.json`);

export function loadRoom(code: string): RoomSave | null {
  try {
    const f = file(code);
    if (!existsSync(f)) return null;
    const data = JSON.parse(readFileSync(f, 'utf8')) as RoomSave;
    return data.version === SAVE_VERSION && data.universe === UNIVERSE.id ? data : null;
  } catch (err) {
    console.warn(`[persist] could not load ${code}:`, err);
    return null;
  }
}

/** The universe a room's save belongs to (any universe; null when there's no readable save of
 *  this version). The lobby reads it before choosing where the room runs. */
export function savedUniverse(code: string): string | null {
  try {
    const f = file(code);
    if (!existsSync(f)) return null;
    const data = JSON.parse(readFileSync(f, 'utf8')) as Partial<RoomSave>;
    return data.version === SAVE_VERSION && typeof data.universe === 'string' ? data.universe : null;
  } catch {
    return null;
  }
}

/** Whether any save file uses this code (so a new room never takes it). */
export const codeTaken = (code: string): boolean => existsSync(file(code));

export function saveRoom(code: string, save: RoomSave): void {
  try {
    mkdirSync(DIR, { recursive: true });
    const f = file(code);
    writeFileSync(`${f}.tmp`, JSON.stringify(save));
    renameSync(`${f}.tmp`, f);
  } catch (err) {
    console.warn(`[persist] could not save ${code}:`, err);
  }
}
