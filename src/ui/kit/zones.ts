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

/** Zone display names. Unknown zone keys (custom kits) are shown as stored. */
export const ZONE_NAMES: Record<string, string> = {
  head: "head", rim: "rim", bow: "bow", bell: "bell",
  closed: "closed", open: "open", pedal: "pedal", halfOpen: "half-open", splash: "splash",
};

/** Canonical zones per piece on the real Nitro Max (docs/reference/nitro-max-kit.md). */
function canonicalZones(id: PieceId): string[] {
  if (id === "snare") return ["head", "rim"];
  if (id === "hihat") return ["closed", "open", "pedal", "halfOpen", "splash"];
  if (id.startsWith("crash") || id === "ride" || id === "splash" || id === "china") return ["bow"];
  return ["head"]; // kick, toms
}

/**
 * Learnable zones for a piece: the canonical ones first, then any other key the preset's midiNotes already
 * holds (legacy "bell" on a ride, custom zones), so custom kits keep working and nothing assigned is hidden.
 */
export function zonesFor(id: PieceId, midiNotes?: Record<string, number>): string[] {
  const base = canonicalZones(id);
  if (!midiNotes) return base;
  return [...base, ...Object.keys(midiNotes).filter((z) => !base.includes(z))];
}

export function zoneName(zone: string): string {
  return ZONE_NAMES[zone] ?? zone;
}

/** "Snare rim", "Hi-hat half-open", "Tom 1" (single "head" zones are implied except on the snare). */
export function stepLabel(id: PieceId, zone: string): string {
  const name = PIECE_NAMES[id];
  if (zone === "head" && id !== "snare") return name;
  if (zone === "bow" && id !== "ride") return name;
  return `${name} ${zoneName(zone)}`;
}

export function isCymbal(id: PieceId): boolean {
  return id.startsWith("crash") || id === "ride" || id === "splash" || id === "china" || id === "hihat";
}
