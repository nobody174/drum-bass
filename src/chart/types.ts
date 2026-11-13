import type { PieceId } from "../kit/types";
import type { TempoPoint } from "./tempo";

/** A single chart note, already converted to seconds with the tempo map applied. */
export interface NoteEvent {
  timeSec: number;
  piece: PieceId;
  velocity: number; // 1..127
  /** Original chart lane/note for debugging, e.g. "yellow-cymbal" or "gm:42". */
  source?: string;
}

export type Difficulty = "easy" | "medium" | "hard" | "expert";

export type ChartFormat = "clonehero-mid" | "clonehero-chart" | "gm-midi";

export interface SongMeta {
  title: string;
  artist: string;
  album?: string;
  year?: string;
  charter?: string;
  /** song.ini `delay` (ms): shifts audio relative to chart. Default 0. */
  delayMs: number;
  lengthSec?: number;
  /** Additive (M2 review). Chart tempo map in chart seconds. Absent on songs stored before this field existed. */
  tempoMap?: TempoPoint[];
  /** BPM at the first drum note (count-in tempo). Absent on older songs: fall back to estimateBpm. */
  startBpm?: number;
  /** Beats per bar from the first time signature (default 4 when absent). Later changes are ignored. */
  beatsPerBar?: number;
}

export type StemRole =
  | "drums" | "song" | "guitar" | "bass" | "vocals" | "rhythm" | "keys" | "crowd" | "full" | "other";

export interface ImportedAudio {
  name: string;
  role: StemRole;
  blob: Blob;
}

/** Output of the importer. Canonical pieces; remap to the user's kit with remapToKit(). */
export interface ImportedSong {
  meta: SongMeta;
  format: ChartFormat;
  notesByDifficulty: Partial<Record<Difficulty, NoteEvent[]>>;
  audio: ImportedAudio[];
  /** Human-readable problems (missing audio, unknown notes, ...). Never throw for these. */
  warnings: string[];
}

/** Additive (M2): result of a single chart-file parser (.mid / .chart). */
export interface ParsedChart {
  format: ChartFormat;
  notesByDifficulty: Partial<Record<Difficulty, NoteEvent[]>>;
  /** Metadata found inside the chart file itself (e.g. `.chart` [Song]); song.ini wins when present. */
  meta: Partial<SongMeta>;
  warnings: string[];
}
