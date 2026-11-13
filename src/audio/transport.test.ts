import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportedAudio } from "../chart/types";
import { fakeBlob, makeFakeCtx } from "./fakeAudio.testutil";
import { createTransport, START_LEAD_SEC } from "./transportImpl";

const stem = (name: string, role: ImportedAudio["role"]): ImportedAudio => ({ name, role, blob: fakeBlob() });

async function setup(durations: number[], roles: ImportedAudio["role"][], delayMs = 0) {
  const f = makeFakeCtx();
  f.nextDurations = durations;
  const t = createTransport(f.ctx);
  await t.load(
    roles.map((r, i) => stem(`s${i}`, r)),
    { delayMs },
  );
  return { f, t };
}
const L = START_LEAD_SEC;

describe("transport timing (fake clock; real audio sync is NOT verified here)", () => {
  it("is ready after load and songTime is 0", async () => {
    const { t } = await setup([10], ["song"]);
    expect(t.state).toBe("ready");
    expect(t.songTime).toBe(0);
    expect(t.durationSec).toBe(10);
  });

  it("derives songTime only from the audio clock", async () => {
    const { f, t } = await setup([10], ["song"]);
    f.setTime(5);
    await t.play();
    expect(t.state).toBe("playing");
    expect(f.sources[0]!.when).toBeCloseTo(5 + L);
    expect(f.sources[0]!.offset).toBe(0);
    f.setTime(5 + L + 2);
    expect(t.songTime).toBeCloseTo(2);
    f.advance(1);
    expect(t.songTime).toBeCloseTo(3);
  });

  it("applies outputLatencySec as a subtraction and clamps bad values", async () => {
    const { f, t } = await setup([10], ["song"]);
    await t.play();
    f.setTime(L + 2);
    t.outputLatencySec = 0.1;
    expect(t.songTime).toBeCloseTo(1.9);
    t.outputLatencySec = -3;
    expect(t.outputLatencySec).toBe(0);
    t.outputLatencySec = NaN;
    expect(t.outputLatencySec).toBe(0);
  });

  it("pause keeps position and play resumes from it with fresh sources", async () => {
    const { f, t } = await setup([10], ["song"]);
    await t.play();
    f.setTime(L + 3);
    t.pause();
    expect(t.state).toBe("paused");
    expect(f.sources[0]!.stopped).toBe(true);
    f.advance(100);
    expect(t.songTime).toBeCloseTo(3);
    await t.play();
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1]!.offset).toBeCloseTo(3);
    expect(f.sources[1]!.when).toBeCloseTo(f.ctx.currentTime + L);
    f.advance(L + 1);
    expect(t.songTime).toBeCloseTo(4);
  });

  it("seek while playing restarts sources at the new offset; seek while paused only moves position", async () => {
    const { f, t } = await setup([10], ["song"]);
    await t.play();
    f.setTime(1);
    t.seek(6);
    expect(f.sources[0]!.stopped).toBe(true);
    expect(f.sources[1]!.offset).toBeCloseTo(6);
    f.setTime(1 + L + 1);
    expect(t.songTime).toBeCloseTo(7);
    t.pause();
    t.seek(2);
    expect(t.songTime).toBe(2);
    expect(f.sources).toHaveLength(2);
    await t.play();
    expect(f.sources[2]!.offset).toBeCloseTo(2);
  });

  it("seek is clamped to [0, duration]", async () => {
    const { t } = await setup([10], ["song"]);
    t.seek(-5);
    expect(t.songTime).toBe(0);
    t.seek(99);
    expect(t.songTime).toBe(10);
  });

  it("count-in: songTime is negative, clicks are scheduled, audio starts at song time 0", async () => {
    const { f, t } = await setup([10], ["song"]);
    f.setTime(2);
    await t.play({ countInBeats: 4, bpm: 120 }); // 2 s of count-in
    const at = 2 + L;
    expect(f.oscStarts.map((x) => +x.toFixed(6))).toEqual([at, at + 0.5, at + 1, at + 1.5]);
    expect(f.oscFreqs[0]).toBeGreaterThan(f.oscFreqs[1]!);
    expect(f.sources[0]!.when).toBeCloseTo(at + 2);
    expect(f.sources[0]!.offset).toBe(0);
    f.setTime(at);
    expect(t.songTime).toBeCloseTo(-2);
    f.setTime(at + 1);
    expect(t.songTime).toBeCloseTo(-1);
    f.setTime(at + 2.5);
    expect(t.songTime).toBeCloseTo(0.5);
  });

  it("pausing during count-in resumes with only the remaining clicks", async () => {
    const { f, t } = await setup([10], ["song"]);
    await t.play({ countInBeats: 4, bpm: 120 });
    f.setTime(L + 1.1); // songTime -0.9: beats at -2,-1.5,-1 passed, -0.5 remains
    t.pause();
    expect(t.songTime).toBeCloseTo(-0.9);
    const before = f.oscStarts.length;
    await t.play();
    expect(f.oscStarts.length).toBe(before + 1);
    expect(f.oscStarts.at(-1)).toBeCloseTo(f.ctx.currentTime + L + 0.4);
    expect(f.sources.at(-1)!.when).toBeCloseTo(f.ctx.currentTime + L + 0.9);
  });

  it("applies song.ini delay: positive skips into the audio, negative postpones the start", async () => {
    const pos = await setup([10], ["song"], 250);
    await pos.t.play();
    expect(pos.f.sources[0]!.offset).toBeCloseTo(0.25);
    const neg = await setup([10], ["song"], -250);
    await neg.t.play();
    expect(neg.f.sources[0]!.offset).toBe(0);
    expect(neg.f.sources[0]!.when).toBeCloseTo(L + 0.25);
    // chart time 0 is when the audio is at 0.25 (positive delay): songTime = audioPos - delay
    expect(pos.t.durationSec).toBeCloseTo(9.75);
  });

  it("switching mix while playing neither restarts nor moves the position", async () => {
    const { f, t } = await setup([10, 10], ["drums", "song"]);
    await t.play();
    f.setTime(L + 4);
    const n = f.sources.length;
    t.setMix("nodrums");
    expect(f.sources).toHaveLength(n);
    expect(f.sources.every((s) => !s.stopped)).toBe(true);
    expect(t.songTime).toBeCloseTo(4);
    const g = f.sources.map((s) => s.gainNode!.gain.target);
    expect(g).toEqual([0, 1]);
    t.setMix("drumsonly");
    expect(f.sources.map((s) => s.gainNode!.gain.target)).toEqual([1, 0]);
    expect(t.mix).toBe("drumsonly");
    expect(t.state).toBe("playing");
  });

  it("reports unavailable mixes", async () => {
    const a = await setup([10], ["full"]);
    expect(a.t.nodrumsAvailable).toBe(false);
    expect(a.t.drumsonlyAvailable).toBe(false);
    const b = await setup([10, 10], ["drums", "song"]);
    expect(b.t.nodrumsAvailable).toBe(true);
    expect(b.t.drumsonlyAvailable).toBe(true);
  });

  it("fires onEnded when the longest buffer ends, once, and ignores stale sources", async () => {
    const { f, t } = await setup([5, 8], ["song", "guitar"]);
    const cb = vi.fn();
    const off = t.onEnded(cb);
    await t.play();
    f.sources[0]!.onended?.(); // shorter stem: no onended registered
    expect(cb).not.toHaveBeenCalled();
    t.seek(1); // old longest source is stale now
    f.sources[1]!.onended?.();
    expect(cb).not.toHaveBeenCalled();
    f.sources.at(-1)!.onended?.();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(t.state).toBe("ended");
    expect(t.songTime).toBe(8);
    off();
  });

  it("seeking past the end while playing ends the transport", async () => {
    const { t } = await setup([5], ["song"]);
    const cb = vi.fn();
    t.onEnded(cb);
    await t.play();
    t.seek(50);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(t.state).toBe("ended");
  });

  it("resumes a suspended context in play() and fails clearly when blocked", async () => {
    const f = makeFakeCtx({ state: "suspended" });
    const t = createTransport(f.ctx);
    await t.load([stem("a", "song")]);
    await t.play();
    expect(f.resumeCalls).toBe(1);
    expect(t.state).toBe("playing");

    const g = makeFakeCtx({ state: "suspended" });
    g.resumeFails = true;
    const u = createTransport(g.ctx);
    await u.load([stem("a", "song")]);
    await expect(u.play()).rejects.toThrow(/blocked/);
    expect(u.state).toBe("ready");
  });

  it("pause during a pending resume cancels the play", async () => {
    const f = makeFakeCtx({ state: "suspended" });
    const t = createTransport(f.ctx);
    await t.load([stem("a", "song")]);
    const p = t.play();
    t.pause();
    await p;
    expect(t.state).toBe("ready");
    expect(f.sources).toHaveLength(0);
  });

  it("reports decode failures with the file name", async () => {
    const f = makeFakeCtx();
    f.decodeFails.add(1);
    const t = createTransport(f.ctx);
    await expect(t.load([stem("ok.ogg", "song"), stem("bad.opus", "drums")])).rejects.toThrow(/bad\.opus/);
    expect(t.state).toBe("empty");
  });

  it("play with nothing loaded throws; dispose stops everything and resets", async () => {
    const f = makeFakeCtx();
    const t = createTransport(f.ctx);
    await expect(t.play()).rejects.toThrow(/Nothing is loaded/);
    await t.load([stem("a", "song")]);
    await t.play();
    t.dispose();
    expect(f.sources[0]!.stopped).toBe(true);
    expect(t.state).toBe("empty");
  });
});

