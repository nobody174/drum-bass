/**
 * Pure kit-model functions (SPEC sections 4 and 5). Nothing here mutates its input; every change
 * returns a new preset with a fresh `updatedAt`. No-ops return the input object unchanged.
 */
import { EXTRA_PIECE_NOTES, STARTER_NOTES } from '../midi/starterMap';
import type { KitPiece, KitPreset, NoteMatch, PieceId, PieceKind } from './types';

/** Stage aspect ratio (width / height). Piece `size` is relative to stage HEIGHT. */
export const STAGE_ASPECT = 16 / 9;
export const MIN_SIZE = 0.05;
export const MAX_SIZE = 0.5;

/** Per-group piece limits (SPEC 4.1). Splash and china are each 0-1 (SPEC says 0-2 combined). */
export const PIECE_LIMITS: Record<string, { min: number; max: number }> = {
  kick: { min: 1, max: 1 },
  snare: { min: 1, max: 1 },
  hihat: { min: 0, max: 1 },
  tom: { min: 0, max: 4 },
  crash: { min: 0, max: 3 },
  ride: { min: 0, max: 1 },
  splash: { min: 0, max: 1 },
  china: { min: 0, max: 1 },
};

/** Canonical piece order; presets keep their pieces sorted like this (deterministic matchNote). */
export const PIECE_ORDER: readonly PieceId[] = [
  'kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3', 'tom4',
  'crash1', 'crash2', 'crash3', 'ride', 'splash', 'china',
];

interface PieceDefaults {
  kind: PieceKind;
  x: number;
  y: number;
  size: number;
  color: string;
  notes: Record<string, number>;
}

/**
 * Piece defaults, x 0..1 left to right, y 0 far .. 1 near the drummer (right-handed kit seen from
 * the drummer's seat). The first eight come from docs/reference/nitro-max-kit.json (the real kit).
 * tom4, crash2, crash3, splash and china are NOT on the real kit; they exist only so a user can
 * still add them in the editor (placed on a free spot by addPiece).
 */
const DEFAULTS: Record<PieceId, PieceDefaults> = {
  kick: { kind: 'pedal', x: 0.58, y: 0.83, size: 0.2, color: '#ff7a1a', notes: { head: STARTER_NOTES.kick } },
  snare: {
    kind: 'drum', x: 0.44, y: 0.6, size: 0.24, color: '#e5322d',
    notes: { head: STARTER_NOTES.snare, rim: STARTER_NOTES.snareRim },
  },
  // Single-zone cymbal pad plus foot controller; the pedal (44) is a zone, not a separate piece.
  hihat: {
    kind: 'cymbal', x: 0.22, y: 0.48, size: 0.24, color: '#f7d117',
    notes: {
      closed: STARTER_NOTES.hihatClosed, open: STARTER_NOTES.hihatOpen, pedal: STARTER_NOTES.hihatPedal,
      halfOpen: STARTER_NOTES.hihatHalfOpen, splash: STARTER_NOTES.hihatSplash,
    },
  },
  tom1: { kind: 'drum', x: 0.48, y: 0.35, size: 0.19, color: '#2f7bff', notes: { head: STARTER_NOTES.tom1 } },
  tom2: { kind: 'drum', x: 0.62, y: 0.36, size: 0.19, color: '#17c3b2', notes: { head: STARTER_NOTES.tom2 } },
  tom3: { kind: 'drum', x: 0.67, y: 0.61, size: 0.19, color: '#9b5de5', notes: { head: STARTER_NOTES.tom3 } },
  tom4: { kind: 'drum', x: 0.88, y: 0.8, size: 0.2, color: '#e056a0', notes: { head: EXTRA_PIECE_NOTES.tom4 } },
  crash1: { kind: 'cymbal', x: 0.44, y: 0.14, size: 0.24, color: '#27d3ff', notes: { bow: STARTER_NOTES.crash1 } },
  // GM crash cymbal 2 = 57 (CYM 2 expansion input on the real module).
  crash2: { kind: 'cymbal', x: 0.7, y: 0.15, size: 0.24, color: '#7fe9ff', notes: { bow: EXTRA_PIECE_NOTES.crash2 } },
  // GM splash = 55 (crash3 uses it as a placeholder; MIDI learn decides).
  crash3: { kind: 'cymbal', x: 0.05, y: 0.4, size: 0.2, color: '#a8d8ff', notes: { bow: 55 } },
  // Single-zone ride pad: bow only, no bell zone.
  ride: { kind: 'cymbal', x: 0.8, y: 0.5, size: 0.24, color: '#f4f4f4', notes: { bow: STARTER_NOTES.ride } },
  splash: { kind: 'cymbal', x: 0.3, y: 0.1, size: 0.14, color: '#b7f0ff', notes: { bow: 55 } },
  china: { kind: 'cymbal', x: 0.9, y: 0.1, size: 0.18, color: '#ffb347', notes: { bow: 52 } },
};

export const NITRO_MAX_NOTE =
  'UNVERIFIED: the Nitro Max notes come from the user guide PDF text (section 5.2) and the layout from photos. Verify with MIDI learn.';

