import type { Difficulty, StemRole } from "../../chart/types";
import type { PieceId } from "../../kit/types";
import type { MixMode } from "../../audio/transport";
import { planMix } from "../../audio/stems";

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
  return `#/play/${encodeURIComponent(songId)}?d=${p.difficulty}&m=${p.mix}&c=${p.countIn}`;
}

export function parseParams(q: URLSearchParams, present: Difficulty[], roles: readonly StemRole[]): PlayParams {
  const d = q.get("d") as Difficulty | null;
  const m = q.get("m") as MixMode | null;
  const raw = q.get("c");
  const c = raw === null || raw.trim() === "" ? 4 : Number(raw); // Number(null) is 0: absent means the default
  return {
    difficulty: d && present.includes(d) ? d : defaultDifficulty(present),
    mix: m && MIXES.some((x) => x.id === m) ? m : defaultMix(roles),
    countIn: Number.isFinite(c) && c >= 0 && c <= 8 ? Math.round(c) : 4,
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
