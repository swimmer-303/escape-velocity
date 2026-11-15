// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Music: AI-generated chiptune tracks (Higgsfield, ElevenLabs Music; credited in ASSETS.md and Credits).
// Sound effects: tiny procedural square-wave blips made with the Web Audio API.
// Settings (src/ui/settings.ts): a master mute (the HUD speaker button), and Music and Sound effects, each with its own
// on/off and volume. Every music track goes through playMusic, so Music off silences all of them.

type Track = 'title' | 'mission' | 'launch';
const SRC: Record<Track, string> = {
  title: '/audio/music-title.mp3',
  mission: '/audio/music-mission.mp3',
  launch: '/audio/jingle-launch.mp3',
};

export type Sfx =
  | 'place'
  | 'remove'
  | 'deny'
  | 'click'
  | 'run'
  | 'storm'
  | 'good'
  | 'bad'
  | 'win'
  | 'alarm'
  // Game feel (src/ui/juice.ts): a cell popping into place, a count-up tick, the shelter's clang, good-news sparkle,
  // a streak chime, the title's music hit, and a whoosh for big moments.
  | 'pop'
  | 'tick'
  | 'clang'
  | 'sparkle'
  | 'streak'
  | 'slam'
  | 'whoosh';

/** One note: frequency (Hz), length (s), wave, and whether the next note starts with it (a chord) instead of after it. */
type Note = [number, number, OscillatorType?, boolean?];

/** Music and sound effects, each on or off with a volume from 0 to 100 (percent, the Settings sliders). */
export interface SoundMix {
  music: boolean;
  musicVolume: number;
  sfx: boolean;
  sfxVolume: number;
}

/**
 * The slider position that plays music and effects exactly as loud as the game did before it had sliders, so
 * nobody's game gets louder or quieter by itself. 100 is a bit louder than that.
 */
export const NORMAL_VOLUME = 60;
export const SOUND_DEFAULTS: SoundMix = { music: true, musicVolume: NORMAL_VOLUME, sfx: true, sfxVolume: NORMAL_VOLUME };

/** A stored volume, made safe: a whole number from 0 to 100 (anything else gives the normal volume). */
export function cleanVolume(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : NORMAL_VOLUME;
}

export class GameAudio {
  /** The master mute (the HUD speaker button): silences music and effects alike. */
  masterMuted = false;
  private mix: SoundMix = { ...SOUND_DEFAULTS };
  private ctx?: AudioContext;
  private music?: HTMLAudioElement;
  private current?: Track;
  private unlocked = false;
  /** Music plays quieter while the read-aloud voice speaks. */
  private ducked = false;

  constructor(muted: boolean, mix: Partial<SoundMix> = {}) {
    this.masterMuted = muted;
    this.mix = {
      music: typeof mix.music === 'boolean' ? mix.music : true,
      musicVolume: cleanVolume(mix.musicVolume ?? NORMAL_VOLUME),
      sfx: typeof mix.sfx === 'boolean' ? mix.sfx : true,
      sfxVolume: cleanVolume(mix.sfxVolume ?? NORMAL_VOLUME),
    };
    const unlock = () => {
      this.unlockNow();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /**
   * True when sound effects can't be heard: the master mute, Sound effects off, or its volume at 0. The meta
   * features' own sounds (the rover's motor hum, the rocket's engine rumble) check this too.
   */
  get muted(): boolean {
    return this.masterMuted || !this.mix.sfx || this.mix.sfxVolume <= 0;
  }

  /** True when music may play: the master mute is off and Music is on. */
  get musicOn(): boolean {
    return !this.masterMuted && this.mix.music;
  }

  /** True once the player has pressed something (browsers allow sound from then on) and effects can be heard. */
  get ready(): boolean {
    return this.unlocked && !this.muted;
  }

  /** The player pressed something: music may start now (the cold open calls this from its own key handler). */
  unlockNow() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.current && this.musicOn) this.playMusic(this.current, true);
  }

  /** The master mute (the HUD speaker button). */
  setMuted(m: boolean) {
    this.masterMuted = m;
    this.syncMusic();
  }

  /** Music on or off: off pauses whatever track is playing (title, mission, launch jingle, a mini-game's music). */
  setMusic(on: boolean) {
    this.mix.music = on;
    this.syncMusic();
  }

