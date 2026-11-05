// Synthesized sound effects (no audio files) plus EVA-style voice lines via speech synthesis.
import { dist } from './core/math';

type Recipe = (ctx: AudioContext, out: GainNode, t: number) => void;

function noise(ctx: AudioContext, dur: number) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function burst(ctx: AudioContext, out: GainNode, t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const n = noise(ctx, dur);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(f).connect(g).connect(out);
  n.start(t);
  n.stop(t + dur);
}

function tone(ctx: AudioContext, out: GainNode, t: number, dur: number, f0: number, f1: number, gain: number, type: OscillatorType = 'sine') {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur);
}

const RECIPES: Record<string, Recipe> = {
  rifle: (c, o, t) => burst(c, o, t, 0.08, 1800, 1.2, 0.35),
  mg: (c, o, t) => {
    burst(c, o, t, 0.07, 1200, 1, 0.4);
    tone(c, o, t, 0.05, 300, 80, 0.2, 'square');
  },
  gatling: (c, o, t) => burst(c, o, t, 0.05, 2600, 2, 0.25, 'highpass'),
  sniper: (c, o, t) => {
    burst(c, o, t, 0.25, 900, 0.8, 0.6);
    tone(c, o, t, 0.2, 600, 100, 0.3, 'sawtooth');
  },
  cannon: (c, o, t) => {
    burst(c, o, t, 0.3, 300, 0.8, 0.9, 'lowpass');
    tone(c, o, t, 0.25, 160, 40, 0.7, 'sine');
  },
  artillery: (c, o, t) => {
    burst(c, o, t, 0.5, 200, 0.8, 1.0, 'lowpass');
    tone(c, o, t, 0.4, 120, 30, 0.9, 'sine');
  },
  rocket: (c, o, t) => burst(c, o, t, 0.45, 700, 0.6, 0.4),
  missile: (c, o, t) => burst(c, o, t, 0.8, 500, 0.5, 0.6),
  laser: (c, o, t) => tone(c, o, t, 0.18, 1800, 400, 0.25, 'sawtooth'),
  hack: (c, o, t) => {
    tone(c, o, t, 0.1, 800, 1600, 0.15, 'square');
    tone(c, o, t + 0.12, 0.1, 1200, 2400, 0.15, 'square');
  },
  flame: (c, o, t) => burst(c, o, t, 0.3, 400, 0.4, 0.3, 'lowpass'),
  spray: (c, o, t) => burst(c, o, t, 0.3, 3000, 0.6, 0.15, 'highpass'),
  hit: (c, o, t) => burst(c, o, t, 0.12, 900, 0.7, 0.4),
  explosion: (c, o, t) => {
    burst(c, o, t, 0.6, 250, 0.5, 1.0, 'lowpass');
    tone(c, o, t, 0.5, 90, 30, 0.9);
  },
  explosion_big: (c, o, t) => {
    burst(c, o, t, 1.4, 180, 0.5, 1.3, 'lowpass');
    tone(c, o, t, 1.0, 70, 25, 1.2);
  },
  nuke: (c, o, t) => {
    burst(c, o, t, 3.0, 120, 0.4, 1.5, 'lowpass');
    tone(c, o, t, 2.5, 60, 20, 1.5);
    tone(c, o, t + 0.1, 1.2, 2000, 200, 0.3, 'sawtooth');
  },
  siren: (c, o, t) => {
    for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.5, 0.5, 500, 900, 0.25, 'triangle');
  },
  lance: (c, o, t) => {
    tone(c, o, t, 2.0, 200, 1400, 0.4, 'sawtooth');
    burst(c, o, t + 0.3, 2.0, 2500, 0.7, 0.3, 'highpass');
  },
  emp: (c, o, t) => {
    tone(c, o, t, 0.8, 2500, 50, 0.5, 'sawtooth');
    burst(c, o, t, 0.4, 4000, 1, 0.3, 'highpass');
  },
  bomb_drop: (c, o, t) => tone(c, o, t, 0.8, 1200, 300, 0.2, 'triangle'),
  jet_pass: (c, o, t) => burst(c, o, t, 2.2, 600, 0.3, 0.5, 'bandpass'),
  ack_move: (c, o, t) => tone(c, o, t, 0.06, 900, 1200, 0.15, 'square'),
  ack_attack: (c, o, t) => {
    tone(c, o, t, 0.06, 700, 500, 0.15, 'square');
    tone(c, o, t + 0.07, 0.06, 900, 700, 0.15, 'square');
  },
  place: (c, o, t) => tone(c, o, t, 0.15, 400, 800, 0.25, 'triangle'),
  complete: (c, o, t) => {
    tone(c, o, t, 0.12, 660, 660, 0.2, 'triangle');
    tone(c, o, t + 0.13, 0.2, 990, 990, 0.2, 'triangle');
  },
  unit_ready: (c, o, t) => tone(c, o, t, 0.15, 880, 1100, 0.15, 'triangle'),
  sell: (c, o, t) => {
    for (let i = 0; i < 5; i++) tone(c, o, t + i * 0.05, 0.05, 1500 + i * 200, 1500 + i * 200, 0.12, 'square');
  },
  cash: (c, o, t) => {
    for (let i = 0; i < 3; i++) tone(c, o, t + i * 0.06, 0.08, 1800, 2400, 0.12, 'square');
  },
  promote: (c, o, t) => {
    tone(c, o, t, 0.1, 523, 523, 0.15, 'triangle');
    tone(c, o, t + 0.1, 0.1, 659, 659, 0.15, 'triangle');
    tone(c, o, t + 0.2, 0.25, 784, 784, 0.15, 'triangle');
  },
  salvage: (c, o, t) => burst(c, o, t, 0.2, 2200, 2, 0.2),
  repair: (c, o, t) => {
    for (let i = 0; i < 4; i++) burst(c, o, t + i * 0.1, 0.06, 3000, 3, 0.15);
  },
  paradrop: (c, o, t) => burst(c, o, t, 1.5, 500, 0.3, 0.4),
  ambush: (c, o, t) => burst(c, o, t, 0.4, 800, 0.4, 0.3),
  click: (c, o, t) => tone(c, o, t, 0.04, 1200, 900, 0.1, 'square'),
  error: (c, o, t) => tone(c, o, t, 0.15, 220, 160, 0.2, 'square'),
  rankup: (c, o, t) => {
    for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.12, 0.2, 440 * Math.pow(2, i / 4), 440 * Math.pow(2, i / 4), 0.15, 'triangle');
  },
};

