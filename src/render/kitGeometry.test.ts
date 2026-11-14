import { describe, expect, it } from "vitest";
import { createDefaultPreset, setMirrored } from "../kit";
import {
  MAX_APPROACH_SEC, MIN_APPROACH_SEC, clampApproach, createRingSelection, fitStage, litAmount, pieceGeo, rankAlpha,
  ringAlpha, ringFraction, ringGlow, ringStroke, readyPulse, stepApproach, DEFAULT_APPROACH_SEC, ringRadius, ringTravel, selectRings, upperBound, windowEnd, windowStart,
} from "./kitGeometry";

describe("ring radius", () => {
  const edge = 40;
  const travel = ringTravel(edge);
  it("reaches the piece edge exactly at note time and never goes below", () => {
    expect(ringRadius(10, 10, 1.5, edge, travel)).toBe(edge);
    expect(ringRadius(10.2, 10, 1.5, edge, travel)).toBe(edge);
  });
  it("starts at edge + travel when the note enters the approach window", () => {
    expect(ringRadius(8.5, 10, 1.5, edge, travel)).toBeCloseTo(edge + travel, 10);
    expect(ringRadius(0, 10, 1.5, edge, travel)).toBeCloseTo(edge + travel, 10);
  });
  it("shrinks linearly with time", () => {
    const a = ringRadius(9.0, 10, 2, edge, travel);
    const b = ringRadius(9.5, 10, 2, edge, travel);
    const c = ringRadius(10.0, 10, 2, edge, travel);
    expect(a - b).toBeCloseTo(b - c, 10);
    expect(a).toBeCloseTo(edge + travel * 0.5, 10);
  });
  it("is a pure function of time (no state between calls)", () => {
    const x = ringRadius(9.3, 10, 1.5, edge, travel);
    ringRadius(5, 10, 1.5, edge, travel);
    expect(ringRadius(9.3, 10, 1.5, edge, travel)).toBe(x);
  });
  it("ring fraction is clamped to 0..1 and alpha grows near the piece", () => {
    expect(ringFraction(0, 10, 1.5)).toBe(1);
    expect(ringFraction(11, 10, 1.5)).toBe(0);
    expect(ringAlpha(0)).toBeGreaterThan(ringAlpha(0.5));
    expect(ringAlpha(0.5)).toBeGreaterThan(ringAlpha(1));
  });
  it("travel has a floor for tiny pieces", () => {
    expect(ringTravel(3)).toBeGreaterThanOrEqual(26);
  });
  it("clamps the approach time to 0.8..2.5 s", () => {
    expect(clampApproach(0.1)).toBe(MIN_APPROACH_SEC);
    expect(clampApproach(9)).toBe(MAX_APPROACH_SEC);
    expect(clampApproach(1.2)).toBe(1.2);
    expect(clampApproach(NaN)).toBe(2.2);
  });
});

describe("visible window", () => {
  const times = Float64Array.from([0.5, 1, 1, 2, 3.2, 4, 10]);
  it("upperBound is the first index strictly after t", () => {
    expect(upperBound(times, 1)).toBe(3);
    expect(upperBound(times, 0)).toBe(0);
    expect(upperBound(times, 99)).toBe(times.length);
  });
  it("selects notes from just-past (grace) to the approach horizon", () => {
    const t = 1.1;
    const from = windowStart(times, t, 0.3); // >= 0.8: skips 0.5
    const to = windowEnd(times, t, 1.5); // <= 2.6
    expect(from).toBe(1);
    expect(to).toBe(4);
    expect([...times.slice(from, to)]).toEqual([1, 1, 2]);
  });
  it("a note at exactly t + approach is included, just beyond is not", () => {
    expect(windowEnd(times, 2.5, 1.5)).toBe(upperBound(times, 4));
    expect(windowEnd(times, 2.49, 1.5)).toBe(5); // 4.0 is just beyond 3.99
  });
  it("handles an empty chart", () => {
    const e = new Float64Array(0);
    expect(windowStart(e, 0)).toBe(0);
    expect(windowEnd(e, 0, 1.5)).toBe(0);
  });
});