  /** Music volume, 0-100: the playing track changes right away. */
  setMusicVolume(v: number) {
    this.mix.musicVolume = cleanVolume(v);
    if (this.music && this.current) this.music.volume = this.volumeFor(this.current);
  }

  setSfx(on: boolean) {
    this.mix.sfx = on;
  }

  /** Sound effects volume, 0-100. */
  setSfxVolume(v: number) {
    this.mix.sfxVolume = cleanVolume(v);
  }

  /** The current mix (a copy). */
  get levels(): SoundMix {
    return { ...this.mix };
  }

  private syncMusic() {
    if (!this.musicOn) this.music?.pause();
    else if (this.current) this.playMusic(this.current, true);
  }

  /** Quieter music while the read-aloud voice speaks, so the words are easy to hear. */
  duck(on: boolean) {
    this.ducked = on;
    if (this.music && this.current) this.music.volume = this.volumeFor(this.current);
  }

  private volumeFor(track: Track) {
    const base = (track === 'launch' ? 0.6 : 0.35) * (this.mix.musicVolume / NORMAL_VOLUME);
    return Math.min(1, base) * (this.ducked ? 0.3 : 1);
  }

  /** Stop the music (Mission Control student screens stay quiet: the projector plays it). */
  stopMusic() {
    this.current = undefined;
    this.music?.pause();
  }

  playMusic(track: Track, force = false) {
    if (this.current === track && !force && this.music && !this.music.paused) return;
    this.current = track;
    if (!this.unlocked || !this.musicOn) return;
    if (!this.music || !this.music.src.endsWith(SRC[track])) {
      this.music?.pause();
      this.music = new window.Audio(SRC[track]);
      this.music.loop = track !== 'launch';
    }
    this.music.volume = this.volumeFor(track);
    this.music.play().catch(() => {
      /* the browser may block autoplay until a tap: that's fine */
    });
  }

  /** Play a sound effect. `pitch` multiplies every note (1 = as written): placing cells in a row climbs the scale. */
  sfx(name: Sfx, pitch = 1) {
    // Before the first press the browser keeps sound off anyway, and making an AudioContext then only logs a warning.
    if (this.muted || !this.unlocked) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      // A context made before the first press starts paused: wake it (this works once the player has pressed something).
      if (ctx.state === 'suspended') void ctx.resume?.().catch(() => undefined);
      const notes: Record<Sfx, Note[]> = {
        place: [[660, 0.05], [990, 0.06]],
        remove: [[520, 0.05], [330, 0.06]],
        deny: [[140, 0.12, 'sawtooth']],
        click: [[880, 0.04]],
        run: [[440, 0.06], [660, 0.06], [880, 0.1]],
        storm: [[90, 0.25, 'sawtooth'], [70, 0.3, 'sawtooth']],
        good: [[523, 0.08], [659, 0.08], [784, 0.14]],
        bad: [[392, 0.1], [311, 0.18]],
        win: [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.3]],
        alarm: [[880, 0.12], [660, 0.12], [880, 0.12], [660, 0.12]],
        pop: [[620, 0.035], [930, 0.05, 'triangle']],
        tick: [[1320, 0.02, 'triangle']],
        clang: [[1180, 0.2, 'triangle', true], [1770, 0.16, 'triangle', true], [590, 0.26, 'square']],
        sparkle: [[1568, 0.05, 'triangle'], [2093, 0.05, 'triangle'], [2637, 0.1, 'triangle']],
        streak: [[523, 0.06], [659, 0.06], [784, 0.06], [1046, 0.16, 'triangle']],
        slam: [[55, 0.55, 'sawtooth', true], [110, 0.5, 'square', true], [262, 0.45, 'square', true], [392, 0.5, 'triangle']],
        whoosh: [[180, 0.12, 'sawtooth'], [320, 0.1, 'sawtooth'], [520, 0.14, 'triangle']],
      };
      let t = ctx.currentTime;
      const vol = (name === 'tick' ? 0.025 : name === 'slam' ? 0.08 : 0.06) * (this.mix.sfxVolume / NORMAL_VOLUME);
      for (const [freq, dur, type, chord] of notes[name]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type ?? 'square';
        o.frequency.value = freq * pitch;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(Math.min(0.0008, vol * 0.05), t + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + dur);
        if (!chord) t += dur * 0.9;
      }
    } catch {
      /* no audio available */
    }
  }
}
