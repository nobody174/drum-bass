import type { ImportedAudio } from "../chart/types";

export type MixMode = "full" | "nodrums" | "drumsonly" | "clickonly";
export type TransportState = "empty" | "ready" | "playing" | "paused" | "ended";

/**
 * Playback clock for the Play screen. `songTime` is derived from
 * AudioContext.currentTime (the single source of truth), never from timers or RAF.
 */
export interface Transport {
  readonly state: TransportState;
  /** Song position in seconds (negative during count-in). Includes song.ini delay. */
  readonly songTime: number;
  load(stems: ImportedAudio[], opts?: { delayMs?: number }): Promise<void>;
  setMix(mode: MixMode): void;
  /** Count-in beats (click) before song time 0; 0 disables. */
  play(opts?: { countInBeats?: number; bpm?: number }): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  onEnded(cb: () => void): () => void;
  dispose(): void;
}
