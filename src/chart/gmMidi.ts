import type { PieceId } from "../kit/types";
import type { NoteEvent, ParsedChart } from "./types";
import { dedupeNotes, sortNotes } from "./laneMap";
import { loadMidi, tempoMapFromMidi, tempoMetaFromMidi, toVelocity127, type MidiInput } from "./midiCommon";

/** General MIDI percussion note -> canonical piece. Rim click (37) maps to snare per SPEC 4.4. */
export const GM_MAP: Record<number, PieceId> = {
  35: "kick", 36: "kick",
  37: "snare", 38: "snare", 40: "snare",
  // Toms: 50/48 high, 47/45 mid, 43 high floor, 41 low floor.
  50: "tom1", 48: "tom1", 47: "tom2", 45: "tom2", 43: "tom3", 41: "tom4",
  42: "hihat", 44: "hihat", 46: "hihat",
  49: "crash1", 57: "crash2",
  51: "ride", 59: "ride", 53: "ride",
  52: "china", 55: "splash",
};

/** Plain General MIDI drum file. Everything goes into `expert`. */
export function parseGmMidi(input: MidiInput): ParsedChart {
  const midi = loadMidi(input);
  const warnings: string[] = [];
  const withNotes = midi.tracks.filter((t) => t.notes.length > 0);
  let tracks = withNotes.filter((t) => t.channel === 9 || t.instrument.percussion);
  if (!tracks.length) {
    if (!withNotes.length) throw new Error("MIDI file contains no notes");
    tracks = [withNotes[0]!];
    warnings.push("No channel 10 drum track found; using the first track with notes.");
  }
  const tempo = tempoMapFromMidi(midi);
  const unknown = new Map<number, number>();
  const notes: NoteEvent[] = [];
  for (const t of tracks) {
    for (const n of t.notes) {
      const piece = GM_MAP[n.midi];
      if (!piece) {
        unknown.set(n.midi, (unknown.get(n.midi) ?? 0) + 1);
        continue;
      }
      notes.push({
        timeSec: tempo.ticksToSeconds(n.ticks),
        piece,
        velocity: toVelocity127(n.velocity),
        source: `gm:${n.midi}`,
      });
    }
  }
  if (unknown.size) {
    const list = [...unknown].map(([k, c]) => `${k} (x${c})`).join(", ");
    warnings.push(`Ignored unmapped GM notes: ${list}.`);
  }
  if (!notes.length) warnings.push("No mappable drum notes found.");
  return {
    format: "gm-midi",
    notesByDifficulty: notes.length ? { expert: dedupeNotes(sortNotes(notes)) } : {},
    meta: tempoMetaFromMidi(midi, tempo),
    warnings,
  };
}
