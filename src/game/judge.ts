import type { NoteEvent } from "../chart/types";
import type { PieceId } from "../kit/types";

/** Timing windows in milliseconds (+- around the chart note). Adjustable. */
export interface JudgeWindows {
  perfect: number;
  good: number;
  ok: number;
}
export const DEFAULT_WINDOWS: Readonly<JudgeWindows> = { perfect: 35, good: 70, ok: 120 };

export type Judgement = "perfect" | "good" | "ok" | "miss";

/** Per-note state, shared with the renderer through `Judge.state`. */
export const NOTE_PENDING = 0;
export const NOTE_HIT = 1;
export const NOTE_MISSED = 2;

export interface JudgeEvent {
  kind: Judgement | "stray";
  piece: PieceId;
  /** Index into the note array (-1 for stray). */
  noteIndex: number;
  /** hit time minus note time in ms; negative = early. 0 for misses. */
  deltaMs: number;
  /** Combo after this event. */
  combo: number;
}

export interface PieceStats {
  perfect: number;
  good: number;
  ok: number;
  miss: number;
  stray: number;
  /** Sum of deltaMs over hit notes (mean = sumDelta / hits). */
  sumDelta: number;
}

export type Grade = "S" | "A" | "B" | "C" | "D" | "F";

export interface JudgeSummary {
  total: number;
  perfect: number;
  good: number;
  ok: number;
  miss: number;
  stray: number;
  maxCombo: number;
  /** 0..100, over notes resolved so far. */
  accuracy: number;
  grade: Grade;
  score: number;
  /** Mean timing error over hit notes in ms (negative = early). */
  meanDeltaMs: number;
  histogram: { min: number; max: number; bins: number[] };
  perPiece: { piece: PieceId; hits: number; total: number; accuracy: number; meanDeltaMs: number; stats: PieceStats }[];
}

const POINTS: Record<Judgement, number> = { perfect: 1, good: 0.75, ok: 0.5, miss: 0 };
const SCORE_BASE: Record<Judgement, number> = { perfect: 100, good: 75, ok: 50, miss: 0 };
export const HIST_BIN_MS = 20;
export const HIST_BINS = 12; // -120..+120

export function gradeFor(accuracy: number): Grade {
  if (accuracy >= 95) return "S";
  if (accuracy >= 88) return "A";
  if (accuracy >= 75) return "B";
  if (accuracy >= 60) return "C";
  if (accuracy >= 40) return "D";
  return "F";
}

export interface JudgeOptions {
  windows?: Partial<JudgeWindows>;
  /** Input latency offset in ms. Positive = the player's hits arrive late, so they are shifted earlier. */
  latencyMs?: number;
  onEvent?: (e: JudgeEvent) => void;
}

/**
 * Pure hit judging. `notes` must be sorted by timeSec; they are never mutated.
 * Each piece keeps a pointer to its first unresolved note, so hit() and update()
 * cost O(notes inside the OK window), not O(n).
 */
export class Judge {
  readonly state: Uint8Array;
  readonly windows: JudgeWindows;
  latencyMs: number;
  combo = 0;
  maxCombo = 0;
  private readonly notes: readonly NoteEvent[];
  private readonly byPiece = new Map<PieceId, Int32Array>();
  private readonly ptr = new Map<PieceId, number>();
  private readonly pieces: PieceId[] = [];
  private readonly stats = new Map<PieceId, PieceStats>();
  private readonly hist = new Array<number>(HIST_BINS).fill(0);
  private readonly counts = { perfect: 0, good: 0, ok: 0, miss: 0, stray: 0 };
  private points = 0;
  private score = 0;
  private resolved = 0;
  private sumDelta = 0;
  private hitCount = 0;
  private readonly onEvent?: (e: JudgeEvent) => void;

  constructor(notes: readonly NoteEvent[], opts: JudgeOptions = {}) {
    this.notes = notes;
    this.windows = { ...DEFAULT_WINDOWS, ...opts.windows };
    this.latencyMs = opts.latencyMs ?? 0;
    this.onEvent = opts.onEvent;
    this.state = new Uint8Array(notes.length);
    const lists = new Map<PieceId, number[]>();
    for (let i = 0; i < notes.length; i++) {
      const p = notes[i]!.piece;
      let l = lists.get(p);
      if (!l) lists.set(p, (l = []));
      l.push(i);
    }
    for (const [p, l] of lists) {
      this.byPiece.set(p, Int32Array.from(l));
      this.ptr.set(p, 0);
      this.pieces.push(p);
      this.stats.set(p, { perfect: 0, good: 0, ok: 0, miss: 0, stray: 0, sumDelta: 0 });
    }
  }

  get totalNotes(): number {
    return this.notes.length;
  }
  get finished(): boolean {
    return this.resolved >= this.notes.length;
  }

