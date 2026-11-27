// Game sounds: CC0 recordings from Freesound (ASSETS.md), prepared by tools/blender/prep_audio.py
// into src/client/sfx/ and all levelled alike, so the mix lives in VOICES below. Distance-attenuated.
// The siren is one looping voice that follows the nearest siren; engines are in engines.ts.
import { groundOf, isWayStrip } from '../../shared/world/levels';
import { heightAt } from '../../shared/world/ways';
import { ENGINES, EngineVoice, TRAFFIC } from './engines';
import { playTune } from './handset';
import { type Line, playOnLine } from './phoneVoice';

/** Every voice the game plays: its recording, gain, pitch wobble (random ± fraction) and the least
 *  time between two plays (rapid-fire weapons would otherwise stack dozens of copies). */
const VOICES: Record<string, { file: string; gain: number; vary?: number; gap?: number; rate?: number }> = {
  pistol: { file: 'pistol', gain: 0.55, vary: 0.05 },
  revolver: { file: 'revolver', gain: 0.6, vary: 0.04 },
  smg: { file: 'smg', gain: 0.45, vary: 0.06 },
  shotgun: { file: 'shotgun', gain: 0.65, vary: 0.04 },
  rifle: { file: 'rifle', gain: 0.55, vary: 0.05 },
  sniper: { file: 'sniper', gain: 0.7, vary: 0.03 },
  minigun: { file: 'minigun', gain: 0.38, vary: 0.05 },
  flame: { file: 'flame', gain: 0.4, vary: 0.08, gap: 0.3 },
  launcher: { file: 'launcher', gain: 0.55, vary: 0.04 },
  rocket: { file: 'rocket', gain: 0.55, vary: 0.04 },
  cannon: { file: 'cannon', gain: 0.85, vary: 0.03 },
  punch: { file: 'punch', gain: 0.45, vary: 0.1 },
  swing: { file: 'swing', gain: 0.3, vary: 0.1 },
  throw: { file: 'swing', gain: 0.3, vary: 0.12 },
  slash: { file: 'slash', gain: 0.35, vary: 0.08 },
  boom: { file: 'boom', gain: 1, vary: 0.06 },
  crash: { file: 'crash', gain: 0.4, vary: 0.1, gap: 0.08 },
  splash: { file: 'splash', gain: 0.5, vary: 0.08 },
  horn: { file: 'horn', gain: 0.35, vary: 0.03 },
  horn_small: { file: 'horn_small', gain: 0.32, vary: 0.03 },
  horn_deep: { file: 'horn_deep', gain: 0.38, vary: 0.03 },
  horn_air: { file: 'horn_air', gain: 0.42, vary: 0.02 },
  horn_bus: { file: 'horn_bus', gain: 0.4, vary: 0.02 },
  horn_icecream: { file: 'horn_icecream', gain: 0.3, gap: 4.5 },
  cash: { file: 'cash', gain: 0.22 },
  /** Payphones ringing for you (silent until the CC0 recording is fetched and prepared). Your cell
   *  phone's ringtone and text chirp are synthesised (audio/handset.ts, `tune`). */
  phone_ring: { file: 'phone_ring', gain: 0.4 },
};
const SIREN_GAIN = 0.3;
/** Tyres squealing in a slide: one loop that follows the hardest slide nearby (ASSETS.md `skid`). */
const SKID_GAIN = 0.32;
/** Most sounds playing at once; past this, new ones are dropped. */
const MAX_VOICES = 28;

export interface TrafficEngine { id: number; name: string; x: number; y: number; speed: number; throttle: number }

