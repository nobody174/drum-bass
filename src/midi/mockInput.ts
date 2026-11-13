import { inputBus } from "./inputBus";
import type { DrumInputEvent } from "./types";
import { STARTER_NOTES } from "./starterMap";

export interface MockStep {
  /** Offset from playback start in ms */
  atMs: number;
  event: Pick<DrumInputEvent, "note"> & Partial<Omit<DrumInputEvent, "note">>;
}

/**
 * Replay recorded events through the input bus. timeStamp is set to
 * performance.now() at emission. Returns a cancel function.
 */
export function playMock(steps: readonly MockStep[], onDone?: () => void): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  let remaining = steps.length;
  if (steps.length === 0) {
    onDone?.();
    return () => {};
  }
  for (const s of steps) {
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        inputBus.emit({
          velocity: 100,
          channel: 9,
          source: "mock",
          ...s.event,
          timeStamp: performance.now(),
        });
        if (--remaining <= 0) onDone?.();
      }, Math.max(0, s.atMs)),
    );
  }
  return () => {
    cancelled = true;
    for (const t of timers) clearTimeout(t);
  };
}

/** One bar of a simple rock beat at 120 bpm (eighth = 250 ms), synthetic. */
export const DEMO_PATTERN: readonly MockStep[] = (() => {
  const out: MockStep[] = [];
  const eighth = 250;
  for (let i = 0; i < 8; i++) {
    out.push({ atMs: i * eighth, event: { note: STARTER_NOTES.hihatClosed, velocity: 80 } });
  }
  for (const i of [0, 3, 4]) out.push({ atMs: i * eighth, event: { note: STARTER_NOTES.kick, velocity: 110 } });
  for (const i of [2, 6]) out.push({ atMs: i * eighth, event: { note: STARTER_NOTES.snare, velocity: 105 } });
  return out.sort((a, b) => a.atMs - b.atMs);
})();
