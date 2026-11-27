// Character creator: big preview, name with a dice roll, look swatches, randomization and preview rotation
// Ctrl+Z / Ctrl+Y still undo or redo edits outside the name field.
import { CHARACTER_LOOKS, type CharLook, LOOK_PARTS, type LookPart, NAME_PARTS, PLAYER_VOICES, youLineId } from '../../shared/packs';
import { clipOf } from '../audio/voiceClips';
import { CreatorPreview } from './creatorPreview';
import { figureCanvas } from './figure';

export interface Draft { name: string; look: CharLook; voice: string }

/** Plays a voice's sample line (one at a time). */
let sampleAudio: HTMLAudioElement | null = null;
function playSample(voice: string): void {
  const url = clipOf(youLineId(voice, 'sample'));
  if (!url) return;
  sampleAudio?.pause();
  sampleAudio = new Audio(url);
  sampleAudio.volume = 0.8;
  void sampleAudio.play().catch(() => { /* blocked or missing: stays quiet */ });
}

const LABEL: Record<LookPart, string> = { skin: 'Skin', hair: 'Hair colour', hairStyle: 'Hair', top: 'Top', bottom: 'Trousers', hat: 'Hat' };
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[rnd(a.length)];

export function rollName(): string {
  for (;;) {
    const n = `${pick(NAME_PARTS.first)} ${pick(NAME_PARTS.last)}`;
    if (n.length <= 16) return n;
  }
}

/** A random look; hats only sometimes. */
export function randomLook(hats = true): CharLook {
  const L = CHARACTER_LOOKS;
  return {
    skin: rnd(L.skin.length), hair: rnd(L.hair.length), hairStyle: rnd(L.hairStyle.length), top: rnd(L.top.length),
    bottom: rnd(L.bottom.length), hat: hats && Math.random() < 0.35 ? 1 + rnd(L.hat.length - 1) : 0,
  };
}

export class Creator {
  private draft: Draft = { name: rollName(), look: randomLook(false), voice: PLAYER_VOICES[Math.floor(Math.random() * PLAYER_VOICES.length)].id };
  /** The name came from a roll (Random may re-roll it); typing makes it the player's own. */
  private rolledName = true;
  private preview?: CreatorPreview;
  private undo: Draft[] = [];
  private redo: Draft[] = [];
  error = '';
  private keys = (e: KeyboardEvent) => this.onKey(e);

  constructor(private root: HTMLElement, private canCancel: boolean, private create: (d: Draft) => void, private cancel: () => void) {
    try { this.preview = new CreatorPreview(); } catch { /* Keep the flat portrait when WebGL is unavailable. */ }
    window.addEventListener('keydown', this.keys);
    this.render();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keys);
    this.preview?.dispose();
  }

  private apply(next: Draft, rolled = this.rolledName): void {
    this.undo.push(structuredClone(this.draft));
    this.redo = [];
    this.draft = next;
    this.rolledName = rolled;
    this.render();
  }

  private step(from: Draft[], to: Draft[]): void {
    const prev = from.pop();
    if (!prev) return;
    to.push(structuredClone(this.draft));
    this.draft = prev;
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.step(this.undo, this.redo); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.step(this.redo, this.undo); }
  }

  render(): void {
    const r = this.root;
    r.innerHTML = '';
    r.appendChild(el('div', 'chars-head', 'New character'));
    const wrap = el('div', 'creator');
    wrap.append(this.stage(), this.form());
    r.appendChild(wrap);
    if (this.error) r.appendChild(el('p', 'error', this.error));
    const actions = el('div', 'row');
    const ok = el('button', 'primary', 'Create character');
    ok.addEventListener('click', () => this.submit());
    actions.appendChild(ok);
    if (this.canCancel) {
      const c = el('button', '', 'Cancel');
      c.addEventListener('click', () => this.cancel());
      actions.appendChild(c);
    }
    r.appendChild(actions);
  }

  private submit(): void {
    this.error = '';
    this.create(structuredClone(this.draft));
  }

  private stage(): HTMLElement {
    const s = el('div', 'creator-stage');
    s.appendChild(this.preview?.show(this.draft.look) ?? figureCanvas(this.draft.look, 96, 192));
    const tools = el('div', 'creator-tools');
    const tool = (label: string, title: string, enabled: boolean, act: () => void, cls = '') => {
      const b = el('button', cls, label);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.disabled = !enabled;
      b.addEventListener('click', act);
      tools.appendChild(b);
    };
    tool('Random', 'Random look and name', true, () => this.apply({ ...this.draft, name: this.rolledName ? rollName() : this.draft.name, look: randomLook() }), 'grow');
    tool('↶', 'Rotate left', !!this.preview, () => this.preview?.rotate(-1));
    tool('↷', 'Rotate right', !!this.preview, () => this.preview?.rotate(1));
    s.appendChild(tools);
    return s;
  }

  private form(): HTMLElement {
    const f = el('div', 'creator-form');
    f.appendChild(el('small', 'look-label', 'Name'));
    const row = el('div', 'name-row');
    const name = document.createElement('input');
    name.maxLength = 16;
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.value = this.draft.name;
    name.addEventListener('input', () => { this.draft.name = name.value; this.rolledName = false; });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submit(); });
    const dice = el('button', 'dice', '⚄');
    dice.title = 'Random name';
    dice.addEventListener('click', () => this.apply({ ...this.draft, name: rollName() }, true));
    row.append(name, dice);
    f.appendChild(row);
    for (const part of LOOK_PARTS) f.appendChild(this.partRow(part));
    f.appendChild(this.voiceRow());
    return f;
  }

  /** The voice they speak with on the phone: pick one and hear it say a line. */
  private voiceRow(): HTMLElement {
    const box = el('div', 'look-part');
    box.appendChild(el('small', 'look-label', 'Voice'));
    const row = el('div', 'segmented voices');
    for (const v of PLAYER_VOICES) {
      const on = this.draft.voice === v.id;
      const b = el('button', `seg${on ? ' on' : ''}`, `${v.name} ▸`);
      b.title = `Hear ${v.name}`;
      b.addEventListener('click', () => {
        playSample(v.id);
        if (!on) this.apply({ ...this.draft, voice: v.id });
      });
      row.appendChild(b);
    }
    box.appendChild(row);
    return box;
  }

  private partRow(part: LookPart): HTMLElement {
    const box = el('div', 'look-part');
    box.appendChild(el('small', 'look-label', LABEL[part]));
    const row = el('div', part === 'hairStyle' ? 'segmented' : 'swatches');
    CHARACTER_LOOKS[part].forEach((v, i) => {
      const on = this.draft.look[part] === i;
      const text = part === 'hairStyle' ? v : '';
      const b = el('button', `${part === 'hairStyle' ? 'seg' : 'sw'}${on ? ' on' : ''}${part === 'hat' && i === 0 ? ' none' : ''}`, text);
      if (!text && v) b.style.background = v;
      b.title = part === 'hat' && i === 0 ? 'No hat' : text || LABEL[part];
      b.addEventListener('click', () => { if (!on) this.apply({ ...this.draft, look: { ...this.draft.look, [part]: i } }); });
      row.appendChild(b);
    });
    box.appendChild(row);
    return box;
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
