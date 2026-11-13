import { Midi } from "@tonejs/midi";
import { createTempoMap, bpmToUsPerQuarter, beatsPerBarOf, type TempoMap } from "./tempo";
import type { SongMeta } from "./types";

export type MidiInput = ArrayBuffer | Uint8Array | Midi;

export function loadMidi(input: MidiInput): Midi {
  if (input instanceof Midi) return input;
  try {
    return new Midi(input instanceof Uint8Array ? input : new Uint8Array(input));
  } catch (e) {
    throw new Error(`Not a valid MIDI file: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Tempo map built from the file's tempo events (tonejs merges all tracks into the header). */
export function tempoMapFromMidi(midi: Midi): TempoMap {
  const ppq = midi.header.ppq || 480;
  const changes = midi.header.tempos.map((t) => ({ tick: t.ticks, usPerQuarter: bpmToUsPerQuarter(t.bpm) }));
  return createTempoMap(ppq, changes);
}

/** tonejs velocity is 0..1; convert to 1..127. */
export const toVelocity127 = (v: number): number => Math.min(127, Math.max(1, Math.round(v * 127)));

/** Tempo map and first time signature as SongMeta fields (startBpm is added by the importer). */
export function tempoMetaFromMidi(midi: Midi, tempo: TempoMap): Partial<SongMeta> {
  const out: Partial<SongMeta> = { tempoMap: tempo.points };
  const ts = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)[0]?.timeSignature;
  if (ts) out.beatsPerBar = beatsPerBarOf(ts[0], ts[1]);
  return out;
}