const LIMITS: Record<string, number> = { rifle: 0.05, mg: 0.05, gatling: 0.04, hit: 0.06, rocket: 0.08, cannon: 0.08, explosion: 0.08 };

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicNext = 0;
  musicEnabled = true;
  private last: Record<string, number> = {};
  enabled = true;
  evaEnabled = true;
  listenerX = 0;
  listenerY = 0;
  private evaQueue: string[] = [];
  private evaBusy = false;
  onEva: ((msg: string) => void) | null = null;

  /** Must be called from a user gesture on iOS. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(comp);
    } catch {
      this.ctx = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }

  /** Start / stop the generative military-drum loop. */
  music(on: boolean) {
    if (!this.ctx || !this.musicGain) return;
    const want = on && this.musicEnabled && this.enabled ? 0.22 : 0;
    this.musicGain.gain.setTargetAtTime(want, this.ctx.currentTime, 0.8);
    if (want > 0 && !this.musicTimer) {
      this.musicNext = this.ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 250);
    } else if (want === 0 && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
  }

  /** Schedules the next few 16th notes: kick, snare, hats and a slow bass drone in D minor. */
  private scheduleMusic() {
    const ctx = this.ctx, out = this.musicGain;
    if (!ctx || !out) return;
    const bpm = 96, step = 60 / bpm / 4;
    while (this.musicNext < ctx.currentTime + 0.6) {
      const i = this.musicStep % 64, t = this.musicNext;
      const bar = Math.floor(this.musicStep / 16) % 4;
      if (i % 16 === 0 || i % 16 === 10 || (bar === 3 && i % 16 === 14)) tone(ctx, out, t, 0.25, 110, 35, 0.9); // kick
      if (i % 16 === 4 || i % 16 === 12) burst(ctx, out, t, 0.18, 1800, 0.6, 0.45); // snare
      if (i % 2 === 0) burst(ctx, out, t, 0.04, 8000, 1.5, i % 4 === 0 ? 0.12 : 0.07, 'highpass'); // hats
      if (i % 32 === 0) {
        const root = [73.4, 73.4, 87.3, 65.4][bar]; // D, D, F, C
        tone(ctx, out, t, step * 30, root, root, 0.18, 'sawtooth');
        tone(ctx, out, t, step * 30, root * 1.5, root * 1.5, 0.06, 'triangle');
      }
      if (i % 8 === 6 && bar >= 2) tone(ctx, out, t, 0.3, 293.7 * (i % 16 === 6 ? 1 : 1.2), 293.7 * (i % 16 === 6 ? 1 : 1.2), 0.05, 'square');
      this.musicStep++;
      this.musicNext += step;
    }
  }

  play(name: string, x?: number, y?: number) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const r = RECIPES[name];
    if (!r) return;
    const now = performance.now() / 1000;
    const lim = LIMITS[name] ?? 0.03;
    if (now - (this.last[name] ?? -1) < lim) return;
    this.last[name] = now;
    let vol = 1;
    if (x !== undefined && y !== undefined) {
      const d = dist(x, y, this.listenerX, this.listenerY);
      vol = Math.max(0, 1 - d / 60);
      if (vol <= 0.02) return;
    }
    const g = this.ctx.createGain();
    g.gain.value = vol * vol;
    g.connect(this.master);
    try {
      r(this.ctx, g, this.ctx.currentTime);
    } catch {
      /* ignore */
    }
  }

  eva(msg: string) {
    this.onEva?.(msg);
    if (!this.evaEnabled || !this.enabled) return;
    if (!('speechSynthesis' in window)) {
      this.play('click');
      return;
    }
    this.evaQueue.push(msg);
    this.pumpEva();
  }

  private pumpEva() {
    if (this.evaBusy || !this.evaQueue.length) return;
    const msg = this.evaQueue.shift()!;
    if (this.evaQueue.length > 3) this.evaQueue.length = 3;
    const u = new SpeechSynthesisUtterance(msg);
    u.rate = 1.05;
    u.pitch = 0.85;
    u.volume = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|zira|google us/i.test(v.name)) ?? voices.find((v) => /en/i.test(v.lang));
    if (v) u.voice = v;
    this.evaBusy = true;
    const done = () => {
      this.evaBusy = false;
      this.pumpEva();
    };
    u.onend = done;
    u.onerror = done;
    try {
      window.speechSynthesis.speak(u);
      setTimeout(done, 4000);
    } catch {
      done();
    }
  }
}
