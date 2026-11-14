import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, TIMING_WINDOWS, sanitize } from "./store";

describe("settings sanitize", () => {
  it("empty input gives defaults", () => expect(sanitize({})).toEqual(DEFAULT_SETTINGS));
  it("rejects bad values", () => {
    const s = sanitize({ defaultCountIn: 3 as never, timingPreset: "x" as never, inputLatencyMs: NaN, keepAwake: "no" as never });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
  it("clamps latency", () => expect(sanitize({ inputLatencyMs: 9999 }).inputLatencyMs).toBe(500));
  it("clamps output latency both ways", () => {
    expect(sanitize({ outputLatencyMs: -900 }).outputLatencyMs).toBe(-500);
    expect(sanitize({ outputLatencyMs: 900 }).outputLatencyMs).toBe(500);
    expect(sanitize({ inputLatencyMs: -400 }).inputLatencyMs).toBe(-400);
  });
  it("keeps valid values", () => expect(sanitize({ defaultCountIn: 2, timingPreset: "strict" })).toMatchObject({ defaultCountIn: 2, timingPreset: "strict" }));
  it("windows widen from strict to beginner", () => {
    expect(TIMING_WINDOWS.strict.ok).toBeLessThan(TIMING_WINDOWS.normal.ok);
    expect(TIMING_WINDOWS.normal.ok).toBeLessThan(TIMING_WINDOWS.beginner.ok);
  });
});
