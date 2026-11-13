import type { PieceId } from "../../kit";

export const PIECE_NAMES: Record<PieceId, string> = {
  kick: "Kick", snare: "Snare", hihat: "Hi-hat",
  tom1: "Tom 1", tom2: "Tom 2", tom3: "Tom 3", tom4: "Tom 4",
  crash1: "Crash 1", crash2: "Crash 2", crash3: "Crash 3",
  ride: "Ride", splash: "Splash", china: "China",
};

export const PIECE_SHORT: Record<PieceId, string> = {
  kick: "KICK", snare: "SNR", hihat: "HAT",
  tom1: "T1", tom2: "T2", tom3: "T3", tom4: "T4",
  crash1: "C1", crash2: "C2", crash3: "C3",
  ride: "RIDE", splash: "SPL", china: "CHN",
};

/** Learnable zones per piece (SPEC 4.3). Everything else has a single "head" zone. */
export function zonesFor(id: PieceId): string[] {
  if (id === "snare") return ["head", "rim"];
  if (id === "hihat") return ["closed", "open", "pedal"];
  if (id === "ride") return ["bow", "bell"];
  return ["head"];
}

export function isCymbal(id: PieceId): boolean {
  return id.startsWith("crash") || id === "ride" || id === "splash" || id === "china" || id === "hihat";
}
