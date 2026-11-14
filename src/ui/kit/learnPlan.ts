/**
 * Pure logic for the "Learn all pads" wizard: step list, session state machine, summary and Markdown report.
 * No DOM, no timers: the UI feeds it notes (with timestamps) and applies the returned effects to the preset.
 */
import { createDefaultPreset } from "../../kit";
import type { KitPreset, PieceId } from "../../kit";
import { stepLabel, zonesFor } from "./zones";

export type StepStatus = "pending" | "learned" | "skipped";

export interface LearnStep {
  key: string;
  piece: PieceId;
  zone: string;
  label: string;
  /** Optional steps are marked "optional/skip" in the UI and never block finishing. */
  optional: boolean;
  /** Note of the manual-derived default preset for the same piece/zone. Undefined for custom pieces/zones. */
  expected: number | undefined;
  learned: number | undefined;
  status: StepStatus;
  /** True when a Replace cleared this zone's note: it needs to be learned again. */
  cleared: boolean;
}

/** Preferred order of the main pieces; every piece not listed follows in preset order. */
const MAIN_ORDER: { piece: PieceId; zones: string[] }[] = [
  { piece: "kick", zones: ["head"] },
  { piece: "snare", zones: ["head", "rim"] },
  { piece: "tom1", zones: ["head"] },
  { piece: "tom2", zones: ["head"] },
  { piece: "tom3", zones: ["head"] },
  { piece: "hihat", zones: ["closed", "open", "pedal", "halfOpen", "splash"] },
  { piece: "crash1", zones: ["bow"] },
  { piece: "ride", zones: ["bow"] },
];
/** Hi-hat zones that are optional steps (the manual lists them, but not every player uses them). */
const OPTIONAL_ZONES = new Set(["halfOpen", "splash"]);

/**
 * Builds the ordered step list from the preset's own pieces and zones. A piece only produces steps when the
 * preset has it. Required zones always get a step; optional hi-hat zones only when the preset has a note for
 * them. Keys the preset holds beyond the canonical zones (legacy "bell", custom) become optional steps.
 * `reference` is the manual-default preset (createDefaultPreset()); injectable for tests.
 */
export function buildPlan(preset: KitPreset, reference: KitPreset = createDefaultPreset()): LearnStep[] {
  const refNote = (piece: PieceId, zone: string) => reference.pieces.find((p) => p.id === piece)?.midiNotes[zone];
  const steps: LearnStep[] = [];
  const add = (piece: PieceId, zone: string, optional: boolean) => {
    steps.push({
      key: `${piece}:${zone}`, piece, zone, label: stepLabel(piece, zone), optional,
      expected: refNote(piece, zone), learned: undefined, status: "pending", cleared: false,
    });
  };
  const handled = new Set<PieceId>();
  const emit = (piece: PieceId, mainZones: string[] | null) => {
    const p = preset.pieces.find((x) => x.id === piece);
    if (!p) return;
    handled.add(piece);
    const all = zonesFor(piece, p.midiNotes);
    const main = mainZones ?? [];
    for (const zone of all) {
      const canonicalMain = mainZones ? main.includes(zone) : false;
      if (canonicalMain) {
        const optional = piece === "hihat" && OPTIONAL_ZONES.has(zone);
        if (optional && !(zone in p.midiNotes)) continue; // optional zone this preset does not have
        add(piece, zone, optional);
      } else if (mainZones) {
        add(piece, zone, true); // extra key on a main piece
      } else {
        add(piece, zone, false); // custom piece: every zone is required
      }
    }
  };
  // Required hi-hat zones first, then the optional ones: MAIN_ORDER lists them in that order already.
  for (const m of MAIN_ORDER) emit(m.piece, m.zones);
  for (const p of preset.pieces) if (!handled.has(p.id)) emit(p.id, null);
  return steps;
}