/** Name of the built-in preset. */
export const NITRO_MAX_NAME = 'Alesis Nitro Max';
/** Bump when the default kit changes; stored in `preset.template.version`. */
export const NITRO_MAX_TEMPLATE_VERSION = 2;
/** The real kit's pieces, in canonical order. No crash2, no tom4. */
export const NITRO_MAX_PIECES: readonly PieceId[] = [
  'kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3', 'crash1', 'ride',
];

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'kit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const round9 = (v: number) => Math.round(v * 1e9) / 1e9;

function touch(preset: KitPreset, patch: Partial<KitPreset>): KitPreset {
  return { ...preset, ...patch, updatedAt: Date.now() };
}

function makePiece(id: PieceId, mirrored = false): KitPiece {
  const d = DEFAULTS[id];
  return {
    id,
    kind: d.kind,
    x: mirrored ? round9(1 - d.x) : d.x,
    y: d.y,
    size: d.size,
    color: d.color,
    midiNotes: { ...d.notes },
  };
}

/** Half extents of a piece in normalized stage units (x scaled by the stage aspect ratio). */
function halfExtents(size: number): { rx: number; ry: number } {
  return { ry: size / 2, rx: size / 2 / STAGE_ASPECT };
}

function clampToStage(x: number, y: number, size: number): { x: number; y: number } {
  const { rx, ry } = halfExtents(size);
  return { x: round9(clamp(x, rx, 1 - rx)), y: round9(clamp(y, ry, 1 - ry)) };
}

/** True when two pieces' circles overlap on the (aspect-correct) stage. */
export function piecesOverlap(a: KitPiece, b: KitPiece): boolean {
  const dx = (a.x - b.x) * STAGE_ASPECT;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) < (a.size + b.size) / 2;
}

/** Next unused "Kit N" name given existing preset names. */
export function nextKitName(existing: readonly string[]): string {
  const used = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`kit ${n}`)) return `Kit ${n}`;
}

