import { describe, expect, it } from "vitest";
import { bpmToUsPerQuarter, createTempoMap } from "./tempo";

describe("tempo map", () => {
  it("defaults to 120 BPM", () => {
    const m = createTempoMap(480, []);
    expect(m.ticksToSeconds(480)).toBeCloseTo(0.5, 9);
    expect(m.bpmAt(0)).toBeCloseTo(120, 9);
  });

  it("handles multiple tempo changes", () => {
    // 120 BPM for 2 beats, 60 BPM for 2 beats, 240 BPM afterwards.
    const m = createTempoMap(192, [
      { tick: 0, usPerQuarter: bpmToUsPerQuarter(120) },
      { tick: 384, usPerQuarter: bpmToUsPerQuarter(60) },
      { tick: 768, usPerQuarter: bpmToUsPerQuarter(240) },
    ]);
    expect(m.ticksToSeconds(384)).toBeCloseTo(1, 9);
    expect(m.ticksToSeconds(576)).toBeCloseTo(2, 9);
    expect(m.ticksToSeconds(768)).toBeCloseTo(3, 9);
    expect(m.ticksToSeconds(768 + 192)).toBeCloseTo(3.25, 9);
    expect(m.bpmAt(400)).toBeCloseTo(60, 9);
    expect(m.bpmAt(5000)).toBeCloseTo(240, 9);
  });

  it("is order independent and last change at a tick wins", () => {
    const m = createTempoMap(480, [
      { tick: 960, usPerQuarter: 1_000_000 },
      { tick: 0, usPerQuarter: 500_000 },
      { tick: 960, usPerQuarter: 250_000 },
    ]);
    expect(m.ticksToSeconds(960)).toBeCloseTo(1, 9);
    expect(m.ticksToSeconds(1440)).toBeCloseTo(1.25, 9);
  });

  it("round-trips seconds and ticks", () => {
    const m = createTempoMap(480, [{ tick: 0, usPerQuarter: 500000 }, { tick: 1920, usPerQuarter: 400000 }]);
    for (const t of [0, 1, 1919, 1920, 5000, 123456]) expect(m.secondsToTicks(m.ticksToSeconds(t))).toBeCloseTo(t, 4);
  });

  it("ignores invalid changes and rejects bad ppq", () => {
    const m = createTempoMap(480, [{ tick: 0, usPerQuarter: 0 }, { tick: -5, usPerQuarter: 1 }]);
    expect(m.ticksToSeconds(480)).toBeCloseTo(0.5, 9);
    expect(() => createTempoMap(0, [])).toThrow();
  });
});

import { bpmAtTime, createBeatGrid, beatsPerBarOf } from "./tempo";

describe("tempo points and beat grid", () => {
  it("exports compact {timeSec,bpm} points and merges equal tempos", () => {
    const m = createTempoMap(192, [
      { tick: 0, usPerQuarter: bpmToUsPerQuarter(120) },
      { tick: 384, usPerQuarter: bpmToUsPerQuarter(120) },
      { tick: 768, usPerQuarter: bpmToUsPerQuarter(60) },
    ]);
    expect(m.points).toEqual([{ timeSec: 0, bpm: 120 }, { timeSec: 2, bpm: 60 }]);
    expect(bpmAtTime(m.points, 1.9)).toBe(120);
    expect(bpmAtTime(m.points, 2)).toBe(60);
    expect(bpmAtTime([], 5)).toBe(120);
  });

  it("beat grid follows tempo changes and accents beat 1 of each bar", () => {
    const g = createBeatGrid([{ timeSec: 0, bpm: 120 }, { timeSec: 2, bpm: 60 }], 3);
    expect([0, 1, 2, 3, 4].map((k) => g.timeOfBeat(k))).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(g.timeOfBeat(5)).toBeCloseTo(3, 9); // 60 BPM after t=2
    expect(g.timeOfBeat(6)).toBeCloseTo(4, 9);
    expect([0, 1, 2, 3, 4].map((k) => g.isAccent(k))).toEqual([true, false, false, true, false]);
    expect(g.firstBeatAtOrAfter(0)).toBe(0);
    expect(g.firstBeatAtOrAfter(0.51)).toBe(2);
    expect(g.firstBeatAtOrAfter(2.5)).toBe(5);
  });

  it("falls back to 120 BPM / 4 per bar for empty or invalid input", () => {
    const g = createBeatGrid([], 0);
    expect(g.timeOfBeat(2)).toBe(1);
    expect(g.beatsPerBar).toBe(4);
  });

  it("converts time signatures to quarter-note beats per bar", () => {
    expect(beatsPerBarOf(4, 4)).toBe(4);
    expect(beatsPerBarOf(3, 4)).toBe(3);
    expect(beatsPerBarOf(6, 8)).toBe(3);
    expect(beatsPerBarOf(0, 4)).toBe(4);
  });
});
