import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMidiMessage } from "./parse";
import { inputBus } from "./inputBus";
import { playMock } from "./mockInput";
import { startVirtualKeyboard, stopVirtualKeyboard } from "./virtualKeyboard";
import type { DrumInputEvent } from "./types";

describe("parseMidiMessage", () => {
  it("parses note-on with channel", () => {
    expect(parseMidiMessage([0x99, 38, 90], 12.5)).toEqual({
      kind: "note",
      event: { note: 38, velocity: 90, channel: 9, source: "midi", timeStamp: 12.5 },
    });
  });
  it("treats note-on velocity 0 as note-off", () => {
    expect(parseMidiMessage([0x99, 38, 0], 0)).toBeNull();
  });
  it("ignores note-off", () => {
    expect(parseMidiMessage([0x89, 38, 64], 0)).toBeNull();
  });
  it("parses CC", () => {
    expect(parseMidiMessage([0xb0, 4, 100], 5)).toEqual({
      kind: "cc",
      event: { controller: 4, value: 100, channel: 0, timeStamp: 5 },
    });
  });
  it("ignores other status bytes and short messages", () => {
    expect(parseMidiMessage([0xe0, 1, 2], 0)).toBeNull();
    expect(parseMidiMessage([0xc0, 1, 2], 0)).toBeNull();
    expect(parseMidiMessage([0xf8], 0)).toBeNull();
    expect(parseMidiMessage([0x90, 36], 0)).toBeNull();
    expect(parseMidiMessage(null, 0)).toBeNull();
  });
});

describe("inputBus", () => {
  it("subscribes and unsubscribes", () => {
    const fn = vi.fn();
    const off = inputBus.subscribe(fn);
    const e: DrumInputEvent = { note: 36, velocity: 1, channel: 9, source: "pad", timeStamp: 0 };
    inputBus.emit(e);
    off();
    inputBus.emit(e);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(e);
  });
  it("routes CC separately", () => {
    const n = vi.fn();
    const c = vi.fn();
    const o1 = inputBus.subscribe(n);
    const o2 = inputBus.subscribeCc(c);
    inputBus.emitCc({ controller: 4, value: 1, channel: 0, timeStamp: 0 });
    expect(n).not.toHaveBeenCalled();
    expect(c).toHaveBeenCalledTimes(1);
    o1();
    o2();
  });
});

describe("playMock", () => {
  afterEach(() => vi.useRealTimers());
  it("emits at the scheduled times and can be cancelled", () => {
    vi.useFakeTimers();
    const got: number[] = [];
    const off = inputBus.subscribe((e) => got.push(e.note));
    const done = vi.fn();
    const cancel = playMock(
      [
        { atMs: 100, event: { note: 36 } },
        { atMs: 300, event: { note: 38 } },
      ],
      done,
    );
    vi.advanceTimersByTime(99);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual([36]);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(got).toEqual([36]);
    expect(done).not.toHaveBeenCalled();
    off();
  });
  it("calls onDone after the last event", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    playMock([{ atMs: 10, event: { note: 36 } }], done);
    vi.advanceTimersByTime(10);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("virtual keyboard", () => {
  afterEach(() => stopVirtualKeyboard());
  it("emits once per press, ignoring repeats, modifiers and inputs", () => {
    const got: DrumInputEvent[] = [];
    const off = inputBus.subscribe((e) => got.push(e));
    startVirtualKeyboard();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ" }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", bubbles: true }));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ note: 38, velocity: 100, channel: 9, source: "keyboard" });
    stopVirtualKeyboard();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));
    expect(got).toHaveLength(1);
    off();
  });
});
