import { STARTER_NOTES } from "./starterMap";

/** Names for the Nitro Max default map (used by the monitor only, shown as "Kit: ..."). */
const KIT_LABELS: Record<keyof typeof STARTER_NOTES, string> = {
  kick: "Kick",
  snare: "Snare",
  snareRim: "Snare rim",
  tom1: "Tom 1",
  tom2: "Tom 2",
  tom3: "Tom 3",
  hihatClosed: "Hi-hat closed",
  hihatHalfOpen: "Hi-hat half-open",
  hihatOpen: "Hi-hat open",
  hihatPedal: "Hi-hat pedal",
  hihatSplash: "Hi-hat splash",
  crash1: "Crash",
  ride: "Ride",
};

/** General MIDI percussion names. Charts and MIDI imports use GM, so these stay GM. */
export const GM_NAMES: Record<number, string> = {
  35: "Acoustic bass drum",
  36: "Bass drum 1",
  37: "Side stick",
  38: "Acoustic snare",
  39: "Hand clap",
  40: "Snare (electric/rim)",
  41: "Low floor tom",
  42: "Closed hi-hat",
  43: "High floor tom",
  44: "Pedal hi-hat",
  45: "Low tom",
  46: "Open hi-hat",
  47: "Low-mid tom",
  48: "Hi-mid tom",
  49: "Crash 1",
  50: "High tom",
  51: "Ride 1",
  52: "China",
  53: "Ride bell",
  54: "Tambourine",
  55: "Splash",
  56: "Cowbell",
  57: "Crash 2",
  59: "Ride 2",
};

/** Name from the Nitro Max kit map, or null when the note is not part of it. */
export function kitNoteName(note: number): string | null {
  for (const k of Object.keys(STARTER_NOTES) as (keyof typeof STARTER_NOTES)[]) {
    if (STARTER_NOTES[k] === note) return KIT_LABELS[k];
  }
  return null;
}

/** General MIDI name, or null when unknown. */
export function gmNoteName(note: number): string | null {
  return GM_NAMES[note] ?? null;
}

/**
 * Monitor name for a MIDI note: "Kit: <name>" when it matches the Nitro Max map, the GM name
 * otherwise, "?" when unknown.
 */
export function guessDrumName(note: number): string {
  const kit = kitNoteName(note);
  if (kit) return `Kit: ${kit}`;
  return gmNoteName(note) ?? "?";
}