const FILES = import.meta.glob('../sfx/*.ogg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (name: string) => FILES[`../sfx/${name}.ogg`];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private playing = 0;
  private sirenSrc: AudioBufferSourceNode | null = null;
  private sirenGain: GainNode | null = null;
  private own: EngineVoice | null = null;
  private traffic = new Map<number, EngineVoice>();
  private volume: number;
  private muted: boolean;
  listenerX = 0;
  listenerY = 0;
  /** How high you are: an upper floor, a train's viaduct (0 = the street). */
  listenerZ = 0;

  /** Music (radio) volume, 1–100, separate from the game's sounds. */
  private music: number;

  constructor() {
    this.volume = percent(safeGet('gridlock.volume.game'), 50) / 100;
    this.music = percent(safeGet('gridlock.volume.music'), 70);
    this.muted = new URLSearchParams(location.search).has('mute');
    const unlock = () => { this.ensure(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Game sounds, 0–1. */
  get level(): number { return this.volume; }
  /** Game and music volume as the sliders show them (1–100). */
  get gamePercent(): number { return Math.round(this.volume * 100); }
  get musicPercent(): number { return this.music; }
  /** Music volume, 0–1. */
  get musicLevel(): number { return this.music / 100; }

  setGame(p: number): void {
    this.volume = percent(p, 50) / 100;
    safeSet('gridlock.volume.game', String(this.gamePercent));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.6;
  }

  setMusic(p: number): void {
    this.music = percent(p, 70);
    safeSet('gridlock.volume.music', String(this.music));
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume * 0.6;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      const names = new Set([...Object.values(VOICES).map((v) => v.file), 'siren', 'skid', ...Object.keys(ENGINES)]);
      for (const name of names) {
        const url = urlOf(name);
        if (!url) continue;
        fetch(url).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a))
          .then((b) => this.buffers.set(name, b)).catch(() => { /* that sound stays silent */ });
      }
    } catch { this.ctx = null; }
    return this.ctx;
  }

  /** Distance gain for a world position (null = at the listener). */
  private falloff(x: number | null, y: number | null): number {
    if (x === null || y === null) return 1;
    // Upper floors and a train's viaduct sit off the map (world/levels.ts): back over the street, and
    // the height between you and the sound muffles it like a good stretch of distance (floors and
    // walls more than a viaduct's open air).
    const g = groundOf(x, y);
    const k = isWayStrip(g.f) ? 1.5 : 4;
    const d = Math.hypot(g.x - this.listenerX, g.y - this.listenerY, (heightAt(x, y) - this.listenerZ) * k);
    return 1 / (1 + (d / 30) ** 2);
  }

  /** Plays a voice at a world position (null = at the listener). */
  play(voice: string, x: number | null = null, y: number | null = null): void {
    const ctx = this.ensure();
    const v = VOICES[voice];
    if (!ctx || !this.master || !v || this.muted || this.volume <= 0) return;
    const g = this.falloff(x, y);
    const buf = this.buffers.get(v.file);
    if (g < 0.02 || !buf || this.playing >= MAX_VOICES) return;
    const t = ctx.currentTime;
    if (v.gap && t - (this.lastPlay.get(voice) ?? -1) < v.gap) return;
    this.lastPlay.set(voice, t);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (v.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (v.vary ?? 0));
    const gain = ctx.createGain();
    gain.gain.value = v.gain * g;
    src.connect(gain).connect(this.master);
    this.playing++;
    src.onended = () => { this.playing--; src.disconnect(); gain.disconnect(); };
    src.start(t);
  }

  private lines = new Map<string, Promise<AudioBuffer | null>>();

  /** Speaks a voiced line (a clip URL) down a phone line; resolves with its length in seconds once
   *  it's finished (0 straight away if there's no clip: the caller's bubble times itself then).
   *  Muted, it still waits out the line's length, so a conversation keeps its pace. */
  async line(url: string | undefined, via: Line): Promise<number> {
    const ctx = this.ensure();
    if (!ctx || !this.master || !url) return 0;
    let p = this.lines.get(url);
    if (!p) {
      p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((a) => ctx.decodeAudioData(a)).catch(() => null);
      this.lines.set(url, p);
    }
    const buf = await p;
    if (!buf) return 0;
    if (this.muted || this.volume <= 0) { await new Promise((r) => setTimeout(r, buf.duration * 1000)); return buf.duration; }
    await playOnLine(ctx, this.master, buf, via, 1.1);
    return buf.duration;
  }

  /** Plays one of the cell phone's synthesised tunes (audio/handset.ts): 'ringtone' or 'text'. */
  tune(name: string): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted || this.volume <= 0) return;
    playTune(ctx, this.master, name);
  }

  /** A new engine voice for `name`, or null when it can't play (no sound yet, muted, unknown). */
  private voice(name: string): EngineVoice | null {
    const buf = this.buffers.get(name);
    if (!this.ctx || !this.master || !buf || !ENGINES[name] || this.muted) return null;
    return new EngineVoice(this.ctx, this.master, buf, name);
  }

  /** Call every frame with your vehicle's engine voice (or null on foot), its speed as a fraction of
   *  top speed and the throttle (0..1): one loop that runs through the gears. */
  engine(name: string | null, speed: number, throttle: number): void {
    if (this.own && this.own.name !== name) { this.own.stop(); this.own = null; }
    if (!name) return;
    this.own ??= this.voice(name);
    this.own?.set(speed, throttle);
  }

  /** Call every frame with the nearest moving vehicles (at most TRAFFIC.max): their engines, quieter
   *  than yours and fading with distance. Vehicles that drop off the list fade out. */
  trafficEngines(list: TrafficEngine[]): void {
    const keep = new Set(list.map((t) => t.id));
    for (const [id, v] of this.traffic) if (!keep.has(id)) { v.stop(); this.traffic.delete(id); }
    for (const t of list) {
      let v = this.traffic.get(t.id);
      if (!v) { const nv = this.voice(t.name); if (!nv) continue; this.traffic.set(t.id, v = nv); }
      const d = Math.hypot(t.x - this.listenerX, t.y - this.listenerY);
      const near = Math.max(0, 1 - d / TRAFFIC.range);
      v.set(t.speed, t.throttle, TRAFFIC.gain * near * near);
    }
  }

  private skidSrc: AudioBufferSourceNode | null = null;
  private skidGain: GainNode | null = null;

  /** Call every frame with the hardest slide nearby (k 0..1, render/skids.ts): one looping squeal,
   *  louder and a little higher the harder it slides, fading out as the tyres grip again. */
  tyres(k: number, x: number, y: number): void {
    const ctx = this.ctx;
    const buf = this.buffers.get('skid');
    if (!ctx || !this.master || !buf) return;
    const want = k > 0 && !this.muted ? SKID_GAIN * (0.4 + 0.6 * k) * this.falloff(x, y) : 0;
    if (want > 0 && !this.skidSrc) {
      this.skidSrc = ctx.createBufferSource();
      this.skidSrc.buffer = buf;
      this.skidSrc.loop = true;
      this.skidGain = ctx.createGain();
      this.skidGain.gain.value = 0;
      this.skidSrc.connect(this.skidGain).connect(this.master);
      this.skidSrc.start(ctx.currentTime, Math.random() * buf.duration);
    }
    if (!this.skidSrc || !this.skidGain) return;
    this.skidSrc.playbackRate.setTargetAtTime(0.92 + 0.16 * k, ctx.currentTime, 0.08);
    this.skidGain.gain.setTargetAtTime(want, ctx.currentTime, want > 0 ? 0.04 : 0.12);
    if (want === 0 && this.skidGain.gain.value < 0.003) {
      this.skidSrc.stop();
      this.skidSrc.disconnect(); this.skidGain.disconnect();
      this.skidSrc = null; this.skidGain = null;
    }
  }

  /** Call every frame with the nearest siren (or null): one looping wail that follows it. */
  siren(at: { x: number; y: number } | null): void {
    const ctx = this.ctx;
    const buf = this.buffers.get('siren');
    if (!ctx || !this.master || !buf) return;
    const want = at && !this.muted ? SIREN_GAIN * this.falloff(at.x, at.y) : 0;
    if (want > 0 && !this.sirenSrc) {
      this.sirenSrc = ctx.createBufferSource();
      this.sirenSrc.buffer = buf;
      this.sirenSrc.loop = true;
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenSrc.connect(this.sirenGain).connect(this.master);
      this.sirenSrc.start(ctx.currentTime, Math.random() * buf.duration);
    }
    if (!this.sirenSrc || !this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(want, ctx.currentTime, 0.15);
    if (want === 0 && this.sirenGain.gain.value < 0.003) {
      this.sirenSrc.stop();
      this.sirenSrc.disconnect(); this.sirenGain.disconnect();
      this.sirenSrc = null; this.sirenGain = null;
    }
  }
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}
/** A volume setting as a whole number 1–100 (anything unreadable gets the default). */
function percent(v: unknown, dflt: number): number {
  const n = Math.round(Number(v ?? dflt));
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : dflt;
}
