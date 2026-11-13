import { describe, expect, it } from "vitest";
import type { KitPreset, PieceId } from "../kit/types";
import type { NoteEvent } from "./types";
import { remapToKit, describeRemap } from "./remap";

const kit = (...ids: PieceId[]): KitPreset => ({
  id: "k", name: "k", locked: false, mirrored: false, updatedAt: 0,
  pieces: ids.map((id) => ({ id, kind: "drum", x: 0.5, y: 0.5, size: 0.1, color: "#fff", midiNotes: {} })),
});
const ns = (...ps: PieceId[]): NoteEvent[] => ps.map((piece, i) => ({ timeSec: i, piece, velocity: 100, source: "t" }));
const map = (from: PieceId[], k: KitPreset) => remapToKit(ns(...from), k).notes.map((n) => n.piece);

describe("remapToKit", () => {
  it("leaves a matching kit untouched", () => {
    const input = ns("kick", "snare", "tom1");
    const r = remapToKit(input, kit("kick", "snare", "tom1"));
    expect(r.remapped).toEqual([]);
    expect(r.notes).toEqual(input);
  });

  it("maps a missing tom to the nearest existing tom", () => {
    expect(map(["tom1", "tom2", "tom3", "tom4"], kit("kick", "snare", "tom1", "tom3"))).toEqual(["tom1", "tom1", "tom3", "tom3"]);
    expect(map(["tom3"], kit("kick", "snare", "tom1", "tom2"))).toEqual(["tom2"]);
  });

  it("falls back to snare when there are no toms", () => {
    expect(map(["tom2"], kit("kick", "snare"))).toEqual(["snare"]);
  });

  it("maps crash2/3 to crash1, ride to crash, hihat to nearest cymbal", () => {
    expect(map(["crash2", "crash3"], kit("kick", "snare", "crash1", "ride"))).toEqual(["crash1", "crash1"]);
    expect(map(["crash3"], kit("kick", "snare", "crash2", "ride"))).toEqual(["crash2"]);
    expect(map(["ride"], kit("kick", "snare", "crash1"))).toEqual(["crash1"]);
    expect(map(["hihat"], kit("kick", "snare", "crash1", "ride"))).toEqual(["ride"]);
    expect(map(["hihat"], kit("kick", "snare", "crash1"))).toEqual(["crash1"]);
    expect(map(["splash", "china"], kit("kick", "snare", "crash1"))).toEqual(["crash1", "crash1"]);
  });

  it("drops notes with no substitute and reports it", () => {
    const r = remapToKit(ns("kick", "snare", "hihat"), kit("kick"));
    expect(r.notes.map((n) => n.piece)).toEqual(["kick"]);
    expect(r.remapped).toEqual([{ from: "snare", to: null, count: 1 }, { from: "hihat", to: null, count: 1 }]);
  });

  it("summarizes counts and does not mutate input", () => {
    const input = ns("tom3", "tom3", "crash2", "kick");
    const copy = JSON.parse(JSON.stringify(input));
    const r = remapToKit(input, kit("kick", "snare", "tom2", "crash1"));
    expect(input).toEqual(copy);
    expect(r.remapped).toEqual([{ from: "tom3", to: "tom2", count: 2 }, { from: "crash2", to: "crash1", count: 1 }]);
    expect(r.notes[0]!.source).toBe("t");
    expect(describeRemap(r.remapped)).toEqual(["tom3 -> tom2 (2 notes)", "crash2 -> crash1 (1 note)"]);
  });
});
