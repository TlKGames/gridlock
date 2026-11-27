// A card or casino table's screen, built like the shops' counters (hud/showroom.ts): walking up fades
// the screen and opens a box with the table drawn large on the left and the stakes, your money and
// your moves on the right (cardTable.ts and each game's own), the moves you make most along the
// foot as an online table's action bar. The mouse plays it; so do the keys each game gives its
// moves (F fold, C call...), arrows and Enter (or the pad) to pick and press, Esc / Backspace / B to
// get up (asked first when that costs you). Every round's win or loss floats up over the table; the
// whole hand history opens from its corner. It redraws from the live state and only touches the
// page where something changed, so clicks, hovers and a slider you're dragging aren't lost.
import type { NavCmd } from '../game/input';
import type { TableScreen, TBtn, TSlider } from './cardTable';
import { type Act, esc, money } from './tableFelt';
import './tables.css';
import './tables2.css';

export interface TableVisit {
  /** The screen as things stand. */
  screen: (a: Act) => TableScreen;
  /** Get up from the table (the server's told). */
  leave: () => void;
  /** The box is gone. */
  close: () => void;
}

const FADE_MS = 220;

export class TableRoom {
  private root = document.createElement('div');
  private fade = document.createElement('div');
  private visit: TableVisit | null = null;
  private acts: (() => void)[] = [];
  private sliders: TSlider[] = [];
  private keyed = new Map<string, () => void>();
  private felt = '';
  private side = '';
  private top = '';
  private focus = '';
  private auto = true;
  private busy = false;
  private timer = 0;
  /** A slider being dragged: the side isn't redrawn under it. */
  private dragging = false;
  /** Leaving asked once (it costs you): a second press within a few seconds gets up. */
  private leaveArmed = 0;
  private history = false;
  private cash: number | null = null;
  private keys = (e: KeyboardEvent) => this.onKey(e);

