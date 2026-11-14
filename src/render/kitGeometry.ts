import type { KitPiece } from "../kit/types";
import { lowerBound } from "../game/timeline";

/**
 * Pure geometry for the kit view (SPEC 6.2). No canvas, no game logic: everything here is a
 * function of song time, note times and the saved kit preset, so it can be unit tested.
 */

export const DEFAULT_APPROACH_SEC = 2.2;
export const MIN_APPROACH_SEC = 0.8;
export const MAX_APPROACH_SEC = 3.0;
/** Rings kept per piece in dense passages. */
export const DEFAULT_RINGS_PER_PIECE = 3;
/** Seconds after the note time during which a ring stays on screen (missed ones fade grey). */
export const RING_GRACE_SEC = 0.3;
/** Same stage proportions as the kit editor (src/kit/model.ts STAGE_ASPECT). */
export const KIT_STAGE_ASPECT = 16 / 9;

export function clampApproach(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_APPROACH_SEC;
  return Math.min(MAX_APPROACH_SEC, Math.max(MIN_APPROACH_SEC, v));
}

/** Extra pixels a ring starts outside the piece edge (at the start of the approach window). */
export function ringTravel(edgePx: number): number {
  return Math.max(edgePx * 1.1, 26);
}

/** 1 when the note enters the approach window, 0 at note time and afterwards (clamped). */
export function ringFraction(songTime: number, noteTime: number, approach: number): number {
  const f = (noteTime - songTime) / approach;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/**
 * Ring radius: linear shrink from `edge + travel` to exactly `edge` at note time; it stays at
 * `edge` afterwards. Computed from the song time only (no timers, no accumulated state).
 */
export function ringRadius(songTime: number, noteTime: number, approach: number, edge: number, travel: number): number {
  return edge + travel * ringFraction(songTime, noteTime, approach);
}

/** Ring stroke alpha: faint at the start of the window, strong near the piece. */
export function ringAlpha(fraction: number): number {
  return 0.22 + 0.78 * (1 - fraction);
}

/** Nearest ring is full strength; each further ring on the same piece fades out. */
export function rankAlpha(rank: number): number {
  return rank <= 0 ? 1 : 0.38 * Math.pow(0.6, rank - 1);
}

/** Stroke width (px): the next ring per piece is clearly thicker than the later, fainter ones. */
export function ringStroke(fraction: number, rank: number): number {
  return rank <= 0 ? 4 + 4 * (1 - fraction) : 1.6 + 1.2 * (1 - fraction);
}

/** Glow blur (px) of the next ring only; later rings have none. */
export function ringGlow(fraction: number, rank: number): number {
  return rank <= 0 ? 6 + 8 * (1 - fraction) : 0;
}

/** Seconds before a note during which the piece rim pulses ("get ready"). */
export const READY_SEC = 0.4;

/** Soft rim pulse 0..1: two gentle beats in the last READY_SEC before the note, fading in; 0 outside. */
export function readyPulse(songTime: number, noteTime: number): number {
  const dt = noteTime - songTime;
  if (dt > READY_SEC || dt < -0.05) return 0;
  const u = 1 - Math.max(0, dt) / READY_SEC; // 0 -> 1 towards the note
  return (0.5 - 0.5 * Math.cos(u * Math.PI * 4)) * (0.35 + 0.65 * u);
}

/** Approach control step: +/- 0.2 s, rounded to 0.1 s, clamped to 0.8..3.0. */
export function stepApproach(current: number, dir: 1 | -1): number {
  return clampApproach(Math.round((clampApproach(current) + dir * 0.2) * 10) / 10);
}

/** First index with times[i] > t. */
export function upperBound(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index range [from, to) of notes whose ring is (or just was) on screen. */
export function windowStart(times: Float64Array, songTime: number, grace = RING_GRACE_SEC): number {
  return lowerBound(times, songTime - grace);
}
export function windowEnd(times: Float64Array, songTime: number, approach: number): number {
  return upperBound(times, songTime + approach);
}

/** Preallocated output of {@link selectRings}. */
export interface RingSelection {
  count: number;
  /** Note index per selected ring. */
  idx: Int32Array;
  /** 0 = nearest pending ring of its piece. Missed notes get rank 0 and are flagged by their state. */
  rank: Uint8Array;
  /** Scratch: pending rings seen per lane. */
  perLane: Uint8Array;
}

export function createRingSelection(nLanes: number, maxPerLane: number): RingSelection {
  const cap = nLanes * (maxPerLane + 4) + 16;
  return { count: 0, idx: new Int32Array(cap), rank: new Uint8Array(cap), perLane: new Uint8Array(nLanes) };
}

/**
 * Walks notes [from, to) in time order and keeps the nearest `maxPerLane` pending notes per lane
 * (hit notes are gone, missed notes are kept without using up the quota so they can fade out).
 * state: 0 pending, 1 hit, 2 missed. Allocation free.
 */
export function selectRings(
  laneOf: Uint8Array,
  state: Uint8Array,
  from: number,
  to: number,
  maxPerLane: number,
  out: RingSelection,
): number {
  out.perLane.fill(0);
  let n = 0;
  const cap = out.idx.length;
  for (let i = from; i < to && n < cap; i++) {
    const st = state[i]!;
    if (st === 1) continue;
    if (st === 2) {
      out.idx[n] = i;
      out.rank[n++] = 0;
      continue;
    }
    const lane = laneOf[i]!;
    const r = out.perLane[lane]!;
    if (r >= maxPerLane) continue;
    out.perLane[lane] = r + 1;
    out.idx[n] = i;
    out.rank[n++] = r;
  }
  out.count = n;
  return n;
}

/** Largest rectangle with the stage aspect that fits in w x h, centred (below a top inset for the progress bar). */
export function fitStage(w: number, h: number, topInset = 6, aspect = KIT_STAGE_ASPECT): { x: number; y: number; w: number; h: number } {
  const availH = Math.max(1, h - topInset);
  let sw = w;
  let sh = w / aspect;
  if (sh > availH) {
    sh = availH;
    sw = sh * aspect;
  }
  return { x: (w - sw) / 2, y: topInset + (availH - sh) / 2, w: sw, h: sh };
}

export interface PieceGeo {
  cx: number;
  cy: number;
  /** Half extents (px) of the edge ring that rings shrink onto. */
  rx: number;
  ry: number;
}

const CYMBAL_FLAT = 0.55;

/**
 * Pixel geometry of a piece on the stage rect. Positions are used exactly as stored: the preset's
 * `mirrored` flag is already baked into `piece.x` by the model (setMirrored), same as the editor.
 */
export function pieceGeo(p: KitPiece, stage: { x: number; y: number; w: number; h: number }): PieceGeo {
  const r = (p.size * stage.h) / 2;
  if (p.kind === "pedal") return { cx: stage.x + p.x * stage.w, cy: stage.y + p.y * stage.h, rx: r * 0.7, ry: r * 0.9 };
  return {
    cx: stage.x + p.x * stage.w,
    cy: stage.y + p.y * stage.h,
    rx: r,
    ry: p.kind === "cymbal" ? r * CYMBAL_FLAT : r,
  };
}

/** Piece glow 0..1 as the nearest pending note approaches (ramps up over 0.2 s, holds until 0.1 s after). */
export function litAmount(songTime: number, noteTime: number): number {
  const dt = noteTime - songTime;
  if (dt > 0.2 || dt < -0.1) return 0;
  return dt >= 0 ? 1 - dt / 0.2 : 1;
}
