import { describe, expect, it } from "vitest";
import { createDefaultPreset, findConflicts, resetToNitroMaxDefault, setLocked, setMirrored } from "../../kit";
import type { KitPiece, KitPreset, PieceId } from "../../kit";
import {
  advance, advanceAndReplay, back, conflictLines, statusText, buildPlan, buildReport, captureNote, createSession, currentStep, isListening, progress, redo,
  resolveDuplicate, skip, summaryRows,
} from "./learnPlan";
import { stepLabel, zonesFor } from "./zones";

const piece = (id: PieceId, midiNotes: Record<string, number>): KitPiece => ({
  id, kind: "drum", x: 0.5, y: 0.5, size: 0.2, color: "#fff", midiNotes,
});
const kit = (pieces: KitPiece[]): KitPreset => ({ id: "k", name: "Test kit", pieces, locked: false, mirrored: false, updatedAt: 0 });

const REF = kit([
  piece("kick", { head: 36 }), piece("snare", { head: 38, rim: 40 }),
  piece("hihat", { closed: 42, open: 46, pedal: 44, halfOpen: 23, splash: 21 }),
  piece("tom1", { head: 48 }), piece("tom2", { head: 45 }), piece("tom3", { head: 43 }),
  piece("crash1", { bow: 49 }), piece("ride", { bow: 51 }),
]);
// Scrambled on purpose: the plan order must not depend on preset order.
const FULL = kit([...REF.pieces].reverse());

const keys = (p: KitPreset, ref = REF) => buildPlan(p, ref).map((s) => s.key);

describe("buildPlan", () => {
  it("orders kick, snare head/rim, toms, hi-hat, crash, ride", () => {
    expect(keys(FULL)).toEqual([
      "kick:head", "snare:head", "snare:rim", "tom1:head", "tom2:head", "tom3:head",
      "hihat:closed", "hihat:open", "hihat:pedal", "hihat:halfOpen", "hihat:splash", "crash1:bow", "ride:bow",
    ]);
  });

  it("marks only half-open and splash as optional", () => {
    const opt = buildPlan(FULL, REF).filter((s) => s.optional).map((s) => s.key);
    expect(opt).toEqual(["hihat:halfOpen", "hihat:splash"]);
  });

  it("only includes pieces and optional zones the preset has", () => {
    const small = kit([piece("kick", { head: 36 }), piece("snare", { head: 38, rim: 40 }), piece("hihat", { closed: 42, open: 46, pedal: 44 })]);
    expect(keys(small)).toEqual(["kick:head", "snare:head", "snare:rim", "hihat:closed", "hihat:open", "hihat:pedal"]);
  });

  it("puts extra pieces after the main sequence, in preset order, with all zones required", () => {
    const p = kit([piece("kick", { head: 36 }), piece("snare", { head: 38 }), piece("tom4", { head: 41 }), piece("crash2", { bow: 57 }), piece("ride", { bow: 51 })]);
    const plan = buildPlan(p, REF);
    expect(plan.map((s) => s.key)).toEqual(["kick:head", "snare:head", "snare:rim", "ride:bow", "tom4:head", "crash2:bow"]);
    expect(plan.find((s) => s.key === "tom4:head")).toMatchObject({ optional: false, expected: undefined });
  });

  it("turns extra keys on a main piece (legacy ride bell) into optional steps", () => {
    const p = kit([piece("kick", { head: 36 }), piece("snare", { head: 38 }), piece("ride", { bow: 51, bell: 53 })]);
    const bell = buildPlan(p, REF).find((s) => s.key === "ride:bell")!;
    expect(bell.optional).toBe(true);
    expect(bell.expected).toBeUndefined();
  });

  it("takes the expected note from the reference and starts pending", () => {
    const plan = buildPlan(FULL, REF);
    expect(plan.find((s) => s.key === "snare:rim")).toMatchObject({ expected: 40, status: "pending", learned: undefined, label: "Snare rim" });
    expect(plan.find((s) => s.key === "hihat:halfOpen")!.expected).toBe(23);
  });

  it("works with the real default preset (no reference given)", () => {
    const plan = buildPlan(kit([piece("kick", { head: 36 }), piece("snare", { head: 38 })]));
    expect(plan[0]).toMatchObject({ key: "kick:head", status: "pending" });
    expect(typeof plan[0]!.expected).toBe("number");
  });
});

