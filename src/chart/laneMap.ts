import type { PieceId } from "../kit/types";

/** Clone Hero / Rock Band drum lanes, shared by the .mid and .chart parsers. */
export type Lane = "kick" | "kick2x" | "red" | "yellow" | "blue" | "green" | "orange";

/**
 * Lane -> canonical piece.
 * 4-lane pro drums (Rock Band layout): yellow/blue/green are toms when marked, otherwise cymbals:
 *   yellow tom tom1 / cymbal hihat, blue tom2 / ride, green tom3 / crash1.
 * 5-lane (lane types verified: yellow/orange cymbals, red/blue/green toms; the piece choice is ours): yellow hihat,
 *   blue tom1, orange crash1, green tom2. Tom/cymbal markers are ignored in 5-lane mode.
 */
export function lanePiece(lane: Lane, isTom: boolean, fiveLane: boolean): PieceId {
  switch (lane) {
    case "kick":
    case "kick2x":
      return "kick";
    case "red":
      return "snare";
    case "yellow":
      return fiveLane ? "hihat" : isTom ? "tom1" : "hihat";
    case "blue":
      return fiveLane ? "tom1" : isTom ? "tom2" : "ride";
    case "green":
      return fiveLane ? "tom2" : isTom ? "tom3" : "crash1";
    case "orange":
      return "crash1";
  }
}

export const PIECE_SORT: PieceId[] = [
  "kick", "snare", "hihat", "tom1", "tom2", "tom3", "tom4", "crash1", "crash2", "crash3", "ride", "splash", "china",
];

export function sortNotes<T extends { timeSec: number; piece: PieceId }>(notes: T[]): T[] {
  return notes.sort((a, b) => a.timeSec - b.timeSec || PIECE_SORT.indexOf(a.piece) - PIECE_SORT.indexOf(b.piece));
}

/** Drop duplicate (same time + piece) notes from a sorted list, e.g. kick and 2x kick on the same tick. */
export function dedupeNotes<T extends { timeSec: number; piece: PieceId }>(sorted: T[]): T[] {
  const out: T[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.piece === n.piece && Math.abs(prev.timeSec - n.timeSec) < 1e-9) continue;
    out.push(n);
  }
  return out;
}
