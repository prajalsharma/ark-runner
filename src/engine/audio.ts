/**
 * Procedural audio — zero asset files. A small WebAudio synth: event blips, an engine
 * hum whose pitch tracks speed, and a dynamic music bed (a filtered pad + an arpeggio
 * that brightens and speeds with pace, and lifts an octave in Block Run). Must be
 * created/resumed inside a user gesture (Game does this on the run button). Presentation
 * only — never touches the deterministic sim.
 */
export type SfxEvent = "collect" | "nearmiss" | "perfect" | "blockstart" | "jump" | "slide" | "death" | "flip" | "flipbank" | "land" | "record";

const MUTE_KEY = "archrunner.muted.v1";
const readMuted = (): boolean => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } };
const writeMuted = (m: boolean): void => { try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* ephemeral */ } };

export class AudioManager {
  muted = readMuted();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private sustained: OscillatorNode[] = []; // hum + pad — stopped on dispose so nothing leaks
  private arpTimer = 0;
  private arpStep = 0;
  private arpSpeed = 0;   // 0..1 pace
  private arpBlock = false;

  resume(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // A limiter on the bus so stacked events never clip into that harsh "speaker-breaking"
    // distortion (WebAudio sums straight to the output with no headroom otherwise).
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 8; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);
    this.hum = ctx.createOscillator();
    this.hum.type = "sawtooth";
    this.hum.frequency.value = 55;
    this.hum.connect(this.humGain);
    this.hum.start();
    this.sustained.push(this.hum);

    // Music bed: two detuned triangles (A2 + E3) through a lowpass pad.
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.muted ? 0 : 0.05;
    this.musicGain.connect(this.master);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 500;
    this.padFilter.connect(this.musicGain);
    for (const f of [110, 164.81]) {
      const o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = f; o.connect(this.padFilter); o.start();
      this.sustained.push(o);
    }
  }

  suspend(): void { void this.ctx?.suspend(); }

  /** Tear everything down so no oscillator keeps droning after the run ends (the leaked
   *  engine hum + pad were stacking across runs into an eerie distorted noise that mute on
   *  the new instance couldn't stop). Call on game teardown. */
  dispose(): void {
    this.stopMusic();
    for (const o of this.sustained) { try { o.stop(); o.disconnect(); } catch { /* already stopped */ } }
    this.sustained = [];
    this.hum = null; this.humGain = null; this.musicGain = null; this.padFilter = null; this.master = null; this.limiter = null;
    const ctx = this.ctx; this.ctx = null;
    try { void ctx?.close(); } catch { /* best effort */ }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    writeMuted(m);
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
    if (this.musicGain) this.musicGain.gain.value = m ? 0 : 0.05;
  }
  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }

  /** Engine hum pitch + pad brightness track speed; a touch louder in a Block Run. */
  setDrive(speed: number, blockRun: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.hum?.frequency.setTargetAtTime(48 + speed * 2.1, t, 0.12);
    this.humGain?.gain.setTargetAtTime(this.muted ? 0 : blockRun ? 0.07 : 0.035, t, 0.12);
    const sf = Math.min(1, Math.max(0, (speed - 14) / (42 * 1.3 - 14)));
    this.padFilter?.frequency.setTargetAtTime(380 + sf * 1500 + (blockRun ? 900 : 0), t, 0.25);
    this.arpSpeed = sf; this.arpBlock = blockRun;
  }

  /** Start/stop the arpeggio (bound to an active run). */
  startMusic(): void {
    if (this.arpTimer || !this.ctx) return;
    this.arpStep = 0;
    this.arpTimer = window.setInterval(() => this.arpTick(), 150);
  }
  stopMusic(): void { if (this.arpTimer) { clearInterval(this.arpTimer); this.arpTimer = 0; } }

  private arpTick(): void {
    if (!this.ctx || this.muted || this.ctx.state !== "running") return;
    const scale = [220, 277.18, 329.63, 440, 554.37]; // A pentatonic
    const freq = scale[this.arpStep % scale.length]! * (this.arpBlock ? 2 : 1);
    this.tone(freq, 0.17, "triangle", 0.045 + this.arpSpeed * 0.045);
    this.arpStep++;
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

  // Coin pickups rise in pitch as a streak builds (resets between streaks) so repeats
  // stay satisfying instead of flat. A gentle chime, not a beep.
  private static COIN_SCALE = [880, 988, 1047, 1175, 1319, 1480, 1568, 1760];
  playCoin(streak: number): void {
    const f = AudioManager.COIN_SCALE[Math.min(Math.max(0, streak - 1), AudioManager.COIN_SCALE.length - 1)]!;
    this.tone(f, 0.08, "triangle", 0.2);
    this.tone(f * 2, 0.06, "sine", 0.08); // a little sparkle harmonic
  }

  /** A subtle rising tone as the Flow multiplier climbs — combo escalation. */
  playFlow(step: number): void { this.tone(360 + step * 55, 0.07, "sine", 0.1); }

  play(ev: SfxEvent): void {
    switch (ev) {
      case "collect": this.tone(880, 0.09, "triangle", 0.22); break;
      case "nearmiss": this.tone(320, 0.11, "sawtooth", 0.12); break;
      case "perfect": this.tone(1320, 0.09, "square", 0.18); this.tone(1760, 0.12, "square", 0.12); break;
      case "blockstart": this.tone(150, 0.28, "sawtooth", 0.3); this.tone(300, 0.3, "square", 0.16); break;
      case "jump": this.tone(520, 0.1, "sine", 0.18); break;
      case "slide": this.tone(230, 0.13, "sawtooth", 0.14); break;
      case "land": this.tone(140, 0.08, "sine", 0.16); break;
      case "death": this.tone(200, 0.45, "sawtooth", 0.32); this.tone(85, 0.5, "square", 0.28); break;
      case "flip": this.tone(440, 0.18, "square", 0.22); this.tone(660, 0.22, "square", 0.18); this.tone(880, 0.26, "square", 0.14); break;
      case "flipbank": this.tone(784, 0.1, "triangle", 0.26); this.tone(1047, 0.12, "triangle", 0.22); this.tone(1568, 0.16, "triangle", 0.18); break;
      case "record": [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.24), i * 90)); break;
    }
  }
}
