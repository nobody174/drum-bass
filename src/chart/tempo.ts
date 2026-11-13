/** Tempo map: ticks -> seconds with any number of tempo changes. Pure, no deps. */

export interface TempoChange {
  tick: number;
  /** Microseconds per quarter note (the SMF set-tempo unit). 500000 = 120 BPM. */
  usPerQuarter: number;
}

/** Compact tempo point in chart seconds (what SongMeta stores). */
export interface TempoPoint {
  timeSec: number;
  bpm: number;
}

export interface TempoMap {
  readonly ppq: number;
  /** Tempo changes as {timeSec,bpm}; first point is at 0, consecutive equal tempos are merged. */
  readonly points: TempoPoint[];
  ticksToSeconds(tick: number): number;
  secondsToTicks(sec: number): number;
  /** BPM in effect at the given tick. */
  bpmAt(tick: number): number;
}

export const DEFAULT_US_PER_QUARTER = 500000;

export const bpmToUsPerQuarter = (bpm: number): number => 60_000_000 / bpm;
export const usPerQuarterToBpm = (us: number): number => 60_000_000 / us;

interface Segment {
  tick: number;
  sec: number;
  usPerTick: number;
}

export function createTempoMap(ppq: number, changes: TempoChange[]): TempoMap {
  if (!(ppq > 0)) throw new Error(`Invalid ppq: ${ppq}`);
  // Sort, drop invalid, last change wins when several share a tick.
  const byTick = new Map<number, number>();
  for (const c of [...changes].sort((a, b) => a.tick - b.tick)) {
    if (!(c.usPerQuarter > 0) || !Number.isFinite(c.usPerQuarter) || c.tick < 0) continue;
    byTick.set(c.tick, c.usPerQuarter);
  }
  if (!byTick.has(0)) byTick.set(0, DEFAULT_US_PER_QUARTER);
  const ticks = [...byTick.keys()].sort((a, b) => a - b);

  const segs: Segment[] = [];
  let sec = 0;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!;
    const usPerTick = byTick.get(t)! / ppq;
    if (i > 0) {
      const prev = segs[i - 1]!;
      sec = prev.sec + ((t - prev.tick) * prev.usPerTick) / 1e6;
    }
    segs.push({ tick: t, sec, usPerTick });
  }

  const find = (key: "tick" | "sec", v: number): Segment => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid]![key] <= v) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo]!;
  };

  const points: TempoPoint[] = [];
  for (const sg of segs) {
    const bpm = Math.round(((60_000_000 / (sg.usPerTick * ppq)) * 1000)) / 1000;
    if (points.length && points[points.length - 1]!.bpm === bpm) continue;
    points.push({ timeSec: Math.round(sg.sec * 1e6) / 1e6, bpm });
  }

  return {
    ppq,
    points,
    ticksToSeconds(tick) {
      const t = Math.max(0, tick);
      const s = find("tick", t);
      return s.sec + ((t - s.tick) * s.usPerTick) / 1e6;
    },
    secondsToTicks(sec_) {
      const v = Math.max(0, sec_);
      const s = find("sec", v);
      return s.tick + ((v - s.sec) * 1e6) / s.usPerTick;
    },
    bpmAt(tick) {
      return 60_000_000 / (find("tick", Math.max(0, tick)).usPerTick * ppq);
    },
  };
}

/** BPM in effect at chart time `sec` (falls back to 120 for an empty list). */
export function bpmAtTime(points: readonly TempoPoint[], sec: number): number {
  let bpm = points[0]?.bpm ?? 120;
  for (const p of points) {
    if (p.timeSec <= sec) bpm = p.bpm;
    else break;
  }
  return bpm > 0 ? bpm : 120;
}

/** Beat grid over a tempo map: beat k is the k-th beat from time 0, tempo changes honoured. */
export interface BeatGrid {
  readonly beatsPerBar: number;
  timeOfBeat(k: number): number;
  /** Index of the first beat at or after `sec` (>= 0). */
  firstBeatAtOrAfter(sec: number): number;
  isAccent(k: number): boolean;
}

export function createBeatGrid(points: readonly TempoPoint[], beatsPerBar = 4): BeatGrid {
  const valid = points
    .filter((p) => p.bpm > 0 && Number.isFinite(p.bpm) && Number.isFinite(p.timeSec) && p.timeSec >= 0)
    .sort((a, b) => a.timeSec - b.timeSec);
  if (!valid.length) valid.push({ timeSec: 0, bpm: 120 });
  if (valid[0]!.timeSec > 0) valid.unshift({ timeSec: 0, bpm: valid[0]!.bpm });
  const segs: { sec: number; bpm: number; beat: number }[] = [];
  let beat = 0;
  for (let i = 0; i < valid.length; i++) {
    if (i > 0) beat += ((valid[i]!.timeSec - valid[i - 1]!.timeSec) * valid[i - 1]!.bpm) / 60;
    segs.push({ sec: valid[i]!.timeSec, bpm: valid[i]!.bpm, beat });
  }
  const bar = beatsPerBar >= 1 ? Math.round(beatsPerBar) : 4;
  const find = (key: "sec" | "beat", v: number) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid]![key] <= v) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo]!;
  };
  return {
    beatsPerBar: bar,
    timeOfBeat(k) {
      const s = find("beat", k);
      return s.sec + ((k - s.beat) * 60) / s.bpm;
    },
    firstBeatAtOrAfter(sec) {
      const t = Math.max(0, sec);
      const s = find("sec", t);
      return Math.max(0, Math.ceil(s.beat + ((t - s.sec) * s.bpm) / 60 - 1e-9));
    },
    isAccent: (k) => k % bar === 0,
  };
}

/** Quarter-note beats per bar for a time signature (6/8 -> 3, 4/4 -> 4, 7/8 -> 4). Invalid input gives 4. */
export function beatsPerBarOf(numerator: number, denominator: number): number {
  if (!(numerator > 0) || !(denominator > 0)) return 4;
  return Math.max(1, Math.round((numerator * 4) / denominator));
}
