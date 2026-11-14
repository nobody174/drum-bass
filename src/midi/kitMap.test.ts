import { describe, expect, it } from "vitest";
import { guessDrumName, gmNoteName, kitNoteName } from "./gmNames";
import { EXTRA_PIECE_NOTES, STARTER_NOTES } from "./starterMap";
import { KEYBOARD_MAP } from "./virtualKeyboard";
import { PADS } from "../ui/OnScreenPads";
import { VIRTUAL_PADS } from "../ui/kit/VirtualPads";

describe("STARTER_NOTES", () => {
  it("are the real Nitro Max notes", () => {
    expect(STARTER_NOTES).toEqual({
      kick: 36, snare: 38, snareRim: 40, tom1: 48, tom2: 45, tom3: 43,
      hihatClosed: 42, hihatHalfOpen: 23, hihatOpen: 46, hihatPedal: 44, hihatSplash: 21,
      crash1: 49, ride: 51,
    });
    expect("rideBell" in STARTER_NOTES).toBe(false);
    expect(EXTRA_PIECE_NOTES).toEqual({ tom4: 41, crash2: 57 });
  });
  it("has no duplicate notes", () => {
    const v = Object.values(STARTER_NOTES);
    expect(new Set(v).size).toBe(v.length);
  });
});

describe("keyboard map", () => {
  it("has no ride bell or crash 2 or floor tom, no duplicate keys or notes", () => {
    const notes = KEYBOARD_MAP.map((k) => k.note);
    expect(notes).not.toContain(53);
    expect(notes).not.toContain(57);
    expect(notes).not.toContain(41);
    expect(new Set(notes).size).toBe(notes.length);
    expect(new Set(KEYBOARD_MAP.map((k) => k.code)).size).toBe(KEYBOARD_MAP.length);
  });
  it("covers every kit note, including half-open and splash", () => {
    const notes = new Set(KEYBOARD_MAP.map((k) => k.note));
    for (const n of Object.values(STARTER_NOTES)) expect(notes.has(n)).toBe(true);
  });
});

describe("monitor names", () => {
  it("shows Kit: names for Nitro Max notes", () => {
    expect(guessDrumName(40)).toBe("Kit: Snare rim");
    expect(guessDrumName(45)).toBe("Kit: Tom 2");
    expect(guessDrumName(23)).toBe("Kit: Hi-hat half-open");
    expect(guessDrumName(21)).toBe("Kit: Hi-hat splash");
  });
  it("falls back to GM names (charts stay GM) and ?", () => {
    expect(guessDrumName(53)).toBe("Ride bell");
    expect(guessDrumName(57)).toBe("Crash 2");
    expect(guessDrumName(47)).toBe("Low-mid tom");
    expect(guessDrumName(99)).toBe("?");
    expect(kitNoteName(57)).toBeNull();
    expect(gmNoteName(38)).toBe("Acoustic snare");
  });
});

describe("pads", () => {
  it("on-screen pads are the 8-piece kit: no crash 2, no ride bell, no floor tom", () => {
    const ids = PADS.map((p) => p.id);
    expect(ids).not.toContain("crash2");
    expect(ids).not.toContain("bell");
    expect(ids).not.toContain("tom4");
    for (const id of ["hatC", "hatO", "hatP", "crash1", "ride", "tom1", "tom2", "tom3", "snare", "kick"]) {
      expect(ids).toContain(id);
    }
    const notes = PADS.map((p) => p.note);
    expect(notes).toEqual(expect.arrayContaining([42, 46, 44, 40, 48, 45, 43]));
    expect(notes).not.toContain(53);
    expect(notes).not.toContain(57);
    expect(new Set(PADS.map((p) => p.id)).size).toBe(PADS.length);
  });
  it("on-screen pad grid cells do not overlap", () => {
    const taken = new Set<string>();
    for (const p of PADS) {
      const [r1, c1, r2, c2] = p.area.split("/").map((s) => Number(s.trim()));
      for (let r = r1!; r < r2!; r++) for (let c = c1!; c < c2!; c++) {
        const key = `${r},${c}`;
        expect(taken.has(key)).toBe(false);
        taken.add(key);
      }
    }
  });
  it("virtual pads match the kit notes", () => {
    const notes = VIRTUAL_PADS.map((p) => p.note);
    expect(notes).not.toContain(53);
    expect(notes).not.toContain(57);
    expect(notes).not.toContain(41);
    for (const n of Object.values(STARTER_NOTES)) expect(notes).toContain(n);
  });
});