describe("zonesFor / stepLabel", () => {
  it("is key driven: canonical zones first, then extra stored keys", () => {
    expect(zonesFor("hihat")).toEqual(["closed", "open", "pedal", "halfOpen", "splash"]);
    expect(zonesFor("ride")).toEqual(["bow"]);
    expect(zonesFor("tom1")).toEqual(["head"]);
    expect(zonesFor("crash1")).toEqual(["bow"]);
    expect(zonesFor("ride", { bow: 51, bell: 53 })).toEqual(["bow", "bell"]);
  });
  it("labels", () => {
    expect(stepLabel("tom2", "head")).toBe("Tom 2");
    expect(stepLabel("crash1", "bow")).toBe("Crash 1");
    expect(stepLabel("hihat", "halfOpen")).toBe("Hi-hat half-open");
    expect(stepLabel("snare", "head")).toBe("Snare head");
  });
});

describe("session", () => {
  const start = () => createSession(FULL, REF);

  it("captures a note, stores an effect, then advances", () => {
    const r = captureNote(start(), 36, 1000);
    expect(r.kind).toBe("captured");
    expect(r.effects).toEqual([{ piece: "kick", zone: "head", note: 36 }]);
    expect(currentStep(r.session)).toMatchObject({ status: "learned", learned: 36 });
    expect(r.session.phase).toBe("confirm");
    const n = advance(r.session);
    expect(n.index).toBe(1);
    expect(isListening(n)).toBe(true);
  });

  it("ignores events while confirming", () => {
    const r = captureNote(start(), 36, 1000);
    expect(captureNote(r.session, 99, 1500).kind).toBe("queued");
    expect(captureNote(r.session, 36, 1500).kind).toBe("ignored"); // same note: noise
    expect(captureNote(createSession(FULL, REF), 36, 1).session.phase).toBe("confirm");
  });

  it("ignores a double trigger within 150 ms but accepts it later", () => {
    const a = advance(captureNote(start(), 36, 1000).session);
    expect(captureNote(a, 36, 1100).kind).toBe("ignored"); // same note, 100 ms
    expect(captureNote(a, 38, 1100).kind).toBe("captured"); // different note is real
    expect(captureNote(a, 36, 1200).kind).toBe("duplicate"); // >150 ms: a real second hit, but 36 is already kick
  });

  it("rejects invalid notes", () => {
    expect(captureNote(start(), 200, 1).kind).toBe("ignored");
    expect(captureNote(start(), 1.5, 1).kind).toBe("ignored");
  });

  it("warns on a duplicate and does not store it; keep drops the hit", () => {
    const a = advance(captureNote(start(), 36, 1000).session);
    const d = captureNote(a, 36, 2000);
    expect(d.kind).toBe("duplicate");
    expect(d.effects).toEqual([]);
    expect(d.session.duplicate).toEqual({ note: 36, otherIndex: 0, otherKey: "kick:head", otherLabel: "Kick" });
    expect(currentStep(d.session)!.status).toBe("pending");
    const k = resolveDuplicate(d.session, "keep");
    expect(k.effects).toEqual([]);
    expect(isListening(k.session)).toBe(true);
    expect(k.session.steps[0]!.learned).toBe(36);
  });

  it("replace moves the note: other step pending + cleared, current learned", () => {
    const a = advance(captureNote(start(), 36, 1000).session);
    const d = captureNote(a, 36, 2000);
    const r = resolveDuplicate(d.session, "replace");
    expect(r.effects).toEqual([
      { piece: "kick", zone: "head", note: null },
      { piece: "snare", zone: "head", note: 36 },
    ]);
    expect(r.session.steps[0]).toMatchObject({ status: "pending", learned: undefined });
    expect(r.session.steps[1]).toMatchObject({ status: "learned", learned: 36 });
  });

  it("skip marks skipped and moves on; skip on a learned step keeps it", () => {
    const s = skip(start());
    expect(s.steps[0]!.status).toBe("skipped");
    expect(s.index).toBe(1);
    const learned = captureNote(s, 38, 10).session;
    expect(skip(learned).steps[1]!.status).toBe("learned");
  });

  it("back and redo", () => {
    let s = advance(captureNote(start(), 36, 1000).session);
    s = back(s);
    expect(s.index).toBe(0);
    expect(isListening(s)).toBe(false); // already learned
    s = redo(s);
    expect(isListening(s)).toBe(true);
    expect(s.steps[0]!.learned).toBeUndefined();
    expect(back(s).index).toBe(0); // cannot go before the first step
  });

  it("finishes after the last step and reports progress", () => {
    let s = start();
    const total = s.steps.length;
    expect(progress(s)).toMatchObject({ step: 1, total });
    for (let i = 0; i < total; i++) s = skip(s);
    expect(s.phase).toBe("done");
    expect(progress(s)).toMatchObject({ skipped: total, learned: 0 });
    expect(isListening(s)).toBe(false);
    expect(back(s).index).toBe(total - 1);
  });

  it("an empty plan is immediately done", () => {
    expect(createSession(kit([]), REF).phase).toBe("done");
  });
});

