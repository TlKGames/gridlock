// Phone calls: the cast and every conversation, built from the installed universe's call scripts
// (Universe.cast / .player, files under its content folder; see content/README.md). The engine only
// knows the situations: a first call, a job brief by kind, the job done or blown, busy, nothing on.
// Everything here is filled in place by installCalls (packs/index.ts installUniverse).
import type { CallSituation, PlayerSituation, Universe, VoiceFile } from './types';

export type { CallSituation, PlayerSituation };

/** A reference voice: a clip (path from the project root) and its Chatterbox settings. */
export interface Voice { model: string; ex: number; cfg: number }
const voiceOf = (dir: string, v: VoiceFile): Voice => ({ model: `${dir}/${v.model}`, ex: v.exaggeration, cfg: v.cfg });

export interface Caller {
  id: string; name: string; fullName: string; role: string; about: string;
  welcomeText?: string;
  /** The gang they speak for, if any. */
  crew?: string;
  /** Their folder, from the project root. */
  dir: string;
  /** None yet: their lines are shown, not spoken. */
  voice?: Voice;
}

/** A turn, ready to play: the caller's line (with its clip id; a gendered line's clip is
 *  `<clip>_male` / `_female`), or yours (its clip is youLineId(your voice, key)). */
export type Turn =
  | { by: 'caller'; text: string | { male: string; female: string }; clip: string; tone: string }
  | { by: 'you'; key: string; text: string; tone: string };

const text = (lines: string[]) => lines.join('\n');

/** You, as a speaker in a call's parts (`[YOU, situation, n]`: the n-th of your `says` lines). */
export const YOU = 'you';

/** Your lines by key (player.json). */
export const PLAYER_LINES: Record<string, { text: string; tone: string }> = {};
/** Your lines by situation, as keys of PLAYER_LINES. */
export const PLAYER_SAYS = {} as Record<PlayerSituation, string[]>;
export const CALLERS: Caller[] = [];
/** Each caller's exchanges by situation (one is picked at random each time). A caller line's clip
 *  is the turn's own `clip` name, or else `<caller>_<situation>_<exchange>_<n>`, n counting only
 *  the caller's turns. */
export const CALLS: Record<string, Partial<Record<CallSituation, Turn[][]>>> = {};
/** Who picks up a gang's phone: the boss first, then whoever else takes its calls. */
export const GANG_CALLERS: Record<string, string[]> = {};
/** People (not gangs) whose number you get once you've talked to them (marked "contact"). */
export const PEOPLE_CONTACTS: string[] = [];
/** The voices a player's character can have (picked in the character creator). */
export const PLAYER_VOICES: { id: string; name: string; who: 'man' | 'woman'; about: string; voice: Voice }[] = [];
/** Who rings a newcomer's cell to welcome them to town (the character marked "welcome"). */
export let WELCOME_CALLER: string | undefined;
/** Who rings you about a job for a crew that doesn't trust you with its number yet (the
 *  character marked "mentor"), when they have something to say about it. */
export const MENTOR_REMINDER_DISMISSED = 'phone:mentor-reminder-dismissed';
export let MENTOR_CALLER: string | undefined;
export let DEFAULT_VOICE = '';
/** The line you say as a demo in the character creator. */
export let VOICE_SAMPLE = '';

/** A recording's clip id from the name a character's file gives it: their id in front, so names
 *  only have to be unique per character (`do_better` → `benny_do_better`). */
export const namedClip = (caller: string, name: string): string => (name.startsWith(`${caller}_`) ? name : `${caller}_${name}`);

const clear = (o: Record<string, unknown>) => { for (const k of Object.keys(o)) delete o[k]; };

export function installCalls(u: Universe): void {
  const P = u.player;
  clear(PLAYER_LINES); clear(PLAYER_SAYS); clear(CALLS); clear(GANG_CALLERS);
  CALLERS.length = 0; PEOPLE_CONTACTS.length = 0; PLAYER_VOICES.length = 0;
  for (const [k, l] of Object.entries(P.lines)) PLAYER_LINES[k] = { text: text(l.say), tone: l.tone ?? '' };
  Object.assign(PLAYER_SAYS, P.says);
  for (const [s, keys] of Object.entries(PLAYER_SAYS)) {
    for (const k of keys) if (!PLAYER_LINES[k]) throw new Error(`player.json: says.${s} points at "${k}", which isn't in its lines`);
  }
  for (const [folder, c] of u.cast) {
    const dir = `${u.contentDir}/characters/${folder}`;
    CALLERS.push({ id: c.id, name: c.name, fullName: c.fullName, role: c.role, about: c.about, crew: c.crew, welcomeText: c.welcomeText, dir, voice: c.voice && voiceOf(dir, c.voice) });
    CALLS[c.id] = Object.fromEntries(Object.entries(c.calls).map(([situation, exchanges]) => [situation, exchanges!.map((turns, x) => {
      let n = 0;
      return turns.map((t): Turn => {
        if (t.you) {
          const mine = PLAYER_LINES[t.you];
          if (!mine) throw new Error(`${folder}: ${situation} points at your line "${t.you}", which player.json doesn't have`);
          return { by: 'you', key: t.you, text: mine.text, tone: mine.tone };
        }
        const clip = t.clip ? namedClip(c.id, t.clip) : `${c.id}_${situation}_${x}_${n}`;
        n++;
        if (t.male && t.female) return { by: 'caller', text: { male: text(t.male), female: text(t.female) }, clip, tone: t.tone ?? '' };
        if (!t.say) throw new Error(`${folder}: a ${situation} turn has no "say", "male"/"female" or "you"`);
        return { by: 'caller', text: text(t.say), clip, tone: t.tone ?? '' };
      });
    })]));
  }
  for (const [, c] of [...u.cast].sort(([, a], [, b]) => Number(!!b.boss) - Number(!!a.boss))) {
    if (c.crew) (GANG_CALLERS[c.crew] ??= []).push(c.id);
  }
  WELCOME_CALLER = u.cast.find(([, c]) => c.welcome)?.[1].id;
  MENTOR_CALLER = u.cast.find(([, c]) => c.mentor)?.[1].id;
  PEOPLE_CONTACTS.push(...u.cast.filter(([, c]) => c.contact).map(([, c]) => c.id));
  PLAYER_VOICES.push(...P.voices.map((v) => ({ id: v.id, name: v.name, who: v.who, about: v.about, voice: voiceOf(`${u.contentDir}/player`, v) })));
  DEFAULT_VOICE = P.default;
  VOICE_SAMPLE = PLAYER_LINES.sample?.text ?? '';
}

/** Whether callers talk to you as a man or a woman: by your character's voice. */
export const genderOf = (voice: string): 'male' | 'female' =>
  PLAYER_VOICES.find((p) => p.id === voice)?.who === 'woman' ? 'female' : 'male';

/** A voice id from a save, or the default. */
export const cleanVoice = (v: unknown): string => (PLAYER_VOICES.some((p) => p.id === v) ? String(v) : DEFAULT_VOICE);

/** The clip of one of your lines in one of the voices. */
export const youLineId = (voice: string, key: string): string => `you_${voice}_${key}`;