/** `base` if unused (case-insensitive), else "base 2", "base 3", ... */
export function uniqueName(base: string, existing: readonly string[]): string {
  const used = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.trim().toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** The real Alesis Nitro Max (8 pieces, notes from the manual). Fresh id on every call. */
export function createDefaultPreset(): KitPreset {
  return {
    id: newId(),
    name: NITRO_MAX_NAME,
    pieces: NITRO_MAX_PIECES.map((id) => makePiece(id)),
    locked: false,
    mirrored: false,
    updatedAt: Date.now(),
    template: { id: 'nitro-max', version: NITRO_MAX_TEMPLATE_VERSION },
  };
}

/**
 * Pure. Returns the preset with its pieces, locked and mirrored replaced by the Nitro Max
 * default (and the template marker set). Keeps id and name. For the editor's "Reset to Nitro
 * Max default" button: persist the result with kitStore.savePreset.
 */
export function resetToNitroMaxDefault(preset: KitPreset): KitPreset {
  const d = createDefaultPreset();
  return {
    ...preset,
    pieces: d.pieces,
    locked: d.locked,
    mirrored: d.mirrored,
    template: d.template,
    updatedAt: Date.now(),
  };
}

export function pieceGroup(id: PieceId): string {
  if (id.startsWith('tom')) return 'tom';
  if (id.startsWith('crash')) return 'crash';
  return id;
}

export function countGroup(preset: KitPreset, group: string): number {
  return preset.pieces.filter((p) => pieceGroup(p.id) === group).length;
}

export function canAdd(preset: KitPreset, id: PieceId): boolean {
  if (preset.pieces.some((p) => p.id === id)) return false;
  const limit = PIECE_LIMITS[pieceGroup(id)];
  return !!limit && countGroup(preset, pieceGroup(id)) < limit.max;
}

export function canRemove(preset: KitPreset, id: PieceId): boolean {
  if (!preset.pieces.some((p) => p.id === id)) return false;
  const limit = PIECE_LIMITS[pieceGroup(id)];
  return !!limit && countGroup(preset, pieceGroup(id)) > limit.min;
}

/** Preferred default spot if free, else the first free grid cell, else the preferred spot. */
function findFreeSpot(preset: KitPreset, piece: KitPiece): { x: number; y: number } {
  const free = (x: number, y: number) => {
    const c = { ...piece, ...clampToStage(x, y, piece.size) };
    return preset.pieces.every((o) => !piecesOverlap(c, o));
  };
  const pref = clampToStage(piece.x, piece.y, piece.size);
  if (free(pref.x, pref.y)) return pref;
  for (let y = 0.1; y <= 0.9; y += 0.05) {
    for (let x = 0.05; x <= 0.95; x += 0.05) {
      if (free(x, y)) return clampToStage(x, y, piece.size);
    }
  }
  return pref;
}

/** Adds a piece with default notes/color. No-op if present, the group limit is reached, or locked. */
export function addPiece(preset: KitPreset, id: PieceId): KitPreset {
  if (preset.locked || !canAdd(preset, id)) return preset;
  const base = makePiece(id, preset.mirrored);
  const spot = findFreeSpot(preset, base);
  const piece = { ...base, ...spot };
  const pieces = [...preset.pieces, piece].sort((a, b) => PIECE_ORDER.indexOf(a.id) - PIECE_ORDER.indexOf(b.id));
  return touch(preset, { pieces });
}

/** Removes a piece unless that would go below the group minimum (kick/snare can never be removed). No-op when locked. No-op when locked. */
export function removePiece(preset: KitPreset, id: PieceId): KitPreset {
  if (preset.locked || !canRemove(preset, id)) return preset;
  return touch(preset, { pieces: preset.pieces.filter((p) => p.id !== id) });
}

function mapPiece(preset: KitPreset, id: PieceId, fn: (p: KitPiece) => KitPiece): KitPreset {
  if (!preset.pieces.some((p) => p.id === id)) return preset;
  return touch(preset, { pieces: preset.pieces.map((p) => (p.id === id ? fn(p) : p)) });
}

/** Moves a piece (stage coordinates), clamped so its whole circle stays on the stage. No-op when locked. */
export function movePiece(
  preset: KitPreset, id: PieceId, x: number, y: number, opts?: { snap?: number },
): KitPreset {
  if (preset.locked) return preset;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return preset;
  const snap = opts?.snap && opts.snap > 0 ? opts.snap : 0;
  return mapPiece(preset, id, (p) => {
    const sx = snap ? Math.round(x / snap) * snap : x;
    const sy = snap ? Math.round(y / snap) * snap : y;
    return { ...p, ...clampToStage(sx, sy, p.size) };
  });
}

/** Resizes (clamped 0.05..0.5) and keeps the piece inside the stage. No-op when locked. */
export function resizePiece(preset: KitPreset, id: PieceId, size: number): KitPreset {
  if (preset.locked || !Number.isFinite(size)) return preset;
  const s = clamp(size, MIN_SIZE, MAX_SIZE);
  return mapPiece(preset, id, (p) => ({ ...p, size: s, ...clampToStage(p.x, p.y, s) }));
}

export function setLocked(preset: KitPreset, locked: boolean): KitPreset {
  return touch(preset, { locked });
}

/** Flips every piece around x = 0.5 and toggles the flag. Deliberately allowed when locked: it is a view switch for left-handed players, not layout editing. */
export function setMirrored(preset: KitPreset, mirrored: boolean): KitPreset {
  if (preset.mirrored === mirrored) return preset;
  return touch(preset, {
    mirrored,
    pieces: preset.pieces.map((p) => ({ ...p, x: round9(1 - p.x) })),
  });
}

export function renamePreset(preset: KitPreset, name: string): KitPreset {
  const n = name.trim();
  if (!n || n === preset.name) return preset;
  return touch(preset, { name: n });
}

/**
 * Stores a MIDI note for a zone. Allowed while the layout is locked: MIDI learn is not layout editing.
 * Invalid notes (not an integer 0..127) and unknown pieces are ignored.
 */
export function setNote(preset: KitPreset, id: PieceId, zone: string, note: number): KitPreset {
  if (!Number.isInteger(note) || note < 0 || note > 127) return preset;
  return mapPiece(preset, id, (p) => ({ ...p, midiNotes: { ...p.midiNotes, [zone]: note } }));
}

/** Removes a zone's note. Also allowed while locked. */
export function clearNote(preset: KitPreset, id: PieceId, zone: string): KitPreset {
  const piece = preset.pieces.find((p) => p.id === id);
  if (!piece || !(zone in piece.midiNotes)) return preset;
  return mapPiece(preset, id, (p) => {
    const midiNotes = { ...p.midiNotes };
    delete midiNotes[zone];
    return { ...p, midiNotes };
  });
}

/** First piece/zone (preset piece order, then zone insertion order) mapped to this note. */
export function matchNote(preset: KitPreset, note: number): NoteMatch | null {
  for (const p of preset.pieces) {
    for (const [zone, n] of Object.entries(p.midiNotes)) {
      if (n === note) return { piece: p.id, zone };
    }
  }
  return null;
}

export function findConflicts(
  preset: KitPreset,
): { note: number; where: { piece: PieceId; zone: string }[] }[] {
  const byNote = new Map<number, { piece: PieceId; zone: string }[]>();
  for (const p of preset.pieces) {
    for (const [zone, n] of Object.entries(p.midiNotes)) {
      const list = byNote.get(n) ?? [];
      list.push({ piece: p.id, zone });
      byNote.set(n, list);
    }
  }
  return [...byNote.entries()]
    .filter(([, where]) => where.length > 1)
    .map(([note, where]) => ({ note, where }))
    .sort((a, b) => a.note - b.note);
}

/** Deep copy with a new id. Name defaults to "<name> copy". */
export function duplicatePreset(preset: KitPreset, name?: string): KitPreset {
  return {
    ...preset,
    id: newId(),
    name: name?.trim() || `${preset.name} copy`,
    pieces: preset.pieces.map((p) => ({ ...p, midiNotes: { ...p.midiNotes } })),
    updatedAt: Date.now(),
  };
}
