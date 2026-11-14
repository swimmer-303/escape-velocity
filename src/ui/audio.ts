// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Music: AI-generated chiptune tracks (Higgsfield, ElevenLabs Music; credited in ASSETS.md and Credits).
// Sound effects: tiny procedural square-wave blips made with the Web Audio API.

type Track = 'title' | 'mission' | 'launch';
const SRC: Record<Track, string> = {
  title: '/audio/music-title.mp3',
  mission: '/audio/music-mission.mp3',
  launch: '/audio/jingle-launch.mp3',
};

export type Sfx = 'place' | 'remove' | 'deny' | 'click' | 'run' | 'storm' | 'good' | 'bad' | 'win' | 'alarm';

export class GameAudio {
  muted = false;
  private ctx?: AudioContext;
  private music?: HTMLAudioElement;
  private current?: Track;
  private unlocked = false;

  constructor(muted: boolean) {
    this.muted = muted;
    const unlock = () => {
      this.unlocked = true;
      if (this.current && !this.muted) this.playMusic(this.current, true);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.music?.pause();
    else if (this.current) this.playMusic(this.current, true);
  }

  playMusic(track: Track, force = false) {
    if (this.current === track && !force && this.music && !this.music.paused) return;
    this.current = track;
    if (!this.unlocked || this.muted) return;
    if (!this.music || !this.music.src.endsWith(SRC[track])) {
      this.music?.pause();
      this.music = new window.Audio(SRC[track]);
      this.music.loop = track !== 'launch';
      this.music.volume = track === 'launch' ? 0.6 : 0.35;
    }
    this.music.play().catch(() => {
      /* the browser may block autoplay until a tap: that's fine */
    });
  }

  sfx(name: Sfx) {
    if (this.muted) return;
    try {
      this.ctx ??= new AudioContext();
      const ctx = this.ctx;
      const notes: Record<Sfx, Array<[number, number, OscillatorType?]>> = {
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
      };
      let t = ctx.currentTime;
      for (const [freq, dur, type] of notes[name]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type ?? 'square';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + dur);
        t += dur * 0.9;
      }
    } catch {
      /* no audio available */
    }
  }
}