describe("summary and report", () => {
  it("flags differences only when both a default and a learned note exist", () => {
    let s = createSession(FULL, REF);
    s = advance(captureNote(s, 36, 100).session); // kick matches
    s = advance(captureNote(s, 37, 400).session); // snare head 38 -> 37 differs
    s = skip(s); // snare rim skipped
    const rows = summaryRows(s);
    expect(rows[0]).toMatchObject({ differs: false, learned: 36 });
    expect(rows[1]).toMatchObject({ differs: true, learned: 37, expected: 38 });
    expect(rows[2]).toMatchObject({ differs: false, status: "skipped" });
  });

  it("builds a Markdown table with date, device and CC4", () => {
    let s = createSession(FULL, REF);
    s = advance(captureNote(s, 36, 100).session);
    s = advance(captureNote(s, 37, 400).session);
    const md = buildReport(s, {
      presetName: "Alesis Nitro Max", device: "Nitro Max", date: new Date(2026, 10, 14, 9, 5),
      cc4: { seen: true, count: 12, min: 0, max: 127 },
    });
    expect(md).toContain("- Date: 2026-11-14");
    expect(md).toContain("- MIDI device: Nitro Max");
    expect(md).toContain("CC4 (hi-hat foot controller): seen, 12 messages, values 0..127");
    expect(md).toContain("| Piece / zone | Manual default | Learned | Status | Differs |");
    expect(md).toContain("| Kick | 36 | 36 | learned | no |");
    expect(md).toContain("| Snare head | 38 | 37 | learned | YES |");
    expect(md).toContain("| Hi-hat half-open | 23 | - | pending - kit still has 23 | - |");
    expect(md).toContain("2 of 13 learned, 11 pending, 1 differ");
  });

  it("states when no device is connected", () => {
    const md = buildReport(createSession(FULL, REF), { presetName: "x", device: null, date: new Date(2026, 0, 2) });
    expect(md).toContain("not connected");
  });
});

describe("duplicates against notes already in the preset", () => {
  it("warns when another zone not learned in this run holds the note, replace clears it only on request", () => {
    let s = createSession(FULL, REF);
    s = skip(skip(skip(s))); // kick, snare head, snare rim skipped; now tom1 (kit: 48)
    expect(currentStep(s)!.key).toBe("tom1:head");
    const d = captureNote(s, 45, 1000); // tom2 still holds 45
    expect(d.kind).toBe("duplicate");
    expect(d.effects).toEqual([]);
    expect(d.session.duplicate).toMatchObject({ note: 45, otherIndex: 4, otherKey: "tom2:head", otherLabel: "Tom 2" });
    const keep = resolveDuplicate(d.session, "keep");
    expect(keep.effects).toEqual([]);
    expect(keep.session.held["tom2:head"]).toBe(45);
    const rep = resolveDuplicate(d.session, "replace");
    expect(rep.effects).toEqual([{ piece: "tom2", zone: "head", note: null }, { piece: "tom1", zone: "head", note: 45 }]);
    expect(rep.session.steps[4]).toMatchObject({ status: "pending", cleared: true });
    expect(rep.session.held["tom2:head"]).toBeUndefined();
    expect(summaryRows(rep.session)[4]).toMatchObject({ kit: undefined, cleared: true });
    expect(statusText(summaryRows(rep.session)[4]!)).toBe("pending - needs re-learn, note cleared");
  });

  it("handles a holder outside the plan (no step) on replace", () => {
    const p = kit([piece("kick", { head: 36 }), piece("snare", { head: 38 }), piece("ride", { bow: 51, bell: 53 })]);
    let s = skip(createSession(p, REF)); // kick skipped, now snare
    s = captureNote(s, 36, 10).session; // kick holds 36 though skipped: warns
    expect(s.phase).toBe("duplicate");
    const full = createSession(kit([piece("snare", { head: 38, hidden: 99 })]), REF);
    const o = { ...full, steps: full.steps.filter((x) => x.key !== "snare:hidden") }; // holder not in the plan
    o.index = 0;
    const d = captureNote(o, 99, 5);
    expect(d.session.duplicate).toMatchObject({ otherIndex: -1, otherKey: "snare:hidden" });
    expect(resolveDuplicate(d.session, "replace").effects[0]).toEqual({ piece: "snare", zone: "hidden", note: null });
  });

  it("final conflicts are reported in the Markdown", () => {
    const p = kit([piece("kick", { head: 36 }), piece("snare", { head: 36 })]);
    const conflicts = findConflicts(p);
    expect(conflictLines(conflicts)).toEqual(["Note 36 is used by Kick and Snare head."]);
    const md = buildReport(createSession(p, REF), { presetName: "x", device: null, date: new Date(2026, 0, 2), conflicts });
    expect(md).toContain("Remaining conflicts");
    expect(md).toContain("- Note 36 is used by Kick and Snare head.");
    expect(buildReport(createSession(p, REF), { presetName: "x", device: null, date: new Date(2026, 0, 2), conflicts: [] })).toContain("No note conflicts");
  });
});

