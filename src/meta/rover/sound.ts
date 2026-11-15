// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Two quiet, made-in-code sounds for the drive: an electric motor hum that rises with speed, and a scanner sweep that
// climbs in pitch while Scan is held. Silent when the game's sound is off. stop() closes the audio context.

export interface SoundOwner {
  muted?: boolean;
}

export class RoverSound {
  private ctx?: AudioContext;
  private humGain?: GainNode;
  private humOsc?: OscillatorNode;
  private scanGain?: GainNode;
  private scanOsc?: OscillatorNode;
  private failed = false;

  constructor(private readonly owner: SoundOwner | null) {}

  private ready(): AudioContext | null {
    if (this.failed || !this.owner || this.owner.muted) return null;
    if (this.ctx) return this.ctx;
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!AC) {
        this.failed = true;
        return null;
      }
      const ctx = new AC();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      this.humOsc = ctx.createOscillator();
      this.humOsc.type = 'sawtooth';
      this.humOsc.frequency.value = 55;
      this.humGain = ctx.createGain();
      this.humGain.gain.value = 0;
      this.humOsc.connect(filter).connect(this.humGain).connect(ctx.destination);
      this.humOsc.start();
      this.scanOsc = ctx.createOscillator();
      this.scanOsc.type = 'square';
      this.scanOsc.frequency.value = 300;
      this.scanGain = ctx.createGain();
      this.scanGain.gain.value = 0;
      this.scanOsc.connect(this.scanGain).connect(ctx.destination);
      this.scanOsc.start();
      this.ctx = ctx;
      return ctx;
    } catch {
      this.failed = true;
      return null;
    }
  }

  /** Motor hum: 0 (stopped) .. 1 (top speed); `boost` adds a higher whine. */
  motor(level: number, boost: boolean) {
    const ctx = level > 0.02 ? this.ready() : this.ctx;
    if (!ctx || !this.humGain || !this.humOsc) return;
    const muted = !!this.owner?.muted;
    const l = muted ? 0 : Math.max(0, Math.min(1, level));
    this.humGain.gain.setTargetAtTime(l * 0.05, ctx.currentTime, 0.08);
    this.humOsc.frequency.setTargetAtTime(50 + l * (boost ? 130 : 80), ctx.currentTime, 0.1);
  }

  /** Scanner: progress 0..1 while scanning, or null to stop. */
  scan(progress: number | null) {
    const ctx = progress !== null ? this.ready() : this.ctx;
    if (!ctx || !this.scanGain || !this.scanOsc) return;
    const on = progress !== null && !this.owner?.muted;
    this.scanGain.gain.setTargetAtTime(on ? 0.025 : 0, ctx.currentTime, 0.03);
    if (on) this.scanOsc.frequency.setTargetAtTime(300 + progress! * 900, ctx.currentTime, 0.03);
  }

  stop() {
    try {
      this.humOsc?.stop();
      this.scanOsc?.stop();
    } catch {
      /* already stopped */
    }
    try {
      void this.ctx?.close();
    } catch {
      /* nothing to close */
    }
    this.ctx = undefined;
  }
}
