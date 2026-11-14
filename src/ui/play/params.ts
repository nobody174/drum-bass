import type { Difficulty, StemRole } from "../../chart/types";
import type { PieceId } from "../../kit/types";
import type { MixMode } from "../../audio/transport";
import { planMix } from "../../audio/stems";
import { settingsStore } from "../../settings/store";
import { DEFAULT_APPROACH_SEC, clampApproach } from "../../render/kitGeometry";

export type DisplayMode = "lanes" | "kit";
export const DISPLAY_KEY = "drum-bass.settings.display";
export const APPROACH_KEY = "drum-bass.settings.approach";

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode or blocked storage: the setting just does not persist */
  }
}

export const parseDisplayMode = (v: string | null | undefined): DisplayMode | null => (v === "lanes" || v === "kit" ? v : null);
/** Persisted default display mode (lanes unless the user chose otherwise). */
export const loadDisplayMode = (): DisplayMode => parseDisplayMode(readStore(DISPLAY_KEY)) ?? "lanes";
export const saveDisplayMode = (m: DisplayMode): void => writeStore(DISPLAY_KEY, m);
const OLD_DEFAULT_APPROACH_SEC = 1.5;
export const loadApproach = (): number => {
  const raw = readStore(APPROACH_KEY);
  if (raw === null || raw.trim() === "") return DEFAULT_APPROACH_SEC;
  const v = Number(raw);
  // 1.5 was the old default: anyone holding it never moved the slider, so they get the new default.
  return v === OLD_DEFAULT_APPROACH_SEC ? DEFAULT_APPROACH_SEC : clampApproach(v);
};
export const saveApproach = (s: number): void => writeStore(APPROACH_KEY, String(clampApproach(s)));

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert"];
export const MIXES: { id: MixMode; label: string }[] = [
  { id: "full", label: "Full" },
  { id: "nodrums", label: "No drums" },
  { id: "drumsonly", label: "Drums only" },
  { id: "clickonly", label: "Click only" },
];
export const COUNT_INS = [0, 2, 4];

export interface PlayParams {
  difficulty: Difficulty;
  mix: MixMode;
  countIn: number;
  /** Renderer: falling lanes or notes on the kit. */
  display: DisplayMode;
  /** Kit view: seconds a ring is visible before its note. */
  approach: number;
}

export function mixAvailability(roles: readonly StemRole[]): Record<MixMode, boolean> {
  const p = planMix(roles, "full");
  return {
    full: roles.length > 0,
    nodrums: p.nodrumsAvailable,
    drumsonly: p.drumsonlyAvailable,
    clickonly: true,
  };
}

export function defaultDifficulty(present: Difficulty[]): Difficulty {
  return present.includes("medium") ? "medium" : (present[0] ?? "medium");
}

export function defaultMix(roles: readonly StemRole[]): MixMode {
  return roles.length > 0 ? "full" : "clickonly";
}

export function playHref(songId: string, p: PlayParams): string {
  return `#/play/${encodeURIComponent(songId)}?d=${p.difficulty}&m=${p.mix}&c=${p.countIn}&v=${p.display}&a=${p.approach}`;
}

export function parseParams(q: URLSearchParams, present: Difficulty[], roles: readonly StemRole[]): PlayParams {
  const d = q.get("d") as Difficulty | null;
  const m = q.get("m") as MixMode | null;
  const raw = q.get("c");
  const c = raw === null || raw.trim() === "" ? settingsStore.get().defaultCountIn : Number(raw); // Number(null) is 0: absent means the default
  return {
    difficulty: d && present.includes(d) ? d : defaultDifficulty(present),
    mix: m && MIXES.some((x) => x.id === m) ? m : defaultMix(roles),
    countIn: Number.isFinite(c) && c >= 0 && c <= 8 ? Math.round(c) : settingsStore.get().defaultCountIn,
    display: parseDisplayMode(q.get("v")) ?? loadDisplayMode(),
    approach: q.get("a") !== null && q.get("a")!.trim() !== "" ? clampApproach(Number(q.get("a"))) : loadApproach(),
  };
}

const PIECE_NAMES: Partial<Record<PieceId, string>> = {
  kick: "kick", snare: "snare", hihat: "hi-hat", tom1: "tom 1", tom2: "tom 2", tom3: "tom 3", tom4: "tom 4",
  crash1: "crash 1", crash2: "crash 2", crash3: "crash 3", ride: "ride", splash: "splash", china: "china",
};
export const pieceName = (p: PieceId): string => PIECE_NAMES[p] ?? p;

/** "No tom 3: mapped to tom 2 (12 notes)". */
export function remapLine(r: { from: PieceId; to: PieceId | null; count: number }): string {
  const n = `${r.count} ${r.count === 1 ? "note" : "notes"}`;
  return r.to ? `No ${pieceName(r.from)}: mapped to ${pieceName(r.to)} (${n})` : `No ${pieceName(r.from)}: dropped (${n})`;
}
