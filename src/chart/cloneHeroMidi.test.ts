import { describe, expect, it } from "vitest";
import { parseCloneHeroMidi, hasPartDrums } from "./cloneHeroMidi";
import { buildMidi } from "./testUtils";

const N = (midi: number, ticks: number, extra: { durationTicks?: number; velocity?: number } = {}) => ({ midi, ticks, ...extra });

describe("Clone Hero PART DRUMS parser", () => {
  it("maps expert lanes with and without tom markers", () => {
    const bytes = buildMidi({
      tracks: [{
        name: "PART DRUMS",
        notes: [
          N(96, 0), N(97, 480), N(98, 960), N(99, 1440), N(100, 1920), // no markers over them: cymbals
          N(98, 2400), N(99, 2400), N(100, 2400),                       // under markers: toms
          N(110, 2400, { durationTicks: 120 }), N(111, 2400, { durationTicks: 120 }), N(112, 2400, { durationTicks: 120 }),
          N(98, 2520), // marker ended exactly here (exclusive end): cymbal again
        ],
      }],
    });
    const { notesByDifficulty, format } = parseCloneHeroMidi(bytes);
    expect(format).toBe("clonehero-mid");
    const e = notesByDifficulty.expert!;
    expect(e.map((n) => n.piece)).toEqual(["kick", "snare", "hihat", "ride", "crash1", "tom1", "tom2", "tom3", "hihat"]);
    expect(e[0]!.timeSec).toBe(0);
    expect(e[1]!.timeSec).toBeCloseTo(0.5, 9);
    expect(e.every((n) => n.velocity === 100)).toBe(true);
    expect(e[5]!.source).toBe("expert:yellow-tom");
    expect(e[2]!.source).toBe("expert:yellow-cymbal");
  });

  it("handles other difficulties, double kick, and ignores non-gem events", () => {
    const bytes = buildMidi({
      tracks: [{
        name: "PART DRUMS",
        notes: [
          N(60, 0), N(61, 480), N(62, 960),   // easy
          N(72, 0), N(76, 480),               // medium kick, green
          N(84, 0), N(88, 480),               // hard
          N(95, 240), N(96, 240),             // 2x kick + kick on same tick -> deduped
          N(116, 0, { durationTicks: 1000 }), N(120, 0), N(103, 0), N(124, 0), N(0, 0), N(127, 0),
        ],
      }],
    });
    const r = parseCloneHeroMidi(bytes).notesByDifficulty;
    expect(r.easy!.map((n) => n.piece)).toEqual(["kick", "snare", "hihat"]);
    expect(r.medium!.map((n) => n.piece)).toEqual(["kick", "crash1"]);
    expect(r.hard!.map((n) => n.piece)).toEqual(["kick", "crash1"]);
    expect(r.expert!.map((n) => n.piece)).toEqual(["kick"]);
    expect(r.expert![0]!.timeSec).toBeCloseTo(0.25, 9);
  });

  it("applies tempo changes", () => {
    const bytes = buildMidi({
      tempos: [{ ticks: 0, bpm: 120 }, { ticks: 960, bpm: 60 }],
      tracks: [{ name: "PART DRUMS", notes: [N(96, 960), N(96, 1440)] }],
    });
    const e = parseCloneHeroMidi(bytes).notesByDifficulty.expert!;
    expect(e[0]!.timeSec).toBeCloseTo(1, 4);
    expect(e[1]!.timeSec).toBeCloseTo(2, 4);
  });

  it("uses real velocities only when they vary", () => {
    const same = buildMidi({ tracks: [{ name: "PART DRUMS", notes: [N(96, 0, { velocity: 1 }), N(97, 480, { velocity: 1 })] }] });
    expect(parseCloneHeroMidi(same).notesByDifficulty.expert!.map((n) => n.velocity)).toEqual([100, 100]);
    const mixed = buildMidi({ tracks: [{ name: "PART DRUMS", notes: [N(96, 0, { velocity: 0.5 }), N(97, 480, { velocity: 1 })] }] });
    expect(parseCloneHeroMidi(mixed).notesByDifficulty.expert!.map((n) => n.velocity)).toEqual([63, 127]);
  });

  it("finds the track by name among others and throws without it", () => {
    const bytes = buildMidi({
      tracks: [
        { name: "PART GUITAR", notes: [N(96, 0)] },
        { name: "part drums", channel: 3, notes: [N(97, 0)] },
      ],
    });
    expect(hasPartDrums(bytes)).toBe(true);
    expect(parseCloneHeroMidi(bytes).notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["snare"]);
    expect(() => parseCloneHeroMidi(buildMidi({ tracks: [{ name: "x", notes: [N(96, 0)] }] }))).toThrow(/PART DRUMS/);
    expect(() => parseCloneHeroMidi(new Uint8Array([1, 2, 3]))).toThrow(/valid MIDI/);
  });

  it("warns when there are no markers and honours noMarkerPolicy", () => {
    const bytes = buildMidi({ tracks: [{ name: "PART DRUMS", notes: [N(98, 0)] }] });
    const a = parseCloneHeroMidi(bytes);
    expect(a.warnings.join(" ")).toMatch(/no tom markers/i);
    expect(a.notesByDifficulty.expert![0]!.piece).toBe("hihat");
    expect(parseCloneHeroMidi(bytes, { noMarkerPolicy: "toms" }).notesByDifficulty.expert![0]!.piece).toBe("tom1");
  });

  it("detects 5-lane files (note base+5)", () => {
    const bytes = buildMidi({ tracks: [{ name: "PART DRUMS", notes: [N(98, 0), N(100, 480), N(101, 960)] }] });
    const r = parseCloneHeroMidi(bytes);
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["hihat", "crash1", "tom2"]);
    expect(r.warnings.join(" ")).toMatch(/5-lane/);
  });
});

