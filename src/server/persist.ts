// Room save files: property ownership and player profiles survive server restarts. A room belongs
// to one universe (UNIVERSE.id); saves from another, or from an older save version, aren't loaded.
// On a hosted server, point GRIDLOCK_DATA at a persistent volume so rooms outlive redeploys.
import type { Census } from './game/census';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNIVERSE } from '../shared/packs';

/** Bumped when the save format changes, or the city is laid out differently so property ids move
 *  (v2: the universe; v3: highway and railway corridors through the blocks; v4: no highways);
 *  older saves are left unread. */
export const SAVE_VERSION = 4;

export interface SavedProfile { name?: string; cash: number; bank?: number; garage: number[]; owned: number[]; felonies?: Record<string, number>; deaths: number; respect?: Record<string, number>; met?: string[] }

export interface RoomSave {
  census?: Census;
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

interface CrapsWallet { receipt: string; cash: number; bank: number }

/** One replaceable checkpoint per character, shared by all room workers on the save volume. */
function walletPath(id: string): string {
  const key = createHash('sha256').update(JSON.stringify([UNIVERSE.id, id])).digest('hex');
  return join(DIR, `craps-${key}.json`);
}

export function recordCrapsWallet(id: string, wallet: CrapsWallet): void {
  mkdirSync(DIR, { recursive: true });
  const path = walletPath(id);
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(wallet));
  renameSync(tmp, path);
}

export function recoverCrapsWallet(id: string, receipt: unknown): CrapsWallet | undefined {
  if (typeof receipt !== 'string' || receipt.length !== 36) return;
  const path = walletPath(id);
  if (!existsSync(path)) return;
  const saved: CrapsWallet = JSON.parse(readFileSync(path, 'utf8'));
  if (saved.receipt === receipt) return saved;
}
