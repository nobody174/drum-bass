/**
 * App-wide settings (M4). One small typed store backed by localStorage.
 * Existing keys stay where they are (sound: src/audio/settings.ts, display/approach:
 * src/ui/play/params.ts); this store holds the new ones and is the single place the
 * Play screen reads latency, timing preset and behaviour toggles from.
 */
export type TimingPreset = "beginner" | "normal" | "strict";

export interface AppSettings {
  /** Added to every input hit time (ms). Positive = the hit really happened EARLIER than it was stamped. Set by calibration. */
  inputLatencyMs: number;
  /** Extra audio output latency compensation (ms), set by calibration. */
  outputLatencyMs: number;
  timingPreset: TimingPreset;
  /** Default count-in beats for new runs. */
  defaultCountIn: 0 | 2 | 4;
  /** Click during play (metronome). */
  metronomeDuringPlay: boolean;
  /** Screen Wake Lock during play. */
  keepAwake: boolean;
  /** Colorblind-friendly piece palette. */
  colorblindPalette: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  inputLatencyMs: 0,
  outputLatencyMs: 0,
  timingPreset: "normal",
  defaultCountIn: 4,
  metronomeDuringPlay: false,
  keepAwake: true,
  colorblindPalette: false,
};

export const APP_SETTINGS_KEY = "drum-bass.settings.app";

/** Judge windows in ms (perfect/good/ok half-widths) per preset. */
export const TIMING_WINDOWS: Record<TimingPreset, { perfect: number; good: number; ok: number }> = {
  beginner: { perfect: 50, good: 100, ok: 160 },
  normal: { perfect: 35, good: 70, ok: 120 },
  strict: { perfect: 25, good: 50, ok: 90 },
};

type Listener = (s: AppSettings) => void;

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const o = JSON.parse(raw) as Partial<AppSettings>;
    return sanitize(o);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function sanitize(o: Partial<AppSettings>): AppSettings {
  const d = DEFAULT_SETTINGS;
  const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  return {
    inputLatencyMs: num(o.inputLatencyMs, -500, 500, d.inputLatencyMs),
    outputLatencyMs: num(o.outputLatencyMs, -500, 500, d.outputLatencyMs),
    timingPreset: o.timingPreset === "beginner" || o.timingPreset === "strict" ? o.timingPreset : "normal",
    defaultCountIn: o.defaultCountIn === 0 || o.defaultCountIn === 2 ? o.defaultCountIn : 4,
    metronomeDuringPlay: typeof o.metronomeDuringPlay === "boolean" ? o.metronomeDuringPlay : d.metronomeDuringPlay,
    keepAwake: typeof o.keepAwake === "boolean" ? o.keepAwake : d.keepAwake,
    colorblindPalette: typeof o.colorblindPalette === "boolean" ? o.colorblindPalette : d.colorblindPalette,
  };
}

class SettingsStore {
  private state: AppSettings | null = null;
  private listeners = new Set<Listener>();

  get(): AppSettings {
    return (this.state ??= load());
  }
  set(patch: Partial<AppSettings>): void {
    this.state = sanitize({ ...this.get(), ...patch });
    try {
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable: keep in memory */
    }
    for (const l of this.listeners) l(this.state);
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const settingsStore = new SettingsStore();
