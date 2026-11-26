// Lobby screen (universe, character, create/join, open rooms), then hands the connection to the
// game. Loaded by the boot (main.ts) once the universe is installed.
import { MODES, RULES, UNIVERSE } from '../shared/packs';
import type { RoomListing } from '../shared/protocol';
import { isUniverse, UNIVERSE_INFO } from '../universes';
import { UNIVERSE_KEY } from './assets';
import { Game } from './game/game';
import { CharacterPicker } from './lobby/characters';
import { Connection } from './net/connection';
import { loadModels } from './render/models';

// The Blender-built vehicles and weapons load while you're in the lobby.
const modelsReady = loadModels();

const $ =<T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeInput = $<HTMLInputElement>('code');
const errorEl = $('lobby-error');
const lobby = $('lobby');
const loading = $('loading');
$('sub').textContent = `${UNIVERSE.name} · up to ${RULES.maxPlayers} players`;
loading.textContent = `Loading ${UNIVERSE.name}…`;

/** Plays in another universe: its packs load with the page, so remember it and reload. */
function switchUniverse(id: string, note?: string, room?: string): void {
  localStorage.setItem(UNIVERSE_KEY, id);
  if (note) sessionStorage.setItem(NOTE_KEY, note);
  // Always a real reload: with a room code after '#' (an invite link, or back from a game) the
  // browser would only "navigate" within the page and nothing would change. The old code goes
  // (it's a room in the other universe), unless `room` is the one to join over there.
  const url = new URL(location.href);
  if (url.searchParams.has('u')) url.searchParams.delete('u');
  history.replaceState(null, '', url.pathname + url.search + (room ? `#${room}` : ''));
  location.reload();
}
const NOTE_KEY = 'gridlock.lobbyNote';

// Universe picker: only when this build has more than one.
if (UNIVERSE_INFO.length > 1) {
  const sel = $<HTMLSelectElement>('universe');
  for (const u of UNIVERSE_INFO) {
    const o = document.createElement('option');
    o.value = u.id;
    o.textContent = u.name;
    sel.appendChild(o);
  }
  sel.value = UNIVERSE.id;
  $('universe-row').hidden = false;
  const blurb = $('universe-blurb');
  blurb.hidden = false;
  blurb.textContent = UNIVERSE.blurb;
  sel.addEventListener('change', () => switchUniverse(sel.value));
}

const picker = new CharacterPicker($('chars'));
picker.onMode = (creating) => {
  $('play').hidden = creating;
  document.querySelector('.lobby-card')?.classList.toggle('wide', creating);
  errorEl.textContent = '';
  showContinue();
};

/** "Continue in CODE": back into the selected character's last game (reopened if it's empty). */
function showContinue(): void {
  const room = picker.selected?.last?.room;
  const btn = $<HTMLButtonElement>('continue');
  btn.hidden = !room;
  if (room) btn.textContent = `Continue in ${room}`;
}
/** ?play=Name joins as an unsaved guest (dev and testing). */
const guest = new URLSearchParams(location.search).get('play');

// Game mode picker (used when creating a room).
const modeSelect = $<HTMLSelectElement>('mode');
const modeBlurb = $('mode-blurb');
for (const m of MODES) {
  const o = document.createElement('option');
  o.value = m.id;
  o.textContent = m.name;
  modeSelect.appendChild(o);
}
const showBlurb = () => { modeBlurb.textContent = MODES.find((m) => m.id === modeSelect.value)?.blurb ?? ''; };
modeSelect.addEventListener('change', showBlurb);
showBlurb();
const hashCode = location.hash.replace('#', '').toUpperCase();
if (/^[A-Z]{4}$/.test(hashCode)) codeInput.value = hashCode;

let busy = false;

function start(create: boolean, room: string, resume = false): void {
  const ch = picker.selected;
  const name = guest ?? ch?.name ?? '';
  if (!name) { errorEl.textContent = 'Create a character first.'; return; }
  if (!create && !/^[A-Z]{4}$/.test(room)) { errorEl.textContent = 'Room codes are 4 letters.'; codeInput.focus(); return; }
  if (busy) return;
  busy = true;
  errorEl.textContent = '';
  const conn = new Connection(guest ?? ch!, room, create, modeSelect.value, resume);
  let started = false;
  conn.onClose = (reason) => {
    busy = false;
    if (started) { alert(reason); location.reload(); return; }
    errorEl.textContent = reason;
  };
  const off = conn.on((m) => {
    if (m.t === 'reject') {
      busy = false; conn.close(); off();
      // The room is a game in another universe: switch to it (the code stays in the address).
      if (m.universe && m.universe !== UNIVERSE.id && isUniverse(m.universe) && /^[A-Z]{4}$/.test(room)) {
        switchUniverse(m.universe, `${room} is a game in ${UNIVERSE_INFO.find((u) => u.id === m.universe)?.name ?? m.universe}: pick a character there and join.`, room);
        return;
      }
      errorEl.textContent = m.reason;
    }
    if (m.t === 'welcome') {
      started = true;
      off();
      history.replaceState(null, '', `#${m.room}`);
      lobby.hidden = true;
      loading.hidden = false;
      // Let the loading screen paint before the city builds (and the models have arrived).
      void modelsReady.then(() => setTimeout(() => {
        const game = new Game(conn, m.id, m.room, m.seed, () => { location.hash = ''; location.reload(); });
        game.setVoice(guest ? undefined : ch?.voice);
        (window as unknown as { __game: Game }).__game = game; // dev/debug hook
        // The loading screen stays up until the first snapshot arrives (Game hides it).
      }, 30));
    }
  });
}

$('create').addEventListener('click', () => start(true, ''));
$('continue').addEventListener('click', () => { const room = picker.selected?.last?.room; if (room) start(false, room, true); });
showContinue();
$('join').addEventListener('click', () => start(false, codeInput.value.trim().toUpperCase()));
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(false, codeInput.value.trim().toUpperCase()); });

async function refreshRooms(): Promise<void> {
  if (lobby.hidden) return;
  try {
    const list = (await (await fetch('/api/rooms')).json()) as RoomListing[];
    const box = $('rooms');
    box.innerHTML = '';
    for (const r of list.filter((l) => l.universe === UNIVERSE.id)) {
      const row = document.createElement('div');
      row.className = 'room';
      row.innerHTML = `<div><b></b> <span></span></div>`;
      row.querySelector('b')!.textContent = r.code;
      row.querySelector('span')!.textContent = `${r.players}/${r.max} · ${r.names.join(', ')}`;
      const btn = document.createElement('button');
      btn.textContent = 'Join';
      btn.disabled = r.players >= r.max;
      btn.addEventListener('click', () => start(false, r.code));
      row.appendChild(btn);
      box.appendChild(row);
    }
  } catch { /* server not reachable yet */ }
}
// A note carried over a universe switch.
const note = sessionStorage.getItem(NOTE_KEY);
if (note) { errorEl.textContent = note; sessionStorage.removeItem(NOTE_KEY); }
// ?play=Name joins the room in the hash straight away (or creates one) as a guest.
if (guest) {
  if (/^[A-Z]{4}$/.test(codeInput.value)) start(false, codeInput.value); else start(true, '');
}
void refreshRooms();
setInterval(() => void refreshRooms(), 3000);
