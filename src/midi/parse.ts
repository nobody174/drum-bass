/** Pure MIDI byte parsing, free of browser APIs so it can be unit tested. */
import type { CcEvent, DrumInputEvent } from "./types";

export type ParsedMidi =
  | { kind: "note"; event: DrumInputEvent }
  | { kind: "cc"; event: CcEvent };

/**
 * Parse one raw MIDI message. Returns null for anything we ignore:
 * note-off, note-on with velocity 0, truncated messages, other status bytes
 * (pitch bend, aftertouch, program change, system real-time, sysex ...).
 */
export function parseMidiMessage(
  data: ArrayLike<number> | null | undefined,
  timeStamp: number,
): ParsedMidi | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const d1 = data[1] & 0x7f;
  const d2 = data[2] & 0x7f;
  if (status === 0x90) {
    if (d2 === 0) return null; // note-on velocity 0 == note-off
    return { kind: "note", event: { note: d1, velocity: d2, channel, source: "midi", timeStamp } };
  }
  if (status === 0xb0) {
    return { kind: "cc", event: { controller: d1, value: d2, channel, timeStamp } };
  }
  return null;
}
