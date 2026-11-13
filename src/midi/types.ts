/**
 * Shared input contract. Every input source (Web MIDI, keyboard, on-screen pads,
 * future MIDI mock) emits DrumInputEvent through the InputBus. Nothing downstream
 * may care where an event came from.
 */
export type InputSource = "midi" | "keyboard" | "pad" | "mock";

export interface DrumInputEvent {
  /** Raw MIDI note number (0-127). Virtual inputs use the starter GM mapping. */
  note: number;
  /** 1-127 */
  velocity: number;
  /** 0-15 (MIDI channel 10 = 9). Virtual inputs use 9. */
  channel: number;
  source: InputSource;
  /** performance.now() at receipt (ms). Web MIDI provides event.timeStamp on the same clock. */
  timeStamp: number;
  /** Controller messages are reported separately, see CcEvent. */
}

export interface CcEvent {
  controller: number; // e.g. 4 = hi-hat foot controller
  value: number;
  channel: number;
  timeStamp: number;
}

export type InputListener = (e: DrumInputEvent) => void;
