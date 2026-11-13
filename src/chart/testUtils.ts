import { Midi } from "@tonejs/midi";

export interface TestNote {
  midi: number;
  ticks: number;
  durationTicks?: number;
  velocity?: number; // 0..1
}

/** Build SMF bytes for tests. */
export function buildMidi(opts: {
  tempos?: { ticks: number; bpm: number }[];
  tracks: { name?: string; channel?: number; notes: TestNote[] }[];
}): Uint8Array {
  const m = new Midi();
  m.header.tempos = (opts.tempos ?? [{ ticks: 0, bpm: 120 }]).map((t) => ({ ticks: t.ticks, bpm: t.bpm }));
  for (const t of opts.tracks) {
    const tr = m.addTrack();
    if (t.name) tr.name = t.name;
    tr.channel = t.channel ?? 0;
    for (const n of t.notes) {
      tr.addNote({ midi: n.midi, ticks: n.ticks, durationTicks: n.durationTicks ?? 10, velocity: n.velocity ?? 0.8 });
    }
  }
  return m.toArray();
}

export const file = (name: string, content: string | Uint8Array, rel?: string): File => {
  const f = new File([content as BlobPart], name);
  if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
  return f;
};
