import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteToVoice, shouldPlaySource, velocityToGain, VoiceLimiter } from "./voiceMap";
import {
  DEFAULT_SOUND_SETTINGS,
  loadSoundSettings,
  saveSoundSettings,
  SOUND_SETTINGS_KEY,
} from "./settings";

describe("noteToVoice", () => {
  it("maps GM notes to voices", () => {
    expect(noteToVoice(36).kind).toBe("kick");
    expect(noteToVoice(38).kind).toBe("snare");
    expect(noteToVoice(37).kind).toBe("rim");
    expect(noteToVoice(42).kind).toBe("hatClosed");
    expect(noteToVoice(44).kind).toBe("hatClosed");
    expect(noteToVoice(46).kind).toBe("hatOpen");
    expect(noteToVoice(49).kind).toBe("crash");
    expect(noteToVoice(51).kind).toBe("ride");
    expect(noteToVoice(53).kind).toBe("bell");
  });
  it("follows the Nitro Max notes and keeps every GM note working", () => {
    expect(noteToVoice(40).kind).toBe("snare"); // snare rim / electric snare
    expect(noteToVoice(23).kind).toBe("hatOpen"); // half-open hat
    expect(noteToVoice(21).kind).toBe("crash"); // hat splash
    for (const n of [48, 45, 43]) expect(noteToVoice(n).kind).toBe("tom"); // kit toms
    for (const n of [41, 47, 50]) expect(noteToVoice(n).kind).toBe("tom"); // GM toms
    expect(noteToVoice(35).kind).toBe("kick");
    for (const n of [52, 55, 57]) expect(noteToVoice(n).kind).toBe("crash");
    expect(noteToVoice(59).kind).toBe("ride");
    // kit tom 1 > tom 2 > tom 3 in pitch
    expect(noteToVoice(48).pitch).toBeGreaterThan(noteToVoice(45).pitch);
    expect(noteToVoice(45).pitch).toBeGreaterThan(noteToVoice(43).pitch);
  });
  it("gives toms descending pitch from high to low", () => {
    const notes = [50, 48, 47, 45, 43, 41];
    const pitches = notes.map((n) => noteToVoice(n).pitch);
    expect(noteToVoice(41).kind).toBe("tom");
    for (let i = 1; i < pitches.length; i++) expect(pitches[i]).toBeLessThan(pitches[i - 1]!);
  });
  it("falls back to blip for unknown notes", () => {
    expect(noteToVoice(0).kind).toBe("blip");
    expect(noteToVoice(99).kind).toBe("blip");
  });
});

describe("velocityToGain", () => {
  it("is monotonic and bounded", () => {
    expect(velocityToGain(0)).toBe(0);
    expect(velocityToGain(127)).toBeCloseTo(1);
    expect(velocityToGain(64)).toBeGreaterThan(velocityToGain(32));
    expect(velocityToGain(500)).toBeCloseTo(1);
    expect(velocityToGain(NaN)).toBe(0);
  });
});

describe("shouldPlaySource", () => {
  const base = { enabled: true, playForMidi: false };
  it("plays virtual sources, skips midi by default", () => {
    for (const s of ["pad", "keyboard", "mock"] as const) expect(shouldPlaySource(s, base)).toBe(true);
    expect(shouldPlaySource("midi", base)).toBe(false);
  });
  it("plays midi when enabled", () => {
    expect(shouldPlaySource("midi", { ...base, playForMidi: true })).toBe(true);
  });
  it("is silent when disabled", () => {
    expect(shouldPlaySource("pad", { enabled: false, playForMidi: true })).toBe(false);
  });
});

describe("VoiceLimiter", () => {
  it("cuts the oldest voices beyond the cap", () => {
    const cut = vi.fn();
    const l = new VoiceLimiter<number>(3, cut);
    [1, 2, 3, 4, 5].forEach((v) => l.add(v));
    expect(l.size).toBe(3);
    expect(cut.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    l.remove(5);
    expect(l.size).toBe(2);
  });
});

describe("sound settings storage", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns defaults when missing", () => {
    expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });
  it("returns defaults on corrupt JSON", () => {
    store.set(SOUND_SETTINGS_KEY, "{not json");
    expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });
  it("sanitizes bad fields and clamps volume", () => {
    store.set(SOUND_SETTINGS_KEY, JSON.stringify({ enabled: "yes", volume: 7, playForMidi: true }));
    expect(loadSoundSettings()).toEqual({ enabled: true, volume: 1, playForMidi: true });
  });
  it("round-trips", () => {
    saveSoundSettings({ enabled: false, volume: 0.3, playForMidi: true });
    expect(loadSoundSettings()).toEqual({ enabled: false, volume: 0.3, playForMidi: true });
  });
  it("does not throw when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(() => saveSoundSettings(DEFAULT_SOUND_SETTINGS)).not.toThrow();
  });
});
