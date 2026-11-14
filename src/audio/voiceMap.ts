import type { InputSource } from "../midi/types";

export type VoiceKind =
  | "kick"
  | "snare"
  | "rim"
  | "tom"
  | "hatClosed"
  | "hatOpen"
  | "crash"
  | "ride"
  | "bell"
  | "blip";

export interface VoiceSpec {
  kind: VoiceKind;
  /** Base frequency in Hz for pitched voices (toms), otherwise 0. */
  pitch: number;
}

/**
 * Tom pitches by note. The Nitro Max toms are 48 / 45 / 43; the other GM tom notes (41, 47, 50)
 * stay for imported charts, MIDI files and user-added toms.
 */
const TOM_PITCH: Record<number, number> = {
  41: 85, // GM low floor tom
  43: 105, // Nitro Max tom 3
  45: 130, // Nitro Max tom 2
  47: 160, // GM low-mid tom
  48: 195, // Nitro Max tom 1
  50: 235, // GM high tom
};

/**
 * Maps a note number (Nitro Max map or General MIDI) to a synthesized voice. Unknown notes get
 * a neutral blip. 40 = snare (Nitro Max rim / GM electric snare), 23 = half-open hat,
 * 21 = hat splash.
 */
export function noteToVoice(note: number): VoiceSpec {
  if (note === 35 || note === 36) return { kind: "kick", pitch: 0 };
  if (note === 38 || note === 40) return { kind: "snare", pitch: 0 };
  if (note === 37) return { kind: "rim", pitch: 0 };
  if (note in TOM_PITCH) return { kind: "tom", pitch: TOM_PITCH[note]! };
  if (note === 42 || note === 44) return { kind: "hatClosed", pitch: 0 };
  if (note === 46 || note === 23) return { kind: "hatOpen", pitch: 0 };
  if (note === 49 || note === 52 || note === 55 || note === 57 || note === 21) return { kind: "crash", pitch: 0 };
  if (note === 51 || note === 59) return { kind: "ride", pitch: 0 };
  if (note === 53) return { kind: "bell", pitch: 0 };
  return { kind: "blip", pitch: 0 };
}

/** MIDI velocity 1-127 to linear gain. Slight curve so soft hits stay audible. */
export function velocityToGain(velocity: number): number {
  const v = Math.min(127, Math.max(0, Number.isFinite(velocity) ? velocity : 0)) / 127;
  return Math.pow(v, 1.4);
}

/**
 * Whether a hit from `source` should make sound. Real MIDI is skipped by default
 * because the e-drum module already sounds it.
 */
export function shouldPlaySource(
  source: InputSource,
  settings: { enabled: boolean; playForMidi: boolean },
): boolean {
  if (!settings.enabled) return false;
  if (source === "midi") return settings.playForMidi;
  return source === "pad" || source === "keyboard" || source === "mock";
}

/** Keeps at most `max` live voices; adding more cuts the oldest. */
export class VoiceLimiter<T> {
  private live: T[] = [];
  constructor(
    private max: number,
    private cut: (v: T) => void,
  ) {}

  add(v: T): void {
    this.live.push(v);
    while (this.live.length > this.max) {
      const old = this.live.shift()!;
      this.cut(old);
    }
  }
  remove(v: T): void {
    const i = this.live.indexOf(v);
    if (i >= 0) this.live.splice(i, 1);
  }
  get size(): number {
    return this.live.length;
  }
}
