import { describe, expect, it } from "vitest";
import { parseGmMidi } from "./gmMidi";
import { buildMidi } from "./testUtils";

const N = (midi: number, ticks: number, velocity = 0.8) => ({ midi, ticks, velocity });

describe("GM drum MIDI", () => {
  it("maps GM notes on channel 10 and puts everything in expert", () => {
    const notes = [35, 36, 37, 38, 40, 41, 43, 45, 47, 48, 50, 42, 44, 46, 49, 57, 51, 59, 53, 52, 55].map((m, i) => N(m, i * 480));
    const bytes = buildMidi({
      tracks: [{ name: "melody", channel: 0, notes: [N(60, 0)] }, { name: "drums", channel: 9, notes }],
    });
    const r = parseGmMidi(bytes);
    expect(r.format).toBe("gm-midi");
    expect(Object.keys(r.notesByDifficulty)).toEqual(["expert"]);
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual([
      "kick", "kick", "snare", "snare", "snare", "tom4", "tom3", "tom2", "tom2", "tom1", "tom1",
      "hihat", "hihat", "hihat", "crash1", "crash2", "ride", "ride", "ride", "china", "splash",
    ]);
    expect(r.notesByDifficulty.expert![0]!.source).toBe("gm:35");
    expect(r.notesByDifficulty.expert![0]!.velocity).toBe(101);
    expect(r.warnings).toEqual([]);
  });

  it("falls back to the first track with notes and reports unknown notes", () => {
    const bytes = buildMidi({ tracks: [{ channel: 2, notes: [N(36, 0), N(39, 480), N(39, 960)] }] });
    const r = parseGmMidi(bytes);
    expect(r.notesByDifficulty.expert).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/first track/);
    expect(r.warnings.join(" ")).toMatch(/39 \(x2\)/);
  });

  it("throws for a file with no notes", () => {
    expect(() => parseGmMidi(buildMidi({ tracks: [{ notes: [] }] }))).toThrow(/no notes/);
  });

  it("uses the tempo map", () => {
    const bytes = buildMidi({
      tempos: [{ ticks: 0, bpm: 60 }],
      tracks: [{ channel: 9, notes: [N(36, 480)] }],
    });
    expect(parseGmMidi(bytes).notesByDifficulty.expert![0]!.timeSec).toBeCloseTo(1, 4);
  });
});