/** Plain-language hint for a step, for people who do not know drum terms. Empty for unknown zones. */
export function stepHelp(piece: PieceId, zone: string): string {
  const k = `${piece}:${zone}`;
  const exact: Record<string, string> = {
    "kick:head": "Kick = the bass drum, hit by the foot pedal (or its pad).",
    "snare:head": "Snare head = the middle of the snare pad, the flat centre.",
    "snare:rim": "Snare rim = the edge/rim of the snare pad.",
    "hihat:closed": "Hi-hat closed = hitting the hi-hat while it is shut (foot pedal pressed down).",
    "hihat:open": "Hi-hat open = hitting the hi-hat while the pedal is released so it rings.",
    "hihat:pedal": "Hi-hat pedal = pressing the foot pedal, without hitting the hi-hat pad.",
    "hihat:halfOpen": "Hi-hat half-open = the pedal pressed halfway, then hit. Optional, skip if unsure.",
    "hihat:splash": "Hi-hat splash = pressing the pedal and lifting at once. Optional, skip if unsure.",
  };
  if (exact[k]) return exact[k]!;
  if (zone === "bow" || zone === "head") return `${stepLabel(piece, zone)} = hit the pad's main surface.`;
  if (zone === "bell") return `${stepLabel(piece, zone)} = the centre bump of the cymbal.`;
  return "";
}

// ---------------------------------------------------------------- session

export const DOUBLE_TRIGGER_MS = 150;

/** Longest the confirm window may last in the UI; hits arriving inside it are queued, not dropped. */
export const CONFIRM_MS = 400;

export type Phase = "listening" | "confirm" | "duplicate" | "done";

/** `otherIndex` is the plan step holding the note, or -1 when the holder is a zone outside the plan. */
export interface DuplicateInfo { note: number; otherIndex: number; otherKey: string; otherLabel: string }

export interface LearnSession {
  steps: LearnStep[];
  index: number;
  phase: Phase;
  duplicate: DuplicateInfo | null;
  /** Last accepted hit, for the double-trigger filter. */
  lastNote: number | null;
  lastAt: number;
  /** What the kit holds per "piece:zone" key right now (preset at start, updated by every effect). */
  held: Record<string, number>;
  /** One hit that arrived during the confirm window; replayed on advance. */
  queued: number | null;
}

/** Changes the UI must apply to the preset (setNote / clearNote). */
export interface NoteEffect { piece: PieceId; zone: string; note: number | null }

export type CaptureKind = "captured" | "ignored" | "duplicate" | "queued";
export interface CaptureResult { session: LearnSession; kind: CaptureKind; effects: NoteEffect[] }

export function createSession(preset: KitPreset, reference: KitPreset = createDefaultPreset()): LearnSession {
  const steps = buildPlan(preset, reference);
  const held: Record<string, number> = {};
  for (const p of preset.pieces) for (const [zone, n] of Object.entries(p.midiNotes)) held[`${p.id}:${zone}`] = n;
  return { steps, index: 0, phase: steps.length ? "listening" : "done", duplicate: null, lastNote: null, lastAt: -Infinity, held, queued: null };
}

export const currentStep = (s: LearnSession): LearnStep | null => s.steps[s.index] ?? null;

/** The wizard listens for a hit only while the current step is pending and nothing else is on screen. */
export function isListening(s: LearnSession): boolean {
  return s.phase === "listening" && currentStep(s)?.status === "pending";
}

const withStep = (s: LearnSession, i: number, patch: Partial<LearnStep>): LearnSession => ({
  ...s, steps: s.steps.map((st, k) => (k === i ? { ...st, ...patch } : st)),
});

/** Another zone (in the plan or not) that the kit already holds `note` for, or null. */
function findHolder(s: LearnSession, note: number, exceptKey: string): { key: string; index: number } | null {
  for (const [key, n] of Object.entries(s.held)) {
    if (n === note && key !== exceptKey) return { key, index: s.steps.findIndex((st) => st.key === key) };
  }
  return null;
}

const labelOfKey = (s: LearnSession, key: string, index: number): string => {
  if (index >= 0) return s.steps[index]!.label;
  const [piece, ...zone] = key.split(":");
  return stepLabel(piece as PieceId, zone.join(":"));
};

/**
 * Feeds one incoming note. Ignored when not listening or when it repeats the last accepted note within
 * DOUBLE_TRIGGER_MS. A note already learned for another step pauses in "duplicate" until resolved.
 */