describe("clickonly mix: metronome from the chart tempo map", () => {
  const setupClick = async (mixMode: "clickonly" | "full") => {
    vi.useFakeTimers();
    const f = makeFakeCtx();
    const t = createTransport(f.ctx);
    await t.load([stem("a", "song")]); // 10 s
    t.setClickTrack({ points: [{ timeSec: 0, bpm: 120 }, { timeSec: 2, bpm: 60 }], beatsPerBar: 4 });
    t.setMix(mixMode);
    return { f, t };
  };
  afterEach(() => vi.useRealTimers());
  /** Advances the audio clock in small steps, like real time passing between timer ticks. */
  const run = (f: ReturnType<typeof makeFakeCtx>, to: number, step = 0.05) => {
    while (f.ctx.currentTime < to - 1e-9) {
      f.advance(step);
      vi.advanceTimersByTime(50);
    }
  };

  it("schedules ticks on the audio clock with the accent on beat 1, topping up the lookahead window", async () => {
    const { f, t } = await setupClick("clickonly");
    await t.play(); // song time 0 at ctx 0.05
    expect(f.oscStarts).toEqual([0.05]); // 0.55 is beyond the 0.5 s window
    expect(f.oscFreqs[0]).toBeGreaterThan(1000);
    run(f, 1);
    expect(f.oscStarts.slice(0, 3)).toEqual([0.05, 0.55, 1.05]);
    expect(f.oscFreqs[1]).toBe(1000);
    run(f, 6);
    // 120 BPM until song time 2 (beats at 0,.5,1,1.5,2), then 60 BPM (3,4,5...): +0.05 anchor.
    expect(f.oscStarts.slice(0, 8)).toEqual([0.05, 0.55, 1.05, 1.55, 2.05, 3.05, 4.05, 5.05]);
    expect(f.oscFreqs.map((x) => x > 1000)).toEqual([true, false, false, false, true, false, false, false, ...f.oscFreqs.slice(8).map((x) => x > 1000)]);
    t.pause();
  });

  it("stops ticking on pause and resumes from the paused position", async () => {
    const { f, t } = await setupClick("clickonly");
    await t.play();
    run(f, 1.2);
    t.pause(); // song time 1.15
    const n = f.oscStarts.length;
    vi.advanceTimersByTime(500);
    expect(f.oscStarts).toHaveLength(n);
    await t.play(); // resumes at song time 1.15 -> ctx 1.25
    run(f, 1.4);
    expect(f.oscStarts.at(-1)).toBeCloseTo(1.25 + 0.35, 6); // next beat (1.5) is 0.35 s after the resume point
    t.pause();
  });

  it("count-in leads into beat 0 of the track, and other mixes stay silent", async () => {
    const { f, t } = await setupClick("clickonly");
    await t.play({ countInBeats: 2, bpm: 120 });
    run(f, 0.9);
    expect(f.oscStarts.slice(0, 3)).toEqual([0.05, 0.55, 1.05]); // two count-in clicks, then song beat 0
    t.pause();

    const b = await setupClick("full");
    await b.t.play();
    run(b.f, 3);
    expect(b.f.oscStarts).toEqual([]);
    b.t.setMix("clickonly"); // switching while playing starts the track
    expect(b.f.oscStarts.length).toBeGreaterThan(0);
    b.t.setMix("full");
    const n = b.f.oscStarts.length;
    run(b.f, 5);
    expect(b.f.oscStarts).toHaveLength(n);
    b.t.dispose();
  });

  it("does not tick past the end of the song", async () => {
    const { f, t } = await setupClick("clickonly");
    await t.play();
    run(f, 30);
    expect(Math.max(...f.oscStarts)).toBeLessThanOrEqual(10.05 + 1e-9);
    t.dispose();
  });
});

describe("sequential decoding", () => {
  it("decodes one stem at a time, in order", async () => {
    const f = makeFakeCtx();
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    const orig = f.ctx.decodeAudioData.bind(f.ctx);
    (f.ctx as unknown as { decodeAudioData: unknown }).decodeAudioData = async (d: ArrayBuffer) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      order.push(f.decodeIndex);
      await Promise.resolve();
      try {
        return await orig(d);
      } finally {
        inFlight--;
      }
    };
    const t = createTransport(f.ctx);
    await t.load([stem("a", "drums"), stem("b", "song"), stem("c", "bass")]);
    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2]);
    expect(t.state).toBe("ready");
  });

  it("still reports every failing file by name", async () => {
    const f = makeFakeCtx();
    f.decodeFails.add(0);
    f.decodeFails.add(2);
    const t = createTransport(f.ctx);
    await expect(t.load([stem("x.ogg", "song"), stem("y.ogg", "drums"), stem("z.ogg", "bass")])).rejects.toThrow(/x\.ogg.*z\.ogg/);
  });
});
