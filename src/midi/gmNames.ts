import { STARTER_NOTES } from "./starterMap";

/** Human readable names for the starter mapping (preferred) ... */
const STARTER_LABELS: Record<keyof typeof STARTER_NOTES, string> = {
  kick: "Kick",
  snare: "Snare",
  snareRim: "Snare rim",
  tom1: "Tom 1 (high)",
  tom2: "Tom 2 (mid)",
  tom3: "Tom 3 (low)",
  tom4: "Floor tom",
  hihatClosed: "Hi-hat closed",
  hihatPedal: "Hi-hat pedal",
  hihatOpen: "Hi-hat open",
  crash1: "Crash 1",
  ride: "Ride",
  rideBell: "Ride bell",
};

/** ... plus a few extra General MIDI percussion names as a fallback guess. */
const GM_EXTRA: Record<number, string> = {
  35: "Acoustic bass drum",
  39: "Hand clap",
  40: "Snare (electric/rim)",
  41: "Low floor tom",
  50: "High tom",
  52: "China",
  54: "Tambourine",
  55: "Splash",
  56: "Cowbell",
  57: "Crash 2",
  59: "Ride 2",
};

/** Guess a drum name for a MIDI note, or "?" when unknown. */
export function guessDrumName(note: number): string {
  for (const k of Object.keys(STARTER_NOTES) as (keyof typeof STARTER_NOTES)[]) {
    if (STARTER_NOTES[k] === note) return STARTER_LABELS[k];
  }
  return GM_EXTRA[note] ?? "?";
}
