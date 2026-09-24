// A tiny original chiptune loop, scheduled with WebAudio lookahead.

import { sfx } from "../../core/audio";

// Eight bars of eighth notes. "." rest, "-" sustain previous note.
const MELODY = [
  "G4 C5 E5 G5 - E5 C5 .",
  "A4 D5 F5 A5 - F5 D5 .",
  "G4 C5 E5 G5 - A5 G5 E5",
  "F5 - D5 - B4 - G4 .",
  "G4 C5 E5 G5 - E5 C5 .",
  "A4 D5 F5 A5 - C6 A5 F5",
  "G5 - E5 - D5 - B4 -",
  "C5 - - . C5 . . .",
];

const BASS = [
  "C3 . G3 . C3 . G3 .",
  "D3 . A3 . D3 . A3 .",
  "C3 . G3 . C3 . G3 .",
  "G2 . D3 . G2 . B2 .",
  "C3 . G3 . C3 . G3 .",
  "F3 . C4 . F3 . C4 .",
  "G2 . D3 . G2 . D3 .",
  "C3 . G3 . C3 . . .",
];

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function freqOf(note: string): number {
  const m = /^([A-G])(#?)(\d)$/.exec(note);
  if (!m) return 0;
  const midi = 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] ? 1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Step {
  freq: number;
  /** Length in steps (1 + following sustains). */
  len: number;
}

function parse(bars: string[]): (Step | null)[] {
  const tokens = bars.join(" ").split(/\s+/);
  const out: (Step | null)[] = [];
  tokens.forEach((tok, i) => {
    if (tok === "." || tok === "-") {
      out.push(null);
      return;
    }
    let len = 1;
    while (tokens[i + len] === "-") len++;
    out.push({ freq: freqOf(tok), len });
  });
  return out;
}

const MEL = parse(MELODY);
const BAS = parse(BASS);

class Music {
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  private gain: GainNode | null = null;
  tempo = 1;
  playing = false;

  start(tempo = 1): void {
    this.tempo = tempo;
    const ctx = sfx.ctx;
    if (!ctx || !sfx.output) return;
    if (this.playing) return;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.55;
    this.gain.connect(sfx.output);
    this.playing = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const ctx = sfx.ctx;
    if (ctx && this.gain) {
      const g = this.gain;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => g.disconnect(), 400);
    }
    this.gain = null;
  }

  /** Tape-stop style pitch dive, then silence. */
  crash(): void {
    const ctx = sfx.ctx;
    if (ctx && this.gain && this.playing) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(520, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.9);
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      o.connect(g).connect(this.gain);
      o.start();
      o.stop(ctx.currentTime + 1);
    }
    this.playing = false;
    clearInterval(this.timer);
    const gn = this.gain;
    this.gain = null;
    setTimeout(() => gn?.disconnect(), 1200);
  }

  private schedule(): void {
    const ctx = sfx.ctx;
    if (!ctx || !this.gain) return;
    const stepDur = 0.2 / this.tempo;
    while (this.nextTime < ctx.currentTime + 0.15) {
      const i = this.step % MEL.length;
      const m = MEL[i];
      const b = BAS[i % BAS.length];
      if (m) this.voice(m.freq, this.nextTime, m.len * stepDur * 0.92, "square", 0.045);
      if (b) this.voice(b.freq, this.nextTime, stepDur * 1.6, "triangle", 0.13);
      if (i % 2 === 1) this.hat(this.nextTime);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private voice(freq: number, t: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = sfx.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.gain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hat(t: number): void {
    const ctx = sfx.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(this.gain!);
    src.start(t);
  }
}

export const music = new Music();
