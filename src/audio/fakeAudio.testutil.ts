/** Minimal fake AudioContext with a manual clock, for headless timing tests. Not a sound test. */
export interface FakeSource {
  buffer: { duration: number } | null;
  when?: number;
  offset?: number;
  stopped: boolean;
  gainNode?: FakeGain;
  onended: (() => void) | null;
}
export interface FakeGain {
  gain: {
    value: number;
    target?: number;
    setTargetAtTime(v: number, t: number, tc: number): void;
    setValueAtTime(v: number, t: number): void;
    linearRampToValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
    cancelScheduledValues(t: number): void;
  };
  connect(n: unknown): unknown;
  disconnect(): void;
}

export function makeFakeCtx(opts: { state?: AudioContextState; durations?: Record<string, number> } = {}) {
  let now = 0;
  const f = {
    sources: [] as FakeSource[],
    oscStarts: [] as number[],
    oscFreqs: [] as number[],
    gains: [] as FakeGain[],
    resumeCalls: 0,
    decodeIndex: 0,
    resumeFails: false,
    decodeFails: new Set<number>(),
    nextDurations: [] as number[],
    setTime(t: number) {
      now = t;
    },
    advance(dt: number) {
      now += dt;
    },
    ctx: null as unknown as AudioContext,
  };
  const mkGain = (): FakeGain => {
    const g: FakeGain = {
      gain: {
        value: 1,
        setTargetAtTime(v) {
          g.gain.target = v;
        },
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
        cancelScheduledValues() {},
      },
      connect: (n) => n,
      disconnect() {},
    };
    f.gains.push(g);
    return g;
  };
  let state: AudioContextState = opts.state ?? "running";
  const ctx = {
    get currentTime() {
      return now;
    },
    get state() {
      return state;
    },
    destination: {},
    baseLatency: 0.01,
    createGain: mkGain,
    createBufferSource() {
      const s: FakeSource = {
        buffer: null,
        stopped: false,
        onended: null,
        connect(n: FakeGain) {
          s.gainNode = n;
          return n;
        },
        disconnect() {},
        start(when: number, offset = 0) {
          s.when = when;
          s.offset = offset;
        },
        stop() {
          s.stopped = true;
        },
      } as unknown as FakeSource;
      f.sources.push(s);
      return s;
    },
    createOscillator() {
      const o = {
        type: "sine",
        frequency: { value: 0 },
        onended: null as (() => void) | null,
        connect: (n: unknown) => n,
        disconnect() {},
        start(t: number) {
          f.oscStarts.push(t);
          f.oscFreqs.push(o.frequency.value);
        },
        stop() {},
      };
      return o;
    },
    async resume() {
      f.resumeCalls++;
      if (f.resumeFails) throw new Error("NotAllowedError");
      state = "running";
    },
    async decodeAudioData(_data: ArrayBuffer) {
      const i = f.decodeIndex++;
      if (f.decodeFails.has(i)) throw new Error("EncodingError");
      return { duration: f.nextDurations[i] ?? 10 };
    },
  };
  f.ctx = ctx as unknown as AudioContext;
  return f;
}

export const fakeBlob = (): Blob => ({ arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Blob;
