import type { Ink } from "./types.ts";

export type Mixer = {
  unlock: () => void;
  resume: () => void;
  setMuted: (muted: boolean) => void;
  scrape: (amount: number, ink: Ink | null) => void;
  play: (name: string) => void;
  close: () => void;
};

export function createMixer(): Mixer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let scrapeGain: GainNode | null = null;
  let scrapeFilter: BiquadFilterNode | null = null;
  let muted = false;

  function graph() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);

    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 0.96 + (Math.random() * 2 - 1) * 0.04;
      data[i] = (Math.random() * 2 - 1) * 0.6 + v * 4;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = "bandpass";
    scrapeFilter.frequency.value = 700;
    scrapeFilter.Q.value = 0.8;
    scrapeGain = ctx.createGain();
    scrapeGain.gain.value = 0;
    src.connect(scrapeFilter);
    scrapeFilter.connect(scrapeGain);
    scrapeGain.connect(master);
    src.start();
    return ctx;
  }

  function unlock() {
    const c = graph();
    if (c.state === "suspended") void c.resume();
  }

  function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 1) {
    const c = ctx;
    const m = master;
    if (!c || !m) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(m);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  function noiseBurst(dur: number, gain: number, freq: number) {
    const c = ctx;
    const m = master;
    if (!c || !m) return;
    const t = c.currentTime;
    const frames = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(m);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  return {
    unlock,
    resume() {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    },
    setMuted(next) {
      muted = next;
      if (!master || !ctx) return;
      master.gain.setTargetAtTime(next ? 0 : 0.85, ctx.currentTime, 0.02);
    },
    scrape(amount, ink) {
      if (!scrapeGain || !scrapeFilter || !ctx) return;
      const target = muted ? 0 : amount * (ink === "ice" ? 0.12 : ink === "boost" ? 0.2 : 0.16);
      scrapeGain.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
      const freq = ink === "ice" ? 1400 : ink === "boost" ? 520 : 780;
      scrapeFilter.frequency.setTargetAtTime(freq + amount * 600, ctx.currentTime, 0.05);
    },
    play(name) {
      if (!ctx || muted) return;
      const rate = 0.94 + Math.random() * 0.12;
      if (name === "crash") {
        noiseBurst(0.38, 0.55, 240);
        tone(140, 0.32, "sine", 0.4, 0.4);
      } else if (name === "bounce") {
        tone(420 * rate, 0.16, "sine", 0.18, 0.55);
      } else if (name === "flip") {
        tone(520 * rate, 0.09, "triangle", 0.12, 1.4);
        tone(780 * rate, 0.12, "sine", 0.08, 1.2);
      } else if (name === "kick") {
        tone(240 * rate, 0.08, "square", 0.05, 1.8);
      } else if (name === "land") {
        noiseBurst(0.08, 0.12, 500);
      } else if (name === "boost") {
        tone(300 * rate, 0.1, "sawtooth", 0.04, 1.7);
      } else if (name === "start") {
        tone(660, 0.07, "sine", 0.06, 1.25);
      }
    },
    close() {
      if (ctx) void ctx.close();
      ctx = null;
      master = null;
      scrapeGain = null;
      scrapeFilter = null;
    },
  };
}
