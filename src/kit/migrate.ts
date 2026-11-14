/**
 * Saved-preset migration to the real Nitro Max default (template version 2).
 *
 * Pure planning only; the store applies the plan. Rules:
 * - Only presets named exactly "Alesis Nitro Max" without a `template` field are candidates.
 * - A candidate that still equals the OLD default (frozen below) is replaced in place by the new
 *   default (same id, so the active selection stays).
 * - A candidate the user modified is left alone; the new default is ADDED once as
 *   "Alesis Nitro Max (real kit)".
 * - Everything else (renamed, copies, already templated) is never touched.
 */
import { createDefaultPreset, NITRO_MAX_NAME, resetToNitroMaxDefault, uniqueName } from './model';
import type { KitPiece, KitPreset } from './types';

export const NITRO_MAX_EXTRA_NAME = 'Alesis Nitro Max (real kit)';
/** Meta key recording that the migration ran (value = template version). */
export const MIGRATION_META_KEY = 'kitMigration.nitroMax';
export const MIGRATION_DONE_VALUE = '2';

type OldPiece = Omit<KitPiece, 'midiNotes'> & { midiNotes: Record<string, number> };

/** The Nitro Max default as shipped before template version 2 (frozen; do not edit). */
export const OLD_DEFAULT_PIECES: readonly OldPiece[] = Object.freeze([
  { id: 'kick', kind: 'pedal', x: 0.5, y: 0.82, size: 0.3, color: '#ff7a1a', midiNotes: { head: 36 } },
  { id: 'snare', kind: 'drum', x: 0.3, y: 0.62, size: 0.24, color: '#e5322d', midiNotes: { head: 38, rim: 37 } },
  {
    id: 'hihat', kind: 'cymbal', x: 0.12, y: 0.55, size: 0.22, color: '#f7d117',
    midiNotes: { closed: 42, open: 46, pedal: 44 },
  },
  { id: 'tom1', kind: 'drum', x: 0.4, y: 0.3, size: 0.18, color: '#2f7bff', midiNotes: { head: 48 } },
  { id: 'tom2', kind: 'drum', x: 0.54, y: 0.3, size: 0.18, color: '#17c3b2', midiNotes: { head: 47 } },
  { id: 'tom3', kind: 'drum', x: 0.74, y: 0.62, size: 0.22, color: '#9b5de5', midiNotes: { head: 45 } },
  { id: 'crash1', kind: 'cymbal', x: 0.16, y: 0.18, size: 0.24, color: '#27d3ff', midiNotes: { bow: 49 } },
  { id: 'crash2', kind: 'cymbal', x: 0.7, y: 0.15, size: 0.24, color: '#7fe9ff', midiNotes: { bow: 57 } },
  { id: 'ride', kind: 'cymbal', x: 0.88, y: 0.35, size: 0.28, color: '#f4f4f4', midiNotes: { bow: 51, bell: 53 } },
] as OldPiece[]);

function sameNotes(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && a[k] === b[k]);
}

/** True when the preset's layout, notes and flags exactly equal the old shipped default. */
export function isOldDefaultKit(p: KitPreset): boolean {
  if (p.locked || p.mirrored || p.pieces.length !== OLD_DEFAULT_PIECES.length) return false;
  return OLD_DEFAULT_PIECES.every((o, i) => {
    const q = p.pieces[i]!;
    return q.id === o.id && q.kind === o.kind && q.x === o.x && q.y === o.y && q.size === o.size &&
      q.color === o.color && sameNotes(q.midiNotes, o.midiNotes);
  });
}

export interface MigrationPlan {
  /** Presets to overwrite (same ids as stored). */
  replace: KitPreset[];
  /** New presets to add. */
  add: KitPreset[];
}

export function planNitroMaxMigration(presets: readonly KitPreset[]): MigrationPlan {
  const plan: MigrationPlan = { replace: [], add: [] };
  const candidates = presets.filter((p) => p.name === NITRO_MAX_NAME && !p.template);
  let needExtra = false;
  for (const p of candidates) {
    if (isOldDefaultKit(p)) plan.replace.push(resetToNitroMaxDefault(p));
    else needExtra = true;
  }
  // Add the real kit once, and only if no preset on the new template exists already.
  const hasNew = presets.some((p) => p.template?.id === 'nitro-max') || plan.replace.length > 0;
  if (needExtra && !hasNew) {
    const extra = createDefaultPreset();
    extra.name = uniqueName(NITRO_MAX_EXTRA_NAME, presets.map((p) => p.name));
    plan.add.push(extra);
  }
  return plan;
}
