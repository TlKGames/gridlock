// Where a room runs, as the lobby sees it. The server runs each room in a worker thread of its own
// (workerRoom.ts), because each universe is installed per thread (packs/index.ts). Headless scripts
// run rooms in-process instead (LocalRoom, the installed universe only).
import { UNIVERSE } from '../shared/packs';
import type { C2S } from '../shared/protocol';
import { sanitizeCharacter } from './characters';
import type { Player } from './game/entities';
import { type Conn, Room } from './room';

/** A seated player: opaque to the lobby. */
export type Seat = unknown;
export type JoinResult = { seat: Seat } | { error: string };

export interface RoomHost {
  readonly code: string;
  readonly universe: string;
  readonly size: number;
  readonly tickMs: number;
  readonly emptySince: number;
  names(): string[];
  /** Seats a guest (name only) or a character (raw, as the browser sent it; checked where the room
   *  runs). A worker answers later. */
  join(name: string, conn: Conn, character: unknown): JoinResult | Promise<JoinResult>;
  onMessage(seat: Seat, msg: C2S): void;
  leave(seat: Seat): void;
  /** Saves the room and shuts it down. */
  close(): void;
}

/** A room in this thread: the installed universe's. */
export class LocalRoom implements RoomHost {
  readonly room: Room;
  readonly universe = UNIVERSE.id;

  constructor(readonly code: string, seed: number, mode?: string) {
    this.room = new Room(code, seed, mode);
  }

  get size(): number { return this.room.size; }
  get tickMs(): number { return this.room.tickMs; }
  get emptySince(): number { return this.room.emptySince; }
  names(): string[] { return this.room.names(); }

  join(name: string, conn: Conn, character: unknown): JoinResult {
    let save;
    try {
      save = character === undefined ? undefined : sanitizeCharacter(character);
    } catch (err) {
      console.warn('Could not read character save', err);
      return { error: 'Your saved balance could not be read. Please try joining again.' };
    }
    if (save === null) return { error: 'That character could not be read.' };
    const res = this.room.join(name, conn, save);
    return typeof res === 'string' ? { error: res } : { seat: res };
  }

  onMessage(seat: Seat, msg: C2S): void { this.room.onMessage(seat as Player, msg); }
  leave(seat: Seat): void { this.room.leave(seat as Player); }
  close(): void { this.room.persist(); this.room.stop(); }
}