  constructor() {
    this.fade.className = 'screen-fade';
    this.root.className = 'garage showroom tableroom';
    this.root.hidden = true;
    // The table fills the box; the title and money run along its top, every control along its foot.
    this.root.innerHTML = '<div class="garage-box tr-box"><div class="tr-top"></div><div class="tr-view"><div class="tr-felt"></div><div class="tr-float"></div><button class="tr-histbtn" type="button">History</button><div class="tr-log"></div></div><div class="tr-controls tr-side"></div></div>';
    // One listener for every button: each carries the index of what it does in this drawing.
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tr-histbtn')) { this.history = !this.history; this.refresh(); return; }
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      // A click on a control moves the pick there (back to resting on the main move if it was that).
      if (el.closest('.tr-side, .tr-top')) { this.focus = el.dataset.k ?? ''; this.auto = this.focus === 'primary'; }
      this.acts[Number(el.dataset.a)]?.();
      this.refresh();
    });
    // Sliders: their value goes straight to the game; the label beside it follows as you drag.
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const s = this.sliders[Number(el.dataset.in)];
      if (!s) return;
      s.set(Number(el.value));
      const lab = el.parentElement?.querySelector('.tr-sv');
      if (lab) lab.textContent = s.label(Number(el.value));
    });
    this.root.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).matches('input[type=range]')) this.dragging = true; });
    window.addEventListener('pointerup', () => { if (this.dragging) { this.dragging = false; this.refresh(); } });
    document.body.append(this.fade, this.root);
  }

  get isOpen(): boolean { return !!this.visit; }

  open(visit: TableVisit): void {
    if (this.visit) return;
    this.visit = visit;
    this.felt = this.side = this.top = this.focus = '';
    this.auto = true;
    this.cash = null;
    this.leaveArmed = 0;
    void this.blackout(() => {
      this.root.hidden = false;
      this.refresh();
      window.addEventListener('keydown', this.keys, true);
      this.timer = window.setInterval(() => this.refresh(true), 250);
    });
  }

  /** Walk away (`tell`: the server hears you get up; not when it put you out itself). */
  leave(tell = true): void {
    const v = this.visit;
    if (!v || this.busy) return;
    this.busy = true;
    if (tell) v.leave();
    void this.blackout(() => {
      window.clearInterval(this.timer);
      window.removeEventListener('keydown', this.keys, true);
      this.root.hidden = true;
      this.visit = null;
      this.busy = false;
      v.close();
    });
  }

  /** Esc, B, the button: asked first when getting up costs you. */
  private tryLeave(warn?: string): void {
    if (warn && performance.now() > this.leaveArmed) { this.leaveArmed = performance.now() + 3500; this.refresh(); return; }
    this.leave();
  }
  /** Esc from the game: the same as the button. */
  back(): void { this.tryLeave(this.warn); }
  private warn: string | undefined;

  /** Redraws from the live state; only what changed reaches the page. `tick`: the screen's own clock. */
  refresh(tick = false): void {
    const v = this.visit;
    if (!v || this.root.hidden) return;
    this.acts = [];
    this.sliders = [];
    this.keyed.clear();
    const a: Act = (fn) => { this.acts.push(fn); return `data-a="${this.acts.length - 1}"`; };
    const s = v.screen(a);
    this.warn = s.leaveWarn;
    if (tick) s.tick?.();
    const btn = (b: TBtn, cls: string, key: string) => {
      if (b.key && !b.off) this.keyed.set(b.key, b.act);
      return `<button class="${cls}${b.on ? ' on' : ''}${b.tone ? ` tone-${b.tone}` : ''}" data-k="${esc(key)}" ${a(b.act)}${b.off ? ' disabled' : ''}><span>${esc(b.text)}</span>${b.sub ? `<em>${esc(b.sub)}</em>` : ''}${b.price ? `<b>${esc(b.price)}</b>` : ''}</button>`;
    };
    // A slider with − and + either side of it (a step each) and its value boxed beside it.
    const slider = (sl: TSlider) => {
      this.sliders.push(sl);
      const k = this.sliders.length - 1;
      const nudge = (d: number) => a(() => sl.set(Math.max(sl.min, Math.min(sl.max, sl.value + d * sl.step))));
      return `<div class="tr-slider"><b class="tr-sv">${esc(sl.label(sl.value))}</b><button class="tr-step" ${nudge(-1)}>−</button><input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}" value="${sl.value}" data-in="${k}"><button class="tr-step" ${nudge(1)}>+</button></div>`;
    };
    const group = (g: TableScreen['groups'][number]) => `<div class="tr-group${g.size ? ' size' : ''}"><div class="tr-gname">${esc(g.name)}</div>${g.btns.length ? `<div class="tr-btns${g.chips ? ' chips' : ''}">${g.btns.map((b, i) => btn(b, 'tr-btn', `${g.name}/${i}`)).join('')}</div>` : ''}${g.slider ? slider(g.slider) : ''}</div>`;
    const armed = performance.now() < this.leaveArmed && s.leaveWarn;
    // The foot: the other choices on the left; the moves, big, and the bet sizing beside them on the
    // right. (The action bar's moves aren't picked for you: Enter mustn't fold a hand by accident.)
    const moves = s.bar ? s.bar.map((b, i) => btn(b, 'tr-act', `bar/${i}`)).join('') : s.primary ? btn(s.primary, `tr-act tone-${s.primary.tone ?? 'go'}`, 'primary') : '';
    const side = `<div class="tr-aux">${s.groups.filter((g) => !g.size).map(group).join('')}</div>
      <div class="tr-main"><div class="tr-bar">${moves}</div>${s.groups.filter((g) => g.size).map(group).join('')}</div>`;
    const top = `<div class="tr-title"><h2>${esc(s.title)}</h2><span>${esc(s.sub)}</span></div><div class="tr-money">${esc(s.money)}</div>
      ${btn({ text: armed ? `${s.leaveWarn}. Again to leave` : 'Leave table', act: () => this.tryLeave(s.leaveWarn) }, `tr-leave${armed ? ' armed' : ''}`, 'leave')}`;
    if (s.felt !== this.felt) { this.felt = s.felt; this.root.querySelector('.tr-felt')!.innerHTML = s.felt; }
    if (side !== this.side && !this.dragging) { this.side = side; this.root.querySelector('.tr-side')!.innerHTML = side; }
    if (top !== this.top) { this.top = top; this.root.querySelector('.tr-top')!.innerHTML = top; }
    // The hand history: the last few lines over the table's foot, or all of it opened up.
    const lines = this.history ? s.log : s.log.slice(-3);
    const log = lines.map((l) => `<div>${esc(l)}</div>`).join('');
    const logEl = this.root.querySelector<HTMLElement>('.tr-log')!;
    logEl.classList.toggle('open', this.history);
    if (logEl.innerHTML !== log) { logEl.innerHTML = log; logEl.scrollTop = logEl.scrollHeight; }
    this.float(s.cash);
    this.mark();
  }

  /** What a round won or cost floats up over the table. */
  private float(cash: number): void {
    if (this.cash !== null && cash !== this.cash) {
      const d = cash - this.cash;
      const el = document.createElement('div');
      el.className = `tr-delta ${d > 0 ? 'up' : 'down'}`;
      el.textContent = `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`;
      this.root.querySelector('.tr-float')!.append(el);
      setTimeout(() => el.remove(), 1800);
    }
    this.cash = cash;
  }

  nav(c: NavCmd): void {
    if (c === 'back') { this.back(); return; }
    const list = this.choices();
    if (!list.length) return;
    let i = Math.max(0, list.findIndex((b) => b.dataset.k === this.focus));
    if (c === 'ok') { list[i]?.click(); return; }
    if (c === 'up' || c === 'left') i = (i - 1 + list.length) % list.length;
    else if (c === 'down' || c === 'right') i = (i + 1) % list.length;
    else return;
    this.focus = list[i].dataset.k ?? '';
    this.auto = false;
    this.mark();
  }

  /** The buttons you can move between (the side's), the main move picked first. */
  private choices(): HTMLButtonElement[] {
    return [...this.root.querySelectorAll<HTMLButtonElement>('.tr-side [data-a]:not([disabled]), .tr-top [data-a]:not([disabled])')];
  }

  private mark(): void {
    const list = this.choices();
    // Unless you've moved the pick yourself it rests on the main move (when there is one to make).
    // (With an action bar instead of a main move, nothing until you pick it yourself.)
    const main = list.find((b) => b.dataset.k === 'primary')?.dataset.k;
    if (this.auto) this.focus = main ?? '';
    else if (!list.some((b) => b.dataset.k === this.focus)) this.focus = main ?? list[0]?.dataset.k ?? '';
    for (const b of this.root.querySelectorAll<HTMLElement>('.tr-side [data-a], .tr-top [data-a]')) b.classList.toggle('kf', b.dataset.k === this.focus);
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.matches?.('input')) return;
    // A move's own key (F fold, C call, Space spin...) first; then picking and pressing.
    const own = this.keyed.get(e.code);
    if (own && !e.repeat) { e.preventDefault(); e.stopPropagation(); own(); this.refresh(); return; }
    const map: Record<string, NavCmd> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', KeyE: 'ok', Space: 'ok', Backspace: 'back' };
    const c = map[e.code];
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) this.nav(c);
  }

  private async blackout(during: () => void): Promise<void> {
    this.fade.classList.add('on');
    await new Promise((r) => setTimeout(r, FADE_MS));
    during();
    await new Promise((r) => setTimeout(r, 60));
    this.fade.classList.remove('on');
  }
}
