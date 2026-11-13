import { describe, expect, it } from "vitest";
import { countInBeatNumber, songTempo } from "./timeline";
import type { NoteEvent } from "../chart/types";

const notes = (gap: number, n = 20): NoteEvent[] => Array.from({ length: n }, (_, i) => ({ timeSec: i * gap, piece: "kick", velocity: 100 }));

describe("songTempo", () => {
  it("uses the stored tempo map, start tempo and time signature", () => {
    const t = songTempo({ tempoMap: [{ timeSec: 0, bpm: 90 }, { timeSec: 10, bpm: 140 }], startBpm: 90, beatsPerBar: 3 }, notes(0.5));
    expect(t.startBpm).toBe(90);
    expect(t.beatsPerBar).toBe(3);
    expect(t.points).toHaveLength(2);
  });
  it("falls back to estimateBpm for songs stored without tempo data", () => {
    const t = songTempo({}, notes(0.5)); // 0.5 s gaps = 120 BPM
    expect(t.startBpm).toBe(120);
    expect(t.points).toEqual([{ timeSec: 0, bpm: 120 }]);
    expect(t.beatsPerBar).toBe(4);
    expect(songTempo({}, notes(0.75)).startBpm).toBe(80);
  });
  it("uses the first map point when startBpm is missing", () => {
    expect(songTempo({ tempoMap: [{ timeSec: 0, bpm: 100 }] }, notes(0.5)).startBpm).toBe(100);
  });
});

describe("countInBeatNumber", () => {
  it("counts beats down (4,3,2,1), not seconds", () => {
    const beatSec = 0.5; // 120 BPM: a 4-beat count-in spans 2 s
    expect([-2, -1.6, -1.4, -0.9, -0.6, -0.4, -0.1].map((t) => countInBeatNumber(t, 4, beatSec))).toEqual([4, 4, 3, 2, 2, 1, 1]);
  });
  it("is slow-tempo aware and clamped", () => {
    expect(countInBeatNumber(-3, 4, 1.5)).toBe(2); // 40 BPM: -3 s is 2 beats before zero
    expect(countInBeatNumber(-99, 4, 0.5)).toBe(4);
    expect(countInBeatNumber(-1, 0, 0.5)).toBe(0);
  });
});
