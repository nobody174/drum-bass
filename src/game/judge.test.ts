import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../chart/types";
import { Judge, NOTE_HIT, NOTE_MISSED, gradeFor, type JudgeEvent } from "./judge";
import { buildTimeline, estimateBpm, lowerBound } from "./timeline";
import { createDefaultPreset } from "../kit/model";

const n = (timeSec: number, piece: NoteEvent["piece"] = "snare"): NoteEvent => ({ timeSec, piece, velocity: 100 });
const sorted = (a: NoteEvent[]) => a.sort((x, y) => x.timeSec - y.timeSec);

describe("Judge windows", () => {
  it("classifies perfect / good / ok / outside", () => {
    const j = new Judge([n(1), n(2), n(3), n(4)]);
    expect(j.hit("snare", 1.03).kind).toBe("perfect");
    expect(j.hit("snare", 2.06).kind).toBe("good");
    expect(j.hit("snare", 3 - 0.11).kind).toBe("ok");
    expect(j.hit("snare", 4.2).kind).toBe("stray");
  });
  it("reports signed delta (negative = early)", () => {
    const j = new Judge([n(1)]);
    expect(j.hit("snare", 0.98).deltaMs).toBeCloseTo(-20, 6);
  });
  it("honours custom windows", () => {
    const j = new Judge([n(1)], { windows: { perfect: 10 } });
    expect(j.hit("snare", 1.02).kind).toBe("good");
  });
  it("applies the latency offset", () => {
    const j = new Judge([n(1)], { latencyMs: 50 });
    expect(j.hit("snare", 1.05).kind).toBe("perfect");
  });
});

describe("Judge matching", () => {
  it("matches the nearest unmatched note of the same piece only", () => {
    const j = new Judge(sorted([n(1, "snare"), n(1.05, "snare"), n(1.02, "kick")]));
    const e = j.hit("snare", 1.06);
    expect(e.kind).toBe("perfect");
    expect(e.deltaMs).toBeCloseTo(10, 6);
    expect(j.hit("snare", 1.06).kind).toBe("good"); // remaining snare note at 1.0 is 60 ms away
    expect(j.hit("snare", 1.06).kind).toBe("stray");
  });
  it("stray hits do not break the combo or count as misses", () => {
    const j = new Judge([n(1), n(2)]);
    j.hit("snare", 1);
    j.hit("kick", 1.5); // piece not in chart
    j.hit("snare", 1.5);
    j.hit("snare", 2);
    const s = j.summary();
    expect(s.stray).toBe(2);
    expect(s.maxCombo).toBe(2);
    expect(s.miss).toBe(0);
    expect(s.accuracy).toBe(100);
  });
});

describe("Judge misses and scoring", () => {
  it("marks notes missed only after time + OK window", () => {
    const ev: JudgeEvent[] = [];
    const j = new Judge([n(1)], { onEvent: (e) => ev.push(e) });
    j.update(1.1);
    expect(j.state[0]).not.toBe(NOTE_MISSED);
    j.update(1.13);
    expect(j.state[0]).toBe(NOTE_MISSED);
    expect(ev.at(-1)?.kind).toBe("miss");
    expect(j.hit("snare", 1.14).kind).toBe("stray");
  });
  it("tracks combo, max combo and resets on miss", () => {
    const j = new Judge([n(1), n(2), n(3), n(4)]);
    j.hit("snare", 1);
    j.hit("snare", 2);
    j.update(3.5); // miss at 3
    expect(j.combo).toBe(0);
    j.hit("snare", 4);
    const s = j.summary();
    expect(s.maxCombo).toBe(2);
    expect(s.miss).toBe(1);
    expect(s.accuracy).toBeCloseTo(75, 6);
    expect(s.grade).toBe("B");
  });
  it("finish() resolves everything and a hit note is never missed", () => {
    const j = new Judge([n(1), n(2)]);
    j.hit("snare", 1);
    j.finish();
    expect(j.state[0]).toBe(NOTE_HIT);
    expect(j.state[1]).toBe(NOTE_MISSED);
    expect(j.finished).toBe(true);
  });
  it("builds a timing histogram and per-piece tendency", () => {
    const j = new Judge(sorted([n(1), n(2), n(3, "kick")]));
    j.hit("snare", 0.97);
    j.hit("snare", 1.97);
    j.hit("kick", 3.02);
    const s = j.summary();
    expect(s.histogram.bins.reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.perPiece.find((p) => p.piece === "snare")!.meanDeltaMs).toBeCloseTo(-30, 6);
    expect(s.perPiece.find((p) => p.piece === "kick")!.meanDeltaMs).toBeGreaterThan(0);
  });
  it("is fast on large charts (no quadratic scans)", () => {
    const notes: NoteEvent[] = [];
    for (let i = 0; i < 20000; i++) notes.push(n(i * 0.1));
    const j = new Judge(notes);
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) {
      j.hit("snare", i * 0.1 + 0.01);
      j.update(i * 0.1);
    }
    expect(performance.now() - t0).toBeLessThan(500);
    expect(j.summary().perfect).toBe(20000);
  });
});

describe("grades", () => {
  it("maps accuracy to letters", () => {
    expect(gradeFor(100)).toBe("S");
    expect(gradeFor(90)).toBe("A");
    expect(gradeFor(80)).toBe("B");
    expect(gradeFor(65)).toBe("C");
    expect(gradeFor(45)).toBe("D");
    expect(gradeFor(10)).toBe("F");
  });
});

describe("timeline", () => {
  it("sorts, drops pieces the kit lacks, orders lanes by kit x", () => {
    const preset = createDefaultPreset();
    const t = buildTimeline([n(2, "kick"), n(1, "hihat"), n(1.5, "snare"), n(3, "china")], preset);
    expect(t.notes.map((x) => x.timeSec)).toEqual([1, 1.5, 2]);
    const xs = t.lanes.map((l) => l.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(t.lanes.map((l) => l.id)).not.toContain("china");
    expect(t.lanes[t.laneOf[0]!]!.id).toBe("hihat");
  });
  it("lowerBound finds the first index at or after t", () => {
    const a = Float64Array.from([0, 1, 1, 2, 5]);
    expect(lowerBound(a, 1)).toBe(1);
    expect(lowerBound(a, 1.5)).toBe(3);
    expect(lowerBound(a, 9)).toBe(5);
    expect(lowerBound(a, -1)).toBe(0);
  });
  it("estimates a sane bpm", () => {
    expect(estimateBpm(Array.from({ length: 40 }, (_, i) => n(i * 0.5)))).toBe(120);
    expect(estimateBpm([])).toBe(120);
  });
});
