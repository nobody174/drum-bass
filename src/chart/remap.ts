import type { KitPreset, PieceId } from "../kit/types";
import type { NoteEvent } from "./types";

export interface RemapEntry {
  from: PieceId;
  to: PieceId | null;
  count: number;
}

export interface RemapResult {
  notes: NoteEvent[];
  /** One entry per source piece that was moved or dropped (pieces that map to themselves are omitted). */
  remapped: RemapEntry[];
}

const TOMS: PieceId[] = ["tom1", "tom2", "tom3", "tom4"];
const CRASHES: PieceId[] = ["crash1", "crash2", "crash3"];

const idx = (p: PieceId, list: PieceId[]) => list.indexOf(p);
const byDistance = (from: PieceId, list: PieceId[]) =>
  list.filter((p) => p !== from).sort((a, b) => Math.abs(idx(a, list) - idx(from, list)) - Math.abs(idx(b, list) - idx(from, list)) || idx(a, list) - idx(b, list));

/** Ordered substitution candidates for a piece the kit does not have (SPEC 4.4). */
export function fallbackChain(piece: PieceId): PieceId[] {
  switch (piece) {
    case "tom1": case "tom2": case "tom3": case "tom4":
      return [...byDistance(piece, TOMS), "snare"];
    case "crash1": case "crash2": case "crash3":
      return ["crash1", ...byDistance(piece, CRASHES), "china", "splash", "ride"];
    case "ride":
      return [...CRASHES, "china", "splash", "hihat"];
    case "hihat":
      return ["ride", ...CRASHES, "splash", "china"];
    case "splash":
      return [...CRASHES, "china", "ride", "hihat"];
    case "china":
      return [...CRASHES, "splash", "ride", "hihat"];
    default:
      return []; // kick, snare: required, no substitute
  }
}

export function resolvePiece(piece: PieceId, available: ReadonlySet<PieceId>): PieceId | null {
  if (available.has(piece)) return piece;
  for (const c of fallbackChain(piece)) if (available.has(c)) return c;
  return null;
}

/** Map canonical chart pieces onto the pieces the user's kit actually has. Does not mutate the input. */
export function remapToKit(notes: NoteEvent[], preset: KitPreset): RemapResult {
  const available = new Set<PieceId>(preset.pieces.map((p) => p.id));
  const cache = new Map<PieceId, PieceId | null>();
  const counts = new Map<PieceId, number>();
  const out: NoteEvent[] = [];
  for (const n of notes) {
    let to = cache.get(n.piece);
    if (to === undefined) {
      to = resolvePiece(n.piece, available);
      cache.set(n.piece, to);
    }
    if (to !== n.piece) counts.set(n.piece, (counts.get(n.piece) ?? 0) + 1);
    if (to === null) continue;
    out.push(to === n.piece ? n : { ...n, piece: to });
  }
  const remapped: RemapEntry[] = [...counts].map(([from, count]) => ({ from, to: cache.get(from) ?? null, count }));
  return { notes: out, remapped };
}

/** Short human-readable lines for the Pre-play notice, e.g. "tom3 -> tom2 (12 notes)". */
export function describeRemap(remapped: RemapEntry[]): string[] {
  return remapped.map((r) => `${r.from} -> ${r.to ?? "dropped"} (${r.count} ${r.count === 1 ? "note" : "notes"})`);
}