describe("summary accuracy for pending and skipped rows", () => {
  it("shows what the kit holds and counts pending", () => {
    let s = createSession(FULL, REF);
    s = skip(s); // kick skipped, kit still 36
    const rows = summaryRows(s);
    expect(statusText(rows[0]!)).toBe("skipped - kit still has 36");
    expect(statusText(rows[1]!)).toBe("pending - kit still has 38");
    expect(progress(s)).toMatchObject({ skipped: 1, pending: 12, learned: 0 });
    const md = buildReport(s, { presetName: "x", device: null, date: new Date(2026, 0, 2) });
    expect(md).toContain("| Kick | 36 | - | skipped - kit still has 36 | - |");
    expect(md).toContain("12 pending");
  });

  it("an empty zone reads as no note, an optional skip stays marked", () => {
    const p = kit([piece("kick", { head: 36 }), piece("snare", { head: 38 }), piece("ride", { bow: 51 }), piece("hihat", { closed: 42, open: 46, pedal: 44, splash: 21 })]);
    const rows = summaryRows(createSession(p, REF));
    expect(statusText({ ...rows[0]!, kit: undefined })).toBe("pending - kit has no note");
    expect(statusText({ ...rows[0]!, status: "skipped", optional: true, kit: 5 })).toBe("skipped (optional) - kit still has 5");
  });

  it("a learned redo shows the new note and the kit tracks it", () => {
    let s = captureNote(createSession(FULL, REF), 37, 1).session;
    expect(summaryRows(s)[0]).toMatchObject({ kit: 37, learned: 37 });
    s = redo(s);
    expect(summaryRows(s)[0]).toMatchObject({ kit: 37, learned: undefined, status: "pending" });
  });
});

describe("hits during the confirm window", () => {
  it("queues one different hit and replays it on the next step", () => {
    const c = captureNote(createSession(FULL, REF), 36, 1000); // kick learned
    const q = captureNote(c.session, 38, 1100);
    expect(q.kind).toBe("queued");
    expect(q.effects).toEqual([]);
    expect(captureNote(q.session, 40, 1150).kind).toBe("ignored"); // only one is queued
    const r = advanceAndReplay(q.session, 1400);
    expect(r.kind).toBe("captured");
    expect(r.effects).toEqual([{ piece: "snare", zone: "head", note: 38 }]);
    expect(r.session.queued).toBeNull();
    expect(r.session.index).toBe(1);
  });

  it("ignores a repeat of the learned note and replays nothing without a queue", () => {
    const c = captureNote(createSession(FULL, REF), 36, 1000);
    expect(captureNote(c.session, 36, 1100).kind).toBe("ignored");
    const r = advanceAndReplay(c.session, 1400);
    expect(r.kind).toBe("ignored");
    expect(r.session.index).toBe(1);
    expect(isListening(r.session)).toBe(true);
  });

  it("a queued hit that duplicates a held note raises the warning on replay", () => {
    const c = captureNote(createSession(FULL, REF), 36, 1000);
    const q = captureNote(c.session, 40, 1100); // snare rim holds 40; current step is snare head
    const r = advanceAndReplay(q.session, 1400);
    expect(r.kind).toBe("duplicate");
    expect(r.session.duplicate?.otherKey).toBe("snare:rim");
  });
});

describe("reset to default keeps mirrored", () => {
  it("composition used by the editor", () => {
    const base = { ...createDefaultPreset(), name: "Lefty" };
    const mirrored = setMirrored(base, true);
    const reset = setMirrored(resetToNitroMaxDefault(setLocked(mirrored, false)), mirrored.mirrored);
    expect(reset.mirrored).toBe(true);
    expect(reset.name).toBe("Lefty");
    const kick = (p: KitPreset) => p.pieces.find((x) => x.id === "kick")!.x;
    expect(kick(reset)).toBeCloseTo(1 - kick(createDefaultPreset()), 6);
    expect(reset.pieces.find((x) => x.id === "kick")!.midiNotes).toEqual(createDefaultPreset().pieces.find((x) => x.id === "kick")!.midiNotes);
  });
});
