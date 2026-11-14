import { describe, expect, it } from "vitest";
import {
  analyzeHits,
  calibrate,
  clickSchedule,
  estimateClockOffsetMs,
  mad,
  mean,
  median,
  offsetToApply,
  pairHits,
  retuneOutput,
  applyProblem,
  LATENCY_LIMIT_MS,
} from "./calibration";
import { Judge } from "../game/judge";
import { TIMING_WINDOWS } from "../settings/store";

/** Deterministic pseudo-random in [-1,1]. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s / 4294967296) * 2 - 1;
  };
}

const CLOCK = 5000.37; // perf ms minus ctx ms
function taps(delayMs: number, jitterMs = 0, seed = 1, n = 16): { perf: number[]; clicks: number[] } {
  const clicks = clickSchedule(1, 90, n).map((c) => c.time);
  const r = rng(seed);
  return { clicks, perf: clicks.map((c) => c * 1000 + CLOCK + delayMs + r() * jitterMs) };
}

describe("stats", () => {
  it("median/mean/mad", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(mean([1, 2, 3])).toBe(2);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
});

describe("clock offset", () => {
  it("takes the minimum so quantised ctx times do not bias it", () => {
    const pairs = [0, 1, 2, 3].map((i) => ({ ctxSec: i, perfMs: i * 1000 + 100 + i * 2 }));
    expect(estimateClockOffsetMs(pairs)).toBe(100);
    expect(estimateClockOffsetMs([])).toBeNaN();
  });
});

describe("clickSchedule", () => {
  it("is 16 clicks at 90 BPM with accent on 1", () => {
    const s = clickSchedule(2);
    expect(s).toHaveLength(16);
    expect(s[1]!.time - s[0]!.time).toBeCloseTo(60 / 90, 9);
    expect(s.map((c) => c.accent).slice(0, 5)).toEqual([true, false, false, false, true]);
  });
});

describe("round trip sign convention", () => {
  it("hits that arrive 80 ms late give +80 and the Judge then scores them as perfect", () => {
    const { perf, clicks } = taps(80);
    const res = calibrate(perf, clicks, CLOCK);
    expect(res.verdict).toBe("good");
    expect(res.offsetMs).toBe(80);
    const note = { timeSec: 10, piece: "snare" } as never;
    const raw = 10 + 0.08; // song time stamped 80 ms late
    const without = new Judge([note]).hit("snare" as never, raw);
    expect(without.kind).toBe("ok");
    const withOffset = new Judge([note], { latencyMs: res.offsetMs, windows: TIMING_WINDOWS.normal }).hit("snare" as never, raw);
    expect(withOffset.kind).toBe("perfect");
    expect(withOffset.deltaMs).toBeCloseTo(0, 6);
  });

  it("hits that are EARLY give a negative offset", () => {
    const { perf, clicks } = taps(-40);
    expect(calibrate(perf, clicks, CLOCK).offsetMs).toBe(-40);
  });

  it("applying subtracts the manual output latency, which Play already removes from song time", () => {
    expect(offsetToApply(80, 0)).toBe(80);
    expect(offsetToApply(80, 30)).toBe(50);
  });
});

describe("robustness", () => {
  it("jitter of +-15 ms still recovers the delay within a few ms and is good", () => {
    const { perf, clicks } = taps(60, 30, 7);
    const res = calibrate(perf, clicks, CLOCK);
    expect(res.verdict).toBe("good");
    expect(Math.abs(res.offsetMs - 60)).toBeLessThanOrEqual(8);
  });

  it("drops the first 4 hits (warm-up) and gross outliers", () => {
    const { perf, clicks } = taps(50);
    perf[0]! += 200; // warm-up garbage
    perf[1]! += 200;
    perf[9]! += 180; // outlier inside +-250 but far from the cluster
    const res = calibrate(perf, clicks, CLOCK);
    expect(res.offsetMs).toBe(50);
    expect(res.used).toBe(11); // 16 - 4 warm-up - 1 outlier
  });

  it("discards hits beyond the 400 ms hard cap", () => {
    const paired = [{ hitCtxMs: 0, clickIndex: 5, errorMs: 450 }];
    expect(analyzeHits(paired, 0).used).toBe(0);
  });

  it("a consistently 300 ms late (Bluetooth) user still calibrates", () => {
    const { perf, clicks } = taps(300, 20, 5);
    const res = calibrate(perf, clicks, CLOCK);
    expect(res.verdict).toBe("good");
    expect(Math.abs(res.offsetMs - 300)).toBeLessThanOrEqual(10);
    expect(res.used).toBeGreaterThanOrEqual(10);
  });

  it("warm-up is skipped by click index, not by hit count", () => {
    const { perf, clicks } = taps(50);
    // user missed clicks 0-3 entirely: only hits for clicks 4.. exist and all must count
    const res = calibrate(perf.slice(4), clicks, CLOCK);
    expect(res.used).toBe(12);
    // a user who only hit clicks 0-5: just 2 count (clicks 4, 5)
    const early = analyzeHits(pairHits(perf.slice(0, 6), clicks, CLOCK));
    expect(early.used).toBe(2);
  });

  it("keeps only the closest hit per click (double taps)", () => {
    const clicks = clickSchedule(1).map((c) => c.time);
    const p = pairHits([clicks[5]! * 1000 + CLOCK + 90, clicks[5]! * 1000 + CLOCK + 20], clicks, CLOCK);
    expect(p).toHaveLength(1);
    expect(p[0]!.errorMs).toBeCloseTo(20, 6);
  });

  it("empty or too few hits give too-few and NaN offset", () => {
    expect(calibrate([], [1, 2], CLOCK).verdict).toBe("too-few");
    const { perf, clicks } = taps(40);
    const few = calibrate(perf.slice(0, 8), clicks, CLOCK); // 8 hits - 4 warm-up = 4 < 6
    expect(few.verdict).toBe("too-few");
    expect(few.offsetMs).toBeNaN();
    expect(pairHits([1], [], CLOCK)).toEqual([]);
    expect(pairHits([1], [1], NaN)).toEqual([]);
  });

  it("very uneven hitting is flagged noisy", () => {
    const { perf, clicks } = taps(0, 200, 3); // +-100 ms jitter, sd about 58
    const res = calibrate(perf, clicks, CLOCK);
    expect(res.verdict).toBe("noisy");
    expect(res.spreadMs).toBeGreaterThan(25);
  });
});

describe("output latency tuner keeps the compensation sum", () => {
  it("moving output by D moves input by -D, so judged timing of a fixed player is unchanged", () => {
    const note = { timeSec: 10, piece: "snare" } as never;
    const raw = 10 + 0.062; // fixed player stamped 62 ms late
    const judged = (inp: number, out: number) => {
      // Play: songTime = ctx - output; the judge then subtracts input.
      const r = new Judge([note], { latencyMs: inp, windows: TIMING_WINDOWS.normal }).hit("snare" as never, raw - out / 1000);
      return r.deltaMs;
    };
    const start = { in: 50, out: 12 };
    const base = judged(start.in, start.out);
    for (const target of [0, 30, -20, 120]) {
      const r = retuneOutput(start.in, start.out, target);
      expect(r.outputLatencyMs).toBe(target);
      expect(r.inputLatencyMs + r.outputLatencyMs).toBe(start.in + start.out);
      expect(judged(r.inputLatencyMs, r.outputLatencyMs)).toBeCloseTo(base!, 6);
    }
  });

  it("clamps so neither value leaves the range and the sum still holds", () => {
    const r = retuneOutput(-450, 0, 200);
    expect(r.inputLatencyMs).toBeGreaterThanOrEqual(-LATENCY_LIMIT_MS);
    expect(r.inputLatencyMs + r.outputLatencyMs).toBe(-450);
    const r2 = retuneOutput(0, 490, 900);
    expect(r2.outputLatencyMs).toBe(500);
    expect(r2.inputLatencyMs + r2.outputLatencyMs).toBe(490);
  });

  it("applyProblem flags values the store would clamp", () => {
    expect(applyProblem(120)).toBeNull();
    expect(applyProblem(500)).toBeNull();
    expect(applyProblem(501)).toMatch(/not applied/);
    expect(applyProblem(NaN)).not.toBeNull();
  });
});
