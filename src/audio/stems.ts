import type { StemRole } from "../chart/types";
import type { MixMode } from "./transport";

export interface MixPlan {
  /** Gain (0 or 1) per role. Roles not present in the input are absent. */
  gainsByRole: Partial<Record<StemRole, number>>;
  /** False when the mode cannot be honoured exactly (see planMix). */
  nodrumsAvailable: boolean;
  drumsonlyAvailable: boolean;
}

const isDrums = (r: StemRole) => r === "drums";

/** Which role-sets are present. */
function analyse(roles: readonly StemRole[]) {
  const hasDrums = roles.some(isDrums);
  const hasFull = roles.includes("full");
  const others = roles.filter((r) => !isDrums(r) && r !== "full");
  return { hasDrums, hasFull, hasOthers: others.length > 0 };
}

/**
 * Pure mix planning from the stem roles.
 * - full: the `full` stem alone when present (the rest would double up), else every stem.
 * - nodrums: every stem except drums (and except `full`, which contains drums). When only a
 *   `full` stem exists there is nothing to subtract: fall back to it and report nodrumsAvailable=false.
 *   With nothing but a drums stem the result is silent and nodrumsAvailable=false.
 * - drumsonly: the drums stem; silent and drumsonlyAvailable=false when there is none.
 * - clickonly: all gains 0.
 */
export function planMix(roles: readonly StemRole[], mode: MixMode): MixPlan {
  const { hasDrums, hasFull, hasOthers } = analyse(roles);
  const nodrumsAvailable = hasOthers;
  const drumsonlyAvailable = hasDrums;
  const gainsByRole: Partial<Record<StemRole, number>> = {};
  for (const r of roles) {
    let g = 0;
    switch (mode) {
      case "full":
        g = hasFull ? (r === "full" ? 1 : 0) : 1;
        break;
      case "nodrums":
        if (hasOthers) g = isDrums(r) || r === "full" ? 0 : 1;
        else g = r === "full" ? 1 : 0; // fallback to the full mix (or silence if there is none)
        break;
      case "drumsonly":
        g = isDrums(r) ? 1 : 0;
        break;
      case "clickonly":
        g = 0;
        break;
    }
    gainsByRole[r] = g;
  }
  return { gainsByRole, nodrumsAvailable, drumsonlyAvailable };
}

/** Per-stem gains in input order (stems sharing a role share a gain). */
export function gainsForStems(roles: readonly StemRole[], mode: MixMode): number[] {
  const plan = planMix(roles, mode);
  return roles.map((r) => plan.gainsByRole[r] ?? 0);
}
