/**
 * Click (metronome) tones scheduled on the audio clock. Timers are only used to top up a
 * lookahead window; the tick times themselves are AudioContext.currentTime based.
 */

export interface ClickOptions {
  freq?: number; // Hz, normal beat
  accentFreq?: number; // Hz, beat 1
  level?: number; // peak gain 0..1
  durationSec?: number;
}

const DEFAULTS = { freq: 1000, accentFreq: 1600, level: 0.6, durationSec: 0.04 };

/** Handle to cancel scheduled ticks. */
export interface ClickVoice {
  stop(): void;
}

/** Schedules one tick at ctx time `when` (seconds). */
export function scheduleTick(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  accent: boolean,
  opts: ClickOptions = {},
  onEnd?: () => void,
): ClickVoice {
  const o = { ...DEFAULTS, ...opts };
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? o.accentFreq : o.freq;
  const t = Math.max(when, ctx.currentTime);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.level, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.durationSec);
  osc.connect(g);
  g.connect(dest);
  let done = false;
  osc.onended = () => {
    done = true;
    onEnd?.();
    try {
      osc.disconnect();
      g.disconnect();
    } catch {
      /* ignore */
    }
  };
  osc.start(t);
  osc.stop(t + o.durationSec + 0.02);
  return {
    stop() {
      if (done) return;
      try {
        osc.stop(ctx.currentTime);
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Tracks scheduled ticks so they can be cancelled together (pause/seek). */
export class ClickGroup {
  private voices = new Set<ClickVoice>();
  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private opts: ClickOptions = {},
  ) {}

  tick(when: number, accent: boolean): void {
    const v: ClickVoice = scheduleTick(this.ctx, this.dest, when, accent, this.opts, () => this.voices.delete(v));
    this.voices.add(v);
  }

  cancelAll(): void {
    for (const v of this.voices) v.stop();
    this.voices.clear();
  }
}

/**
 * Song-time beat positions of a count-in: `beats` ticks ending one beat before time 0.
 * Index k (0-based) is at -(beats - k) * 60 / bpm. Accent on k % beatsPerBar === 0.
 */
export function countInBeats(beats: number, bpm: number, beatsPerBar = 4): { songTime: number; accent: boolean }[] {
  if (!(beats > 0) || !(bpm > 0)) return [];
  const beatSec = 60 / bpm;
  const out: { songTime: number; accent: boolean }[] = [];
  for (let k = 0; k < beats; k++) out.push({ songTime: -(beats - k) * beatSec, accent: k % beatsPerBar === 0 });
  return out;
}

export interface MetronomeOptions extends ClickOptions {
  lookaheadSec?: number;
  tickIntervalMs?: number;
  beatsPerBar?: number;
  /** Injectable for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export interface Metronome {
  /** Starts ticking; the first tick is at ctx time `startCtxTime` (default: now). */
  start(bpm: number, startCtxTime?: number): void;
  setBpm(bpm: number): void;
  stop(): void;
  readonly running: boolean;
}

/** Endless metronome with a lookahead scheduler, for later use during play. */
export function createMetronome(ctx: AudioContext, dest: AudioNode, opts: MetronomeOptions = {}): Metronome {
  const lookahead = opts.lookaheadSec ?? 0.12;
  const interval = opts.tickIntervalMs ?? 25;
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const si = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const ci = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const group = new ClickGroup(ctx, dest, opts);
  let handle: unknown = null;
  let bpm = 120;
  let nextTime = 0;
  let beat = 0;

  const pump = () => {
    const horizon = ctx.currentTime + lookahead;
    while (nextTime < horizon) {
      group.tick(nextTime, beat % beatsPerBar === 0);
      beat++;
      nextTime += 60 / bpm;
    }
  };

  return {
    start(b, startCtxTime) {
      this.stop();
      bpm = b > 0 ? b : 120;
      nextTime = startCtxTime ?? ctx.currentTime;
      beat = 0;
      handle = si(pump, interval);
      pump();
    },
    setBpm(b) {
      if (b > 0) bpm = b;
    },
    stop() {
      if (handle !== null) ci(handle);
      handle = null;
      group.cancelAll();
    },
    get running() {
      return handle !== null;
    },
  };
}