/** Hand-built SMF with text events on PART DRUMS (tonejs cannot write them). */
function smfWithText(events: { tick: number; text?: string; note?: number }[]): Uint8Array {
  const vlq = (n: number) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const chunk = (id: string, body: number[]) => [
    ...[...id].map((c) => c.charCodeAt(0)),
    (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255,
    ...body,
  ];
  const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];
  const txt = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const tempoTrack = [0, ...meta(0x51, [0x07, 0xa1, 0x20]), 0, ...meta(0x2f, [])];
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  const body: number[] = [0, ...meta(0x03, txt("PART DRUMS"))];
  let last = 0;
  for (const e of sorted) {
    body.push(...vlq(e.tick - last));
    last = e.tick;
    if (e.text !== undefined) body.push(...meta(0x01, txt(e.text)));
    else body.push(0x90, e.note!, 100, 0, 0x80, e.note!, 0); // zero-length note
  }
  body.push(0, ...meta(0x2f, []));
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0];
  return new Uint8Array([...head, ...chunk("MTrk", tempoTrack), ...chunk("MTrk", body)]);
}

/** A far-away tom marker makes the track Pro, which is when `d` flips notes. */
const PRO = { tick: 9000, note: 110 };

describe("disco flip (event format per GuitarGame_ChartFormats docs)", () => {
  const notes = [
    PRO,
    { tick: 0, note: 97 },     // red, before the flip: snare
    { tick: 480, text: "[mix 3 drums0d]" },
    { tick: 480, note: 97 },   // red in flip: hi-hat
    { tick: 960, note: 98 },   // yellow in flip: snare
    { tick: 1440, text: "[mix 3 drums0]" },
    { tick: 1440, note: 97 },  // flip ended: snare
    { tick: 1920, note: 98 },  // yellow, no flip: cymbal hi-hat
  ];

  it("swaps red and yellow between a d mix event and the next mix event", () => {
    const r = parseCloneHeroMidi(smfWithText(notes));
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["snare", "hihat", "snare", "snare", "hihat"]);
    expect(r.warnings.join(" ")).toMatch(/Disco flip applied to 2 notes/);
  });

  it("only affects the difficulty named by the event, and ignores dnoflip / other flags", () => {
    const hardOnly = parseCloneHeroMidi(smfWithText([PRO, { tick: 0, text: "[mix 2 drums0d]" }, { tick: 0, note: 85 }, { tick: 0, note: 97 }]));
    expect(hardOnly.notesByDifficulty.hard!.map((n) => n.piece)).toEqual(["hihat"]); // hard red flipped
    expect(hardOnly.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["snare"]); // expert untouched
    for (const flag of ["dnoflip", "easy", "easynokick", ""]) {
      const r = parseCloneHeroMidi(smfWithText([PRO, { tick: 0, text: `[mix 3 drums0${flag}]` }, { tick: 0, note: 97 }]));
      expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["snare"]);
    }
  });

  it("accepts the unbracketed / underscore event spellings and other drum configs (drums3d)", () => {
    for (const text of ["mix 3 drums0d", "[mix_3_drums0d]", "[mix 3 drums3d]", "[MIX 3 DRUMS2D]"]) {
      const r = parseCloneHeroMidi(smfWithText([PRO, { tick: 0, text }, { tick: 0, note: 97 }]));
      expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["hihat"]);
    }
  });

  it("does not flip notes on non-Pro tracks (d only swaps audio stems there)", () => {
    const r = parseCloneHeroMidi(smfWithText([{ tick: 0, text: "[mix 3 drums0d]" }, { tick: 0, note: 97 }]));
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["snare"]);
  });

  it("prefers Pro over 5-lane when tom markers and a base+5 note are both present", () => {
    const r = parseCloneHeroMidi(smfWithText([PRO, { tick: 0, note: 100 }, { tick: 480, note: 101 }]));
    expect(r.warnings.join(" ")).not.toMatch(/5-lane/);
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["crash1"]); // base+5 ignored in Pro
  });

  it("covers every difficulty's note numbers and ignores markers 109/126/127", () => {
    const bases = { easy: 60, medium: 72, hard: 84, expert: 96 } as const;
    const evs = Object.values(bases).flatMap((b, i) => [0, 1, 2, 3, 4].map((o) => ({ tick: i * 10 + o, note: b + o })));
    const r = parseCloneHeroMidi(smfWithText([...evs, { tick: 500, note: 109 }, { tick: 501, note: 126 }, { tick: 502, note: 127 }])).notesByDifficulty;
    for (const d of ["easy", "medium", "hard", "expert"] as const) {
      expect(r[d]!.map((n) => n.piece)).toEqual(["kick", "snare", "hihat", "ride", "crash1"]);
    }
  });

  it("does nothing when given a parsed Midi object (no raw bytes) or malformed text", () => {
    expect(parseCloneHeroMidi(smfWithText([{ tick: 0, text: "[mix 9 drumsXd" }, { tick: 0, note: 97 }])).notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["snare"]);
  });
});

describe("tempo meta", () => {
  it("exposes the tempo map and time signature", () => {
    const r = parseCloneHeroMidi(buildMidi({ tempos: [{ ticks: 0, bpm: 120 }, { ticks: 960, bpm: 60 }], tracks: [{ name: "PART DRUMS", notes: [N(96, 0)] }] }));
    expect(r.meta.tempoMap).toEqual([{ timeSec: 0, bpm: 120 }, { timeSec: 1, bpm: 60 }]);
  });
});
