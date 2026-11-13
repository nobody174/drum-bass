import type { NoteEvent, SongMeta } from "../chart/types";
import type { TempoPoint } from "../chart/tempo";
import type { KitPreset, KitPiece, PieceId } from "../kit/types";

/** Notes sorted by time plus a lane per kit piece that actually appears (ordered like the kit, left to right). */
export interface Timeline {
  notes: NoteEvent[];
  lanes: KitPiece[];
  /** lane index per note (same indexing as `notes`). */
  laneOf: Uint8Array;
  /** note times in seconds (same indexing as `notes`). */
  times: Float64Array;
  lastTime: number;
}

/**
 * Drops notes for pieces the preset does not have (they could never be hit), sorts by time (stable),
 * and builds one lane per used piece ordered by the kit's x position.
 */
export function buildTimeline(allNotes: readonly NoteEvent[], preset: KitPreset): Timeline {
  const byId = new Map<PieceId, KitPiece>(preset.pieces.map((p) => [p.id, p]));
  const notes = allNotes.filter((n) => byId.has(n.piece)).sort((a, b) => a.timeSec - b.timeSec);
  const used = new Set(notes.map((n) => n.piece));
  const lanes = preset.pieces
    .filter((p) => used.has(p.id))
    .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const laneIdx = new Map<PieceId, number>(lanes.map((p, i) => [p.id, i]));
  const laneOf = new Uint8Array(notes.length);
  const times = new Float64Array(notes.length);
  for (let i = 0; i < notes.length; i++) {
    laneOf[i] = laneIdx.get(notes[i]!.piece)!;
    times[i] = notes[i]!.timeSec;
  }
  return { notes, lanes, laneOf, times, lastTime: notes.length ? notes[notes.length - 1]!.timeSec : 0 };
}

/** First index with times[i] >= t (binary search, no allocation). */
export function lowerBound(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Rough tempo guess for the count-in click: the most common gap between consecutive notes,
 * folded into 70..160 BPM. Falls back to 120.
 */
export function estimateBpm(notes: readonly NoteEvent[]): number {
  const bins = new Map<number, number>();
  for (let i = 1; i < notes.length; i++) {
    const g = notes[i]!.timeSec - notes[i - 1]!.timeSec;
    if (g < 0.12 || g > 1.2) continue;
    const k = Math.round(g * 100); // 10 ms bins
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  let bestK = 0;
  let bestN = 0;
  for (const [k, c] of bins) {
    if (c > bestN) {
      bestN = c;
      bestK = k;
    }
  }
  if (!bestK) return 120;
  let bpm = 60 / (bestK / 100);
  while (bpm < 70) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  return Math.round(bpm);
}

/** Tempo info for the count-in and the click-only metronome, with a fallback for songs stored before tempo maps existed. */
export function songTempo(
  meta: Pick<SongMeta, "tempoMap" | "startBpm" | "beatsPerBar">,
  notes: readonly NoteEvent[],
): { points: TempoPoint[]; startBpm: number; beatsPerBar: number } {
  const valid = meta.tempoMap?.filter((p) => p.bpm > 0 && Number.isFinite(p.bpm));
  const startBpm = meta.startBpm && meta.startBpm > 0 ? meta.startBpm : (valid?.[0]?.bpm ?? estimateBpm(notes));
  return {
    points: valid?.length ? valid : [{ timeSec: 0, bpm: startBpm }],
    startBpm,
    beatsPerBar: meta.beatsPerBar && meta.beatsPerBar >= 1 ? meta.beatsPerBar : 4,
  };
}

/** Beat number shown during the count-in: `beats` down to 1 (not seconds). `t` is song time (< 0). */
export function countInBeatNumber(t: number, beats: number, beatSec: number): number {
  if (!(beats > 0) || !(beatSec > 0)) return 0;
  return Math.min(beats, Math.max(1, Math.ceil(-t / beatSec - 1e-6)));
}