export function captureNote(s: LearnSession, note: number, now: number): CaptureResult {
  const ignore: CaptureResult = { session: s, kind: "ignored", effects: [] };
  if (!Number.isInteger(note) || note < 0 || note > 127) return ignore;
  if (s.phase === "confirm") {
    // Quick drummers: keep ONE different hit from the confirm window; repeats of the learned note are noise.
    if (s.queued !== null || note === s.lastNote) return ignore;
    return { session: { ...s, queued: note }, kind: "queued", effects: [] };
  }
  if (!isListening(s)) return ignore;
  if (s.lastNote === note && now - s.lastAt < DOUBLE_TRIGGER_MS) return ignore;
  const st = s.steps[s.index]!;
  const holder = findHolder(s, note, st.key);
  const seen = { lastNote: note, lastAt: now };
  if (holder) {
    const duplicate = { note, otherIndex: holder.index, otherKey: holder.key, otherLabel: labelOfKey(s, holder.key, holder.index) };
    return { session: { ...s, ...seen, phase: "duplicate", duplicate }, kind: "duplicate", effects: [] };
  }
  const next = withStep(
    { ...s, ...seen, phase: "confirm", queued: null, held: { ...s.held, [st.key]: note } },
    s.index, { learned: note, status: "learned", cleared: false },
  );
  return { session: next, kind: "captured", effects: [{ piece: st.piece, zone: st.zone, note }] };
}

/**
 * Resolves a duplicate warning. "keep": keep the earlier assignment and listen again (this hit is dropped).
 * "replace": the note moves to the current step; the other zone's note is cleared (and its step, if in the plan,
 * goes back to pending flagged `cleared`). Nothing is cleared unless the user picks this.
 */
export function resolveDuplicate(s: LearnSession, choice: "keep" | "replace"): CaptureResult {
  const d = s.duplicate;
  if (s.phase !== "duplicate" || !d) return { session: s, kind: "ignored", effects: [] };
  if (choice === "keep") return { session: { ...s, phase: "listening", duplicate: null }, kind: "ignored", effects: [] };
  const cur = s.steps[s.index]!;
  const sep = d.otherKey.indexOf(":");
  const oldPiece = d.otherKey.slice(0, sep) as PieceId;
  const oldZone = d.otherKey.slice(sep + 1);
  const held = { ...s.held };
  delete held[d.otherKey];
  held[cur.key] = d.note;
  let next: LearnSession = { ...s, held };
  if (d.otherIndex >= 0) next = withStep(next, d.otherIndex, { learned: undefined, status: "pending", cleared: true });
  next = withStep({ ...next, phase: "confirm", duplicate: null, queued: null }, s.index, { learned: d.note, status: "learned", cleared: false });
  return {
    session: next,
    kind: "captured",
    effects: [{ piece: oldPiece, zone: oldZone, note: null }, { piece: cur.piece, zone: cur.zone, note: d.note }],
  };
}

/** Moves on after the confirmation (or Skip). Past the last step the session is done. */
export function advance(s: LearnSession): LearnSession {
  if (s.phase === "done") return s;
  const i = s.index + 1;
  return i >= s.steps.length ? { ...s, index: s.steps.length - 1, phase: "done", duplicate: null } : { ...s, index: i, phase: "listening", duplicate: null };
}

/**
 * Ends the confirm window: advances, then replays the queued hit (if any) against the new step so it is not lost.
 * The replay can itself be captured (effects to apply) or raise a duplicate warning.
 */
export function advanceAndReplay(s: LearnSession, now: number): CaptureResult {
  const q = s.queued;
  const next = advance({ ...s, queued: null });
  if (q === null || next.phase !== "listening") return { session: next, kind: "ignored", effects: [] };
  return captureNote(next, q, now);
}

export function skip(s: LearnSession): LearnSession {
  const st = currentStep(s);
  if (!st || s.phase === "done") return s;
  const marked = st.status === "learned" ? s : withStep(s, s.index, { status: "skipped", learned: undefined });
  return advance({ ...marked, phase: "listening", queued: null });
}

export function back(s: LearnSession): LearnSession {
  const i = s.phase === "done" ? s.steps.length - 1 : s.index - 1;
  if (i < 0) return s;
  return { ...s, index: i, phase: "listening", duplicate: null, queued: null };
}

/** Clears the current step's result so it listens again. The preset keeps its note until a new hit replaces it. */
export function redo(s: LearnSession): LearnSession {
  if (!currentStep(s)) return s;
  return { ...withStep(s, s.index, { learned: undefined, status: "pending" }), phase: "listening", duplicate: null, queued: null, lastNote: null, lastAt: -Infinity };
}

