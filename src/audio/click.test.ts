import { afterEach, describe, expect, it, vi } from "vitest";
import { countInBeats, createMetronome } from "./click";
import { makeFakeCtx } from "./fakeAudio.testutil";

afterEach(() => vi.useRealTimers());

describe("countInBeats", () => {
  it("ends one beat before zero with the accent on beat 1", () => {
    const b = countInBeats(4, 120);
    expect(b.map((x) => x.songTime)).toEqual([-2, -1.5, -1, -0.5]);
    expect(b.map((x) => x.accent)).toEqual([true, false, false, false]);
  });
  it("returns nothing for invalid input", () => {
    expect(countInBeats(0, 120)).toEqual([]);
    expect(countInBeats(4, 0)).toEqual([]);
  });
});

describe("metronome", () => {
  it("schedules ticks on the audio clock inside the lookahead window", () => {
    vi.useFakeTimers();
    const f = makeFakeCtx();
    const m = createMetronome(f.ctx, f.ctx.destination, { lookaheadSec: 0.25 });
    f.setTime(10);
    m.start(120, 10.1); // a beat every 0.5 s
    expect(f.oscStarts).toEqual([10.1]); // 10.6 is beyond the 10.25 horizon
    f.setTime(10.4);
    vi.advanceTimersByTime(25);
    expect(f.oscStarts).toEqual([10.1, 10.6]);
    expect(f.oscFreqs[0]).toBeGreaterThan(f.oscFreqs[1]!); // accent on beat 1
    m.stop();
    expect(m.running).toBe(false);
    f.setTime(11);
    vi.advanceTimersByTime(200);
    expect(f.oscStarts).toHaveLength(2);
  });
});
