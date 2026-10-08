/**
 * Procedural audio — zero asset files. A small WebAudio synth: short tone blips
 * for events plus an engine hum whose pitch tracks speed. Must be created/resumed
 * inside a user gesture (autoplay policy); Game does this on the run button.
 * Audio is presentation only — it never touches the deterministic sim.
 */
export type SfxEvent = "collect" | "nearmiss" | "perfect" | "blockstart" | "jump" | "slide" | "death" | "flip" | "flipbank";

const MUTE_KEY = "archrunner.muted.v1";
const readMuted = (): boolean => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } };
const writeMuted = (m: boolean): void => { try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* ephemeral */ } };

export class AudioManager {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;

  /** Lazily build the graph on the first user gesture; safe to call repeatedly. */
  resume(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);
    this.hum = this.ctx.createOscillator();
    this.hum.type = "sawtooth";
    this.hum.frequency.value = 55;
    this.hum.connect(this.humGain);
    this.hum.start();
  }

  suspend(): void { void this.ctx?.suspend(); }

  setMuted(m: boolean): void {
    this.muted = m;
    writeMuted(m);
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }
  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }

  /** Engine hum: pitch rises with speed, a touch louder during a Block Run. */
  setDrive(speed: number, blockRun: boolean): void {
    if (!this.ctx || !this.hum || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.hum.frequency.setTargetAtTime(48 + speed * 2.1, t, 0.12);
    this.humGain.gain.setTargetAtTime(this.muted ? 0 : blockRun ? 0.07 : 0.035, t, 0.12);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(ev: SfxEvent): void {
    switch (ev) {
      case "collect": this.tone(880, 0.09, "triangle", 0.22); break;
      case "nearmiss": this.tone(320, 0.11, "sawtooth", 0.12); break;
      case "perfect": this.tone(1320, 0.09, "square", 0.18); this.tone(1760, 0.12, "square", 0.12); break;
      case "blockstart": this.tone(150, 0.28, "sawtooth", 0.3); this.tone(300, 0.3, "square", 0.16); break;
      case "jump": this.tone(520, 0.1, "sine", 0.18); break;
      case "slide": this.tone(230, 0.13, "sawtooth", 0.14); break;
      case "death": this.tone(200, 0.45, "sawtooth", 0.32); this.tone(85, 0.5, "square", 0.28); break;
      case "flip": this.tone(440, 0.18, "square", 0.22); this.tone(660, 0.22, "square", 0.18); this.tone(880, 0.26, "square", 0.14); break;
      case "flipbank": this.tone(784, 0.1, "triangle", 0.26); this.tone(1047, 0.12, "triangle", 0.22); this.tone(1568, 0.16, "triangle", 0.18); break;
    }
  }
}