/** Jump back into the wizard from the summary to redo one row. */
export function goTo(s: LearnSession, index: number): LearnSession {
  if (index < 0 || index >= s.steps.length) return s;
  return redo({ ...s, index, phase: "listening", duplicate: null });
}

export function progress(s: LearnSession): { step: number; total: number; learned: number; skipped: number; pending: number } {
  return {
    step: Math.min(s.index + 1, s.steps.length),
    total: s.steps.length,
    learned: s.steps.filter((x) => x.status === "learned").length,
    skipped: s.steps.filter((x) => x.status === "skipped").length,
    pending: s.steps.filter((x) => x.status === "pending").length,
  };
}

// ---------------------------------------------------------------- summary + report

export interface SummaryRow {
  label: string;
  expected: number | undefined;
  learned: number | undefined;
  status: StepStatus;
  optional: boolean;
  /** Learned a note that differs from the manual default (only when a default exists). */
  differs: boolean;
  /** What the kit holds for this zone right now (differs from `learned` for pending/skipped rows). */
  kit: number | undefined;
  /** A Replace cleared this zone: it must be learned again. */
  cleared: boolean;
}

/** Status text that tells the truth about the kit: a pending/skipped row still shows the note the kit holds. */
export function statusText(r: SummaryRow): string {
  if (r.status === "learned") return "learned";
  const kit = r.kit !== undefined ? `kit still has ${r.kit}` : r.cleared ? "needs re-learn, note cleared" : "kit has no note";
  return r.status === "skipped" ? `skipped${r.optional ? " (optional)" : ""} - ${kit}` : `pending - ${kit}`;
}

export function summaryRows(s: LearnSession): SummaryRow[] {
  return s.steps.map((st) => ({
    label: st.label, expected: st.expected, learned: st.learned, status: st.status, optional: st.optional,
    differs: st.learned !== undefined && st.expected !== undefined && st.learned !== st.expected,
    kit: s.held[st.key], cleared: st.cleared,
  }));
}

export interface Cc4Info { seen: boolean; count: number; min: number; max: number }

export interface ConflictInfo { note: number; where: { piece: PieceId; zone: string }[] }

export interface ReportMeta { presetName: string; device: string | null; date: Date; cc4?: Cc4Info; conflicts?: ConflictInfo[] }

/** One human line per remaining duplicate note (from the model's findConflicts on the final preset). */
export function conflictLines(conflicts: ConflictInfo[]): string[] {
  return conflicts.map((c) => `Note ${c.note} is used by ${c.where.map((w) => stepLabel(w.piece, w.zone)).join(" and ")}.`);
}

const cell = (n: number | undefined) => (n === undefined ? "-" : String(n));
const pad2 = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Markdown the user can paste into docs/m3-kit-verification.md. */
export function buildReport(s: LearnSession, meta: ReportMeta): string {
  const rows = summaryRows(s);
  const lines = [
    `### Learn-all-pads run ${isoDate(meta.date)} ${pad2(meta.date.getHours())}:${pad2(meta.date.getMinutes())}`,
    "",
    `- Date: ${isoDate(meta.date)}`,
    `- MIDI device: ${meta.device ?? "not connected (virtual input or unknown)"}`,
    `- Kit preset: ${meta.presetName}`,
  ];
  if (meta.cc4) {
    lines.push(
      meta.cc4.seen
        ? `- CC4 (hi-hat foot controller): seen, ${meta.cc4.count} messages, values ${meta.cc4.min}..${meta.cc4.max}`
        : "- CC4 (hi-hat foot controller): not seen during this run",
    );
  }
  lines.push("", "| Piece / zone | Manual default | Learned | Status | Differs |", "|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.label} | ${cell(r.expected)} | ${cell(r.learned)} | ${statusText(r)} | ${r.differs ? "YES" : r.learned !== undefined ? "no" : "-"} |`);
  }
  const diff = rows.filter((r) => r.differs).length;
  const pending = rows.filter((r) => r.status === "pending").length;
  lines.push("", `${rows.filter((r) => r.status === "learned").length} of ${rows.length} learned, ${pending} pending, ${diff} differ from the manual defaults.`);
  if (meta.conflicts) {
    lines.push("");
    if (meta.conflicts.length) lines.push("Remaining conflicts (two zones on one note):", "", ...conflictLines(meta.conflicts).map((l) => `- ${l}`));
    else lines.push("No note conflicts in the final kit.");
  }
  return lines.join("\n") + "\n";
}
