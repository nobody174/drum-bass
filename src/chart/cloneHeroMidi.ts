import type { Midi } from "@tonejs/midi";
import type { Difficulty, NoteEvent, ParsedChart } from "./types";
import { dedupeNotes, lanePiece, sortNotes, type Lane } from "./laneMap";
import { loadMidi, tempoMapFromMidi, tempoMetaFromMidi, toVelocity127, type MidiInput } from "./midiCommon";
import { readTrackTexts } from "./midiText";

/**
 * Rock Band 3 / Clone Hero `PART DRUMS` note layout.
 * UNVERIFIED against a real file: taken from SPEC 9.1 and community docs. fixtures/local was empty
 * when this was written. Re-check these numbers as soon as a real notes.mid is available.
 */
export const DIFFICULTY_BASE: Record<Difficulty, number> = { expert: 96, hard: 84, medium: 72, easy: 60 };
/** Lane offsets from the difficulty base note: kick, red (snare), yellow, blue, green (5-lane: orange), +5 green in 5-lane files. */
export const LANE_OFFSETS: Lane[] = ["kick", "red", "yellow", "blue", "green"];
export const DOUBLE_KICK_NOTE = 95; // Expert only
export const TOM_MARKER_NOTES = { yellow: 110, blue: 111, green: 112 } as const;
/** Known non-gem notes (ignored): solo 103, energy 116, fills 120-124, etc. Listed for documentation. */
export const IGNORED_NOTES_DOC = [103, 105, 106, 116, 120, 121, 122, 123, 124] as const;

/**
 * Disco flip: UNVERIFIED (no real file was available). Format taken from Rock Band 3 / Clone Hero docs:
 * text events on PART DRUMS `[mix <0-3> drums<N><flags>]` (0 easy .. 3 expert). Flags: "" normal,
 * "d" disco flip (charted red = hi-hat, charted yellow = snare), "dnoflip" / "easy" / "easynokick" are NOT flips.
 * A mix event applies from its tick until the next mix event of the same difficulty.
 */
const MIX_EVENT = /^\[mix\s+([0-3])\s+drums\d+([a-z]*)\]$/i;
const DIFF_INDEX: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };

type FlipEvents = Record<number, { tick: number; flip: boolean }[]>;

