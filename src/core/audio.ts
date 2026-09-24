// Synthesized sound effects (WebAudio). No audio assets.
//
// sfx.play("coin") for named sounds, or sfx.tone()/sfx.noise() for custom ones.
// The AudioContext is created lazily; main.ts calls sfx.unlock() on the first user gesture.

export type SfxName =
  | "coin"
  | "jump"
  | "stomp"
  | "bump"
  | "die"
  | "powerup"
  | "levelclear"
  | "crash"
  | "glitch"
  | "key"
  | "click"
  | "error"
  | "success"
  | "alert"
  | "blip"
  | "launch"
  | "whoosh"
  | "capture";

export interface ToneOpts {
  freq: number;
  /** If set, frequency slides exponentially to this value over the duration. */
  freq2?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  /** Seconds from now. */
  delay?: number;
  attack?: number;
}

export interface NoiseOpts {
  dur: number;
  vol?: number;
  delay?: number;
  /** Bandpass center frequency; slides to filter2 if given. */
  filter?: number;
  filter2?: number;
  q?: number;
}

const MUTE_KEY = "dario-brothers-muted";

class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // ignore
    }
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      // ignore
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Destination node for stage-owned audio (e.g. music) so it respects mute. */
  get output(): AudioNode | null {
    return this.master;
  }

  tone(o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? "square";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freq2), t0 + o.dur);
    const vol = o.vol ?? 0.15;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const g = ctx.createGain();
    const vol = o.vol ?? 0.1;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = o.q ?? 1;
      f.frequency.setValueAtTime(o.filter, t0);
      if (o.filter2) f.frequency.exponentialRampToValueAtTime(o.filter2, t0 + o.dur);
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.dur + 0.02);
  }

  /** Play a named effect. Rapid repeats of the same effect are rate-limited. */
  play(name: SfxName, opts: { minGapMs?: number } = {}): void {
    if (!this.ctx) return;
    const now = performance.now();
    const gap = opts.minGapMs ?? (name === "coin" ? 35 : name === "key" ? 25 : 0);
    if (gap > 0) {
      const last = this.lastPlayed.get(name) ?? 0;
      if (now - last < gap) return;
    }
    this.lastPlayed.set(name, now);

    switch (name) {
      case "coin":
        this.tone({ freq: 988, dur: 0.07, vol: 0.09 });
        this.tone({ freq: 1319, dur: 0.28, vol: 0.09, delay: 0.07 });
        break;
      case "jump":
        this.tone({ freq: 260, freq2: 620, dur: 0.16, vol: 0.08 });
        break;
      case "stomp":
        this.tone({ freq: 420, freq2: 90, dur: 0.12, type: "triangle", vol: 0.25 });
        this.noise({ dur: 0.06, vol: 0.08, filter: 1200 });
        break;
      case "bump":
        this.tone({ freq: 140, freq2: 90, dur: 0.09, type: "triangle", vol: 0.25 });
        break;
      case "die": {
        const notes = [494, 466, 440, 392, 330, 262, 196];
        notes.forEach((f, i) => this.tone({ freq: f, dur: 0.12, vol: 0.1, delay: i * 0.1 }));
        break;
      }
      case "powerup": {
        const notes = [392, 494, 587, 784, 988];
        notes.forEach((f, i) => this.tone({ freq: f, dur: 0.1, vol: 0.08, delay: i * 0.06 }));
        break;
      }
      case "levelclear": {
        const notes = [523, 659, 784, 1047, 784, 1047, 1319];
        notes.forEach((f, i) => this.tone({ freq: f, dur: 0.16, vol: 0.09, delay: i * 0.11 }));
        break;
      }
      case "crash":
        this.noise({ dur: 1.2, vol: 0.35, filter: 3000, filter2: 80, q: 0.7 });
        for (let i = 0; i < 14; i++) {
          this.tone({
            freq: 60 + Math.random() * 1800,
            dur: 0.05,
            type: Math.random() < 0.5 ? "sawtooth" : "square",
            vol: 0.12,
            delay: i * 0.045,
          });
        }
        break;
      case "glitch":
        for (let i = 0; i < 4; i++) {
          this.tone({ freq: 200 + Math.random() * 2400, dur: 0.03, type: "square", vol: 0.06, delay: i * 0.03 });
        }
        break;
      case "key":
        this.noise({ dur: 0.02, vol: 0.05, filter: 4000, q: 2 });
        break;
      case "click":
        this.tone({ freq: 1400, dur: 0.025, type: "square", vol: 0.05 });
        break;
      case "error":
        this.tone({ freq: 180, dur: 0.22, type: "sawtooth", vol: 0.1 });
        break;
      case "success":
        [660, 880, 1320].forEach((f, i) => this.tone({ freq: f, dur: 0.14, vol: 0.08, delay: i * 0.08 }));
        break;
      case "alert":
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 880, dur: 0.1, type: "square", vol: 0.08, delay: i * 0.24 });
          this.tone({ freq: 660, dur: 0.1, type: "square", vol: 0.08, delay: i * 0.24 + 0.12 });
        }
        break;
      case "blip":
        this.tone({ freq: 1000, dur: 0.04, type: "sine", vol: 0.08 });
        break;
      case "launch":
        this.noise({ dur: 1.6, vol: 0.25, filter: 200, filter2: 2400, q: 0.8 });
        this.tone({ freq: 60, freq2: 240, dur: 1.4, type: "sawtooth", vol: 0.05 });
        break;
      case "whoosh":
        this.noise({ dur: 0.5, vol: 0.15, filter: 600, filter2: 3000, q: 1.2 });
        break;
      case "capture":
        this.tone({ freq: 523, dur: 0.08, vol: 0.07 });
        this.tone({ freq: 784, dur: 0.12, vol: 0.07, delay: 0.06 });
        break;
    }
  }
}

export const sfx = new Sfx();
