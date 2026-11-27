// WebSocket connection to the game server.
import { type CharacterSave, UNIVERSE } from '../../shared/packs';
import { type C2S, PROTOCOL_VERSION, type S2C } from '../../shared/protocol';
import { saveProgress } from '../lobby/characterStore';

export class Connection {
  private ws: WebSocket;
  private handlers = new Set<(m: S2C) => void>();
  onClose: (reason: string) => void = () => {};
  rtt = 0;

  /** `who` is the player's character (from this browser's storage) or a guest name. */
  constructor(who: CharacterSave | string, room: string, create: boolean, mode?: string, resume = false) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.onopen = () => {
      const id = typeof who === 'string' ? { name: who } : { name: who.name, char: who };
      this.send({ t: 'hello', v: PROTOCOL_VERSION, universe: UNIVERSE.id, room, create, mode, resume, ...id });
      setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
    };
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data as string) as S2C;
      if (m.t === 'save') saveProgress(m.id, m.p);
      if (m.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts;
      for (const h of this.handlers) h(m);
    };
    this.ws.onclose = () => this.onClose('Disconnected from server.');
    this.ws.onerror = () => this.onClose('Could not reach the server.');
  }

  on(fn: (m: S2C) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  send(m: C2S): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.ws.onclose = null;
    this.ws.close();
  }
}