describe("nearest-N per piece", () => {
  const times = Float64Array.from([1.0, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5]);
  const laneOf = new Uint8Array(times.length);
  laneOf[3] = 1; // the 1.25 note is on lane 1, the rest on lane 0
  it("keeps only the nearest N pending rings per lane, ranked by time", () => {
    const sel = createRingSelection(2, 3);
    const n = selectRings(laneOf, new Uint8Array(times.length), 0, times.length, 3, sel);
    expect(n).toBe(4); // 3 of lane 0 + 1 of lane 1
    const picked = [...sel.idx.slice(0, n)];
    expect(picked.filter((i) => laneOf[i] === 0).map((i) => times[i])).toEqual([1.0, 1.1, 1.2]);
    const ranks = [...sel.rank.slice(0, n)].filter((_, k) => laneOf[sel.idx[k]!] === 0);
    expect(ranks).toEqual([0, 1, 2]);
  });
  it("skips hit notes, keeps missed ones without using the quota", () => {
    const st = new Uint8Array(times.length);
    st[0] = 1; // hit
    st[1] = 2; // missed
    const sel = createRingSelection(2, 2);
    const n = selectRings(laneOf, st, 0, times.length, 2, sel);
    const picked = [...sel.idx.slice(0, n)];
    expect(picked).not.toContain(0);
    expect(picked).toContain(1);
    expect(picked.filter((i) => laneOf[i] === 0 && st[i] === 0)).toHaveLength(2);
  });
  it("alpha decreases with rank", () => {
    expect(rankAlpha(0)).toBe(1);
    expect(rankAlpha(1)).toBeLessThan(rankAlpha(0));
    expect(rankAlpha(2)).toBeLessThan(rankAlpha(1));
  });
  it("never writes past the preallocated buffers", () => {
    const sel = createRingSelection(1, 3);
    const st = new Uint8Array(500).fill(2);
    expect(selectRings(new Uint8Array(500), st, 0, 500, 3, sel)).toBeLessThanOrEqual(sel.idx.length);
  });
});

describe("stage fit and piece geometry", () => {
  it("fits a 16:9 stage into a wide and into a tall canvas", () => {
    const wide = fitStage(800, 296, 6);
    expect(wide.h).toBeCloseTo(290, 5);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9, 5);
    expect(wide.x).toBeCloseTo((800 - wide.w) / 2, 5);
    const tall = fitStage(360, 600, 6);
    expect(tall.w).toBe(360);
    expect(tall.h).toBeCloseTo(202.5, 5);
  });
  it("mirrored presets are drawn as stored: mirror image around the stage centre", () => {
    const base = createDefaultPreset();
    const mir = setMirrored(base, true);
    const stage = fitStage(800, 300);
    for (const p of base.pieces) {
      const q = mir.pieces.find((x) => x.id === p.id)!;
      const a = pieceGeo(p, stage);
      const b = pieceGeo(q, stage);
      expect(a.cx + b.cx).toBeCloseTo(2 * (stage.x + stage.w / 2), 6);
      expect(b.cy).toBeCloseTo(a.cy, 6);
      expect(b.rx).toBeCloseTo(a.rx, 6);
    }
    const snare = mir.pieces.find((p) => p.id === "snare")!;
    expect(pieceGeo(snare, stage).cx).toBeCloseTo(stage.x + snare.x * stage.w, 9);
  });
  it("cymbals are flat ellipses, drums circles, the kick a pedal bar", () => {
    const stage = { x: 0, y: 0, w: 1600, h: 900 };
    const preset = createDefaultPreset();
    const by = (id: string) => pieceGeo(preset.pieces.find((p) => p.id === id)!, stage);
    expect(by("snare").rx).toBe(by("snare").ry);
    expect(by("ride").ry).toBeLessThan(by("ride").rx);
    expect(by("kick").ry).toBeGreaterThan(by("kick").rx);
  });
  it("lights a piece shortly before and just after the note time", () => {
    expect(litAmount(9, 10)).toBe(0);
    expect(litAmount(9.9, 10)).toBeGreaterThan(0);
    expect(litAmount(10.05, 10)).toBe(1);
    expect(litAmount(10.5, 10)).toBe(0);
  });
});

describe("readability helpers", () => {
  it("default approach is 2.2 s, max 3.0 s", () => {
    expect(DEFAULT_APPROACH_SEC).toBe(2.2);
    expect(MAX_APPROACH_SEC).toBe(3);
  });
  it("next ring is stronger, thicker and glows; later rings are fainter", () => {
    expect(rankAlpha(1)).toBeLessThan(0.5);
    expect(rankAlpha(2)).toBeLessThan(rankAlpha(1));
    expect(ringStroke(0.5, 0)).toBeGreaterThan(ringStroke(0.5, 1) * 1.5);
    expect(ringGlow(0.5, 0)).toBeGreaterThan(0);
    expect(ringGlow(0.5, 1)).toBe(0);
  });
  it("ready pulse only in the last 0.4 s, stays within 0..1", () => {
    expect(readyPulse(0, 1)).toBe(0);
    expect(readyPulse(0.5, 1)).toBe(0);
    expect(readyPulse(1.2, 1)).toBe(0);
    let max = 0;
    for (let t = 0.6; t <= 1; t += 0.01) { const p = readyPulse(t, 1); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); max = Math.max(max, p); }
    expect(max).toBeGreaterThan(0.3);
  });
  it("stepApproach moves 0.2 s and clamps to 0.8..3.0", () => {
    expect(stepApproach(2.2, 1)).toBe(2.4);
    expect(stepApproach(2.2, -1)).toBe(2);
    expect(stepApproach(3, 1)).toBe(3);
    expect(stepApproach(0.8, -1)).toBe(0.8);
    expect(stepApproach(1.5, 1)).toBe(1.7);
  });
});