function readDiscoEvents(input: MidiInput): FlipEvents {
  const out: FlipEvents = {};
  if (!(input instanceof Uint8Array || input instanceof ArrayBuffer)) return out; // raw bytes needed
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  for (const t of readTrackTexts(bytes)) {
    if (t.trackName.trim().toUpperCase() !== "PART DRUMS") continue;
    for (const e of t.events) {
      const m = MIX_EVENT.exec(e.text.trim());
      if (!m) continue;
      (out[Number(m[1])] ??= []).push({ tick: e.tick, flip: m[2]!.toLowerCase() === "d" });
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.tick - b.tick);
  return out;
}

function flippedAt(events: { tick: number; flip: boolean }[] | undefined, tick: number): boolean {
  let flip = false;
  for (const e of events ?? []) {
    if (e.tick <= tick) flip = e.flip;
    else break;
  }
  return flip;
}

export interface CloneHeroMidiOptions {
  /** Used when the track has no tom markers at all. Default "cymbals" (spec: no marker = cymbal). */
  noMarkerPolicy?: "cymbals" | "toms";
}

type Interval = [start: number, end: number];

function mergeIntervals(iv: Interval[]): Interval[] {
  iv.sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function inside(iv: Interval[], tick: number): boolean {
  let lo = 0;
  let hi = iv.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = iv[mid]!;
    if (tick < s) hi = mid - 1;
    else if (tick > e || (tick === e && e !== s)) lo = mid + 1;
    else return true;
  }
  return false;
}

/** True if the MIDI has a `PART DRUMS` track (i.e. it is a Clone Hero / RB drum chart, not plain GM). */
export function hasPartDrums(input: MidiInput): boolean {
  return findDrumTrack(loadMidi(input)) !== undefined;
}

function findDrumTrack(midi: Midi) {
  return midi.tracks.find((t) => t.name.trim().toUpperCase() === "PART DRUMS");
}

export function parseCloneHeroMidi(input: MidiInput, options: CloneHeroMidiOptions = {}): ParsedChart {
  const midi = loadMidi(input);
  const track = findDrumTrack(midi);
  if (!track) throw new Error("notes.mid has no PART DRUMS track");
  const tempo = tempoMapFromMidi(midi);
  const warnings: string[] = [];
  const disco = readDiscoEvents(input);
  let discoNotes = 0;

  const markers: Record<"yellow" | "blue" | "green", Interval[]> = { yellow: [], blue: [], green: [] };
  for (const n of track.notes) {
    const color = (Object.keys(TOM_MARKER_NOTES) as (keyof typeof TOM_MARKER_NOTES)[]).find(
      (c) => TOM_MARKER_NOTES[c] === n.midi,
    );
    if (color) markers[color].push([n.ticks, n.ticks + n.durationTicks]);
  }
  const anyMarker = markers.yellow.length + markers.blue.length + markers.green.length > 0;
  const merged = { yellow: mergeIntervals(markers.yellow), blue: mergeIntervals(markers.blue), green: mergeIntervals(markers.green) };
  const policy = options.noMarkerPolicy ?? "cymbals";
  if (!anyMarker) {
    warnings.push(
      policy === "toms"
        ? "No tom markers in PART DRUMS: yellow/blue/green treated as toms."
        : "No tom markers in PART DRUMS: yellow/blue/green treated as cymbals (hi-hat/ride/crash).",
    );
  }

  // 5-lane detection: any note at base+5 of any difficulty.
  const fiveLane = (Object.values(DIFFICULTY_BASE) as number[]).some((b) => track.notes.some((n) => n.midi === b + 5));
  if (fiveLane) warnings.push("5-lane drum chart detected; lane layout is a best guess (unverified).");

  const out: Partial<Record<Difficulty, NoteEvent[]>> = {};
  for (const diff of Object.keys(DIFFICULTY_BASE) as Difficulty[]) {
    const base = DIFFICULTY_BASE[diff];
    const gems: { tick: number; lane: Lane; velocity: number }[] = [];
    for (const n of track.notes) {
      let lane: Lane | undefined;
      if (n.midi >= base && n.midi < base + 5) lane = LANE_OFFSETS[n.midi - base];
      else if (fiveLane && n.midi === base + 5) lane = "green";
      else if (diff === "expert" && n.midi === DOUBLE_KICK_NOTE) lane = "kick2x";
      if (!lane) continue;
      // In 5-lane files note base+4 is orange and base+5 is green.
      if (fiveLane && n.midi === base + 4) lane = "orange";
      gems.push({ tick: n.ticks, lane, velocity: toVelocity127(n.velocity) });
    }
    if (!gems.length) continue;

    const distinct = new Set(gems.map((g) => g.velocity));
    const realVelocities = distinct.size > 1;

    const notes: NoteEvent[] = gems.map((g) => {
      let isTom = false;
      if (g.lane === "yellow" || g.lane === "blue" || g.lane === "green") {
        isTom = anyMarker ? inside(merged[g.lane], g.tick) : policy === "toms";
      }
      let lane: Lane = g.lane;
      if (!fiveLane && (lane === "red" || lane === "yellow") && flippedAt(disco[DIFF_INDEX[diff]], g.tick)) {
        // Disco flip: charted red is the hi-hat, charted yellow is the snare.
        lane = lane === "red" ? "yellow" : "red";
        isTom = false;
        discoNotes++;
      }
      const piece = lanePiece(lane, isTom, fiveLane);
      const kind = lane === "yellow" || lane === "blue" || lane === "green" ? (isTom ? "tom" : "cymbal") : null;
      return {
        timeSec: tempo.ticksToSeconds(g.tick),
        piece,
        velocity: realVelocities ? g.velocity : 100,
        source: `${diff}:${g.lane}${kind ? "-" + kind : ""}${lane !== g.lane ? "-disco" : ""}`,
      };
    });
    out[diff] = dedupeNotes(sortNotes(notes));
  }
  if (!Object.keys(out).length) warnings.push("PART DRUMS contains no playable notes.");
  if (discoNotes) warnings.push(`Disco flip applied to ${discoNotes} notes (red and yellow swapped; event format unverified).`);
  return { format: "clonehero-mid", notesByDifficulty: out, meta: tempoMetaFromMidi(midi, tempo), warnings };
}