  /** Register a player hit. `songTimeSec` is the (unadjusted) song time of the hit. */
  hit(piece: PieceId, songTimeSec: number): JudgeEvent {
    const tMs = songTimeSec * 1000 - this.latencyMs;
    const list = this.byPiece.get(piece);
    let best = -1;
    let bestAbs = Infinity;
    let bestDelta = 0;
    if (list) {
      const ok = this.windows.ok;
      for (let j = this.ptr.get(piece)!; j < list.length; j++) {
        const idx = list[j]!;
        if (this.state[idx] !== NOTE_PENDING) continue;
        const d = tMs - this.notes[idx]!.timeSec * 1000;
        if (d < -ok) break; // sorted: every later note is even further in the future
        const a = Math.abs(d);
        if (a <= ok && a < bestAbs) {
          best = idx;
          bestAbs = a;
          bestDelta = d;
        }
      }
    }
    const st = this.stats.get(piece);
    if (best < 0) {
      this.counts.stray++;
      if (st) st.stray++;
      const ev: JudgeEvent = { kind: "stray", piece, noteIndex: -1, deltaMs: 0, combo: this.combo };
      this.onEvent?.(ev);
      return ev;
    }
    const w = this.windows;
    const kind: Judgement = bestAbs <= w.perfect ? "perfect" : bestAbs <= w.good ? "good" : "ok";
    this.state[best] = NOTE_HIT;
    this.resolve(piece, kind, bestDelta);
    const ev: JudgeEvent = { kind, piece, noteIndex: best, deltaMs: bestDelta, combo: this.combo };
    this.onEvent?.(ev);
    this.advance(piece);
    return ev;
  }

  /** Mark notes whose OK window has passed as missed. Call every frame with the current song time. */
  update(songTimeSec: number): void {
    const limitMs = songTimeSec * 1000 - this.latencyMs - this.windows.ok;
    for (const piece of this.pieces) {
      const list = this.byPiece.get(piece)!;
      let j = this.ptr.get(piece)!;
      while (j < list.length) {
        const idx = list[j]!;
        if (this.state[idx] === NOTE_PENDING) {
          if (this.notes[idx]!.timeSec * 1000 >= limitMs) break;
          this.state[idx] = NOTE_MISSED;
          this.resolve(piece, "miss", 0);
          this.onEvent?.({ kind: "miss", piece, noteIndex: idx, deltaMs: 0, combo: 0 });
        }
        j++;
      }
      this.ptr.set(piece, j);
    }
  }

  /** Resolve every remaining note as a miss (song end). */
  finish(): void {
    this.update(Infinity);
  }

  private advance(piece: PieceId): void {
    const list = this.byPiece.get(piece)!;
    let j = this.ptr.get(piece)!;
    while (j < list.length && this.state[list[j]!] !== NOTE_PENDING) j++;
    this.ptr.set(piece, j);
  }

  private resolve(piece: PieceId, kind: Judgement, delta: number): void {
    this.resolved++;
    this.counts[kind]++;
    this.points += POINTS[kind];
    const st = this.stats.get(piece)!;
    st[kind]++;
    if (kind === "miss") {
      this.combo = 0;
      return;
    }
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    const mult = Math.min(4, 1 + Math.floor(this.combo / 10));
    this.score += SCORE_BASE[kind] * mult;
    st.sumDelta += delta;
    this.sumDelta += delta;
    this.hitCount++;
    const half = (HIST_BINS * HIST_BIN_MS) / 2;
    const b = Math.max(0, Math.min(HIST_BINS - 1, Math.floor((delta + half) / HIST_BIN_MS)));
    this.hist[b]!++;
  }

  summary(): JudgeSummary {
    const accuracy = this.resolved > 0 ? (this.points / this.resolved) * 100 : 0;
    const perPiece = this.pieces.map((piece) => {
      const s = this.stats.get(piece)!;
      const hits = s.perfect + s.good + s.ok;
      const total = hits + s.miss;
      const pts = s.perfect + s.good * POINTS.good + s.ok * POINTS.ok;
      return {
        piece,
        hits,
        total,
        accuracy: total > 0 ? (pts / total) * 100 : 0,
        meanDeltaMs: hits > 0 ? s.sumDelta / hits : 0,
        stats: { ...s },
      };
    });
    return {
      total: this.notes.length,
      ...this.counts,
      maxCombo: this.maxCombo,
      accuracy,
      grade: gradeFor(accuracy),
      score: Math.round(this.score),
      meanDeltaMs: this.hitCount > 0 ? this.sumDelta / this.hitCount : 0,
      histogram: { min: -(HIST_BINS * HIST_BIN_MS) / 2, max: (HIST_BINS * HIST_BIN_MS) / 2, bins: [...this.hist] },
      perPiece,
    };
  }
}
