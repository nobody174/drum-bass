import { describe, expect, it } from 'vitest';
import {
  addPiece, canAdd, clearNote, countGroup, createDefaultPreset, duplicatePreset, findConflicts,
  matchNote, movePiece, pieceGroup, PIECE_LIMITS, piecesOverlap, removePiece, renamePreset,
  resizePiece, setLocked, setMirrored, setNote, STAGE_ASPECT, nextKitName, uniqueName,
} from './model';
import type { KitPreset, PieceId } from './types';

const piece = (p: KitPreset, id: PieceId) => p.pieces.find((x) => x.id === id)!;
const inside = (p: KitPreset) =>
  p.pieces.every((q) => {
    const ry = q.size / 2;
    const rx = ry / STAGE_ASPECT;
    const e = 1e-9;
    return q.x - rx >= -e && q.x + rx <= 1 + e && q.y - ry >= -e && q.y + ry <= 1 + e;
  });

describe('default preset', () => {
  const d = createDefaultPreset();
  it('has the Nitro Max starter pieces', () => {
    expect(d.name).toBe('Alesis Nitro Max');
    expect(d.pieces.map((p) => p.id)).toEqual(
      ['kick', 'snare', 'hihat', 'tom1', 'tom2', 'tom3', 'crash1', 'crash2', 'ride']);
    expect(d.locked).toBe(false);
    expect(d.mirrored).toBe(false);
  });
  it('has correct kinds, zones and notes', () => {
    expect(piece(d, 'kick').kind).toBe('pedal');
    expect(piece(d, 'snare').kind).toBe('drum');
    expect(piece(d, 'crash1').kind).toBe('cymbal');
    expect(Object.keys(piece(d, 'snare').midiNotes)).toEqual(['head', 'rim']);
    expect(Object.keys(piece(d, 'hihat').midiNotes)).toEqual(['closed', 'open', 'pedal']);
    expect(Object.keys(piece(d, 'ride').midiNotes)).toEqual(['bow', 'bell']);
    expect(piece(d, 'crash2').midiNotes.bow).toBe(57);
    expect(piece(d, 'kick').midiNotes.head).toBe(36);
  });
  it('has no overlapping pieces and all pieces inside the stage', () => {
    for (const a of d.pieces) for (const b of d.pieces) if (a !== b) expect(piecesOverlap(a, b)).toBe(false);
    expect(inside(d)).toBe(true);
  });
  it('has no note conflicts', () => {
    expect(findConflicts(d)).toEqual([]);
  });
  it('gives fresh unique ids', () => {
    expect(createDefaultPreset().id).not.toBe(d.id);
  });
  it('is a right-handed layout: hat left of ride, kick lowest', () => {
    expect(piece(d, 'hihat').x).toBeLessThan(piece(d, 'ride').x);
    expect(Math.max(...d.pieces.map((p) => p.y))).toBe(piece(d, 'kick').y);
  });
});

describe('groups and limits', () => {
  const d = createDefaultPreset();
  it('maps ids to groups', () => {
    expect(pieceGroup('tom3')).toBe('tom');
    expect(pieceGroup('crash2')).toBe('crash');
    expect(pieceGroup('hihat')).toBe('hihat');
    expect(countGroup(d, 'tom')).toBe(3);
    expect(countGroup(d, 'crash')).toBe(2);
  });
  it('exposes the limits', () => {
    expect(PIECE_LIMITS.tom).toEqual({ min: 0, max: 4 });
    expect(PIECE_LIMITS.kick).toEqual({ min: 1, max: 1 });
  });
  it('cannot add a 5th tom, can add a 4th', () => {
    const four = addPiece(d, 'tom4');
    expect(countGroup(four, 'tom')).toBe(4);
    expect(canAdd(four, 'tom4')).toBe(false);
    expect(addPiece(four, 'tom4')).toBe(four);
  });
  it('cannot exceed 3 crashes', () => {
    const three = addPiece(d, 'crash3');
    expect(countGroup(three, 'crash')).toBe(3);
    expect(canAdd(three, 'crash3')).toBe(false);
  });
  it('cannot remove kick or snare', () => {
    expect(removePiece(d, 'kick')).toBe(d);
    expect(removePiece(d, 'snare')).toBe(d);
  });
  it('can remove optional pieces and the original stays untouched', () => {
    const r = removePiece(d, 'ride');
    expect(r.pieces.some((p) => p.id === 'ride')).toBe(false);
    expect(d.pieces.some((p) => p.id === 'ride')).toBe(true);
    expect(removePiece(r, 'ride')).toBe(r);
  });
  it('addPiece is a no-op if the piece is present', () => {
    expect(addPiece(d, 'ride')).toBe(d);
  });
  it('addPiece gives defaults, free position and keeps canonical order', () => {
    const a = addPiece(removePiece(d, 'ride'), 'splash');
    const s = piece(a, 'splash');
    expect(s.kind).toBe('cymbal');
    expect(s.midiNotes.bow).toBe(55);
    for (const o of a.pieces) if (o !== s) expect(piecesOverlap(s, o)).toBe(false);
    const full = addPiece(addPiece(addPiece(d, 'tom4'), 'china'), 'splash');
    expect(inside(full)).toBe(true);
    const ids = full.pieces.map((p) => p.id);
    expect(ids.indexOf('tom4')).toBeLessThan(ids.indexOf('crash1'));
    for (const a2 of full.pieces) for (const b of full.pieces) if (a2 !== b) expect(piecesOverlap(a2, b)).toBe(false);
  });
  it('addPiece on a mirrored kit places on the mirrored side', () => {
    const m = setMirrored(removePiece(createDefaultPreset(), 'ride'), true);
    const a = addPiece(m, 'ride');
    expect(piece(a, 'ride').x).toBeLessThan(0.5);
  });
  it('can add a piece to an empty-ish kit (hihat after removal)', () => {
    const a = addPiece(removePiece(d, 'hihat'), 'hihat');
    expect(piece(a, 'hihat').midiNotes.pedal).toBe(44);
  });
});

describe('movePiece', () => {
  const d = createDefaultPreset();
  it('moves and returns a new object without mutating', () => {
    const m = movePiece(d, 'snare', 0.4, 0.5);
    expect(piece(m, 'snare').x).toBeCloseTo(0.4);
    expect(piece(m, 'snare').y).toBeCloseTo(0.5);
    expect(piece(d, 'snare').x).toBe(0.3);
    expect(m).not.toBe(d);
  });
  it('clamps so the circle stays inside the stage', () => {
    for (const [x, y] of [[-5, -5], [5, 5], [0, 1], [1, 0]]) {
      expect(inside(movePiece(d, 'kick', x, y))).toBe(true);
    }
    const k = piece(movePiece(d, 'kick', 5, 5), 'kick');
    expect(k.y + k.size / 2).toBeCloseTo(1);
    expect(k.x + k.size / 2 / STAGE_ASPECT).toBeCloseTo(1);
  });
  it('snaps to a grid', () => {
    const m = movePiece(d, 'snare', 0.4123, 0.5077, { snap: 0.05 });
    expect(piece(m, 'snare').x).toBeCloseTo(0.4);
    expect(piece(m, 'snare').y).toBeCloseTo(0.5);
  });
  it('snap still respects clamping', () => {
    const m = movePiece(d, 'kick', 0.999, 0.999, { snap: 0.5 });
    expect(inside(m)).toBe(true);
  });
  it('is a no-op when locked', () => {
    const l = setLocked(d, true);
    expect(movePiece(l, 'snare', 0.9, 0.9)).toBe(l);
  });
  it('ignores unknown pieces and NaN', () => {
    expect(movePiece(d, 'tom4', 0.5, 0.5)).toBe(d);
    expect(movePiece(d, 'snare', NaN, 0.5)).toBe(d);
  });
});

describe('resizePiece', () => {
  const d = createDefaultPreset();
  it('resizes and clamps 0.05..0.5', () => {
    expect(piece(resizePiece(d, 'snare', 0.3), 'snare').size).toBe(0.3);
    expect(piece(resizePiece(d, 'snare', 0.001), 'snare').size).toBe(0.05);
    expect(piece(resizePiece(d, 'snare', 9), 'snare').size).toBe(0.5);
  });
  it('keeps the piece inside the stage when growing', () => {
    expect(inside(resizePiece(movePiece(d, 'kick', 1, 1), 'kick', 0.5))).toBe(true);
  });
  it('is a no-op when locked', () => {
    const l = setLocked(d, true);
    expect(resizePiece(l, 'snare', 0.4)).toBe(l);
  });
});

describe('lock, mirror, rename', () => {
  const d = createDefaultPreset();
  it('setLocked toggles the flag and bumps updatedAt', () => {
    const old = { ...d, updatedAt: 1 };
    const l = setLocked(old, true);
    expect(l.locked).toBe(true);
    expect(l.updatedAt).toBeGreaterThan(1);
    expect(setLocked(l, false).locked).toBe(false);
  });
  it('mirrors x around 0.5 and toggles the flag', () => {
    const m = setMirrored(d, true);
    expect(m.mirrored).toBe(true);
    expect(piece(m, 'snare').x).toBeCloseTo(0.7);
    expect(piece(m, 'snare').y).toBe(piece(d, 'snare').y);
    expect(inside(m)).toBe(true);
  });
  it('mirroring twice returns the original positions', () => {
    const back = setMirrored(setMirrored(d, true), false);
    expect(back.mirrored).toBe(false);
    expect(back.pieces.map((p) => p.x)).toEqual(d.pieces.map((p) => p.x));
  });
  it('mirroring to the same state is a no-op; works while locked', () => {
    expect(setMirrored(d, false)).toBe(d);
    expect(setMirrored(setLocked(d, true), true).mirrored).toBe(true);
  });
  it('renames, trimming, ignoring empty names', () => {
    expect(renamePreset(d, '  Studio  ').name).toBe('Studio');
    expect(renamePreset(d, '   ')).toBe(d);
  });
});

describe('MIDI notes', () => {
  const d = createDefaultPreset();
  it('setNote stores a note without mutating', () => {
    const s = setNote(d, 'snare', 'rim', 40);
    expect(piece(s, 'snare').midiNotes.rim).toBe(40);
    expect(piece(d, 'snare').midiNotes.rim).toBe(37);
  });
  it('setNote can add a new zone', () => {
    expect(piece(setNote(d, 'kick', 'rim', 35), 'kick').midiNotes.rim).toBe(35);
  });
  it('setNote and clearNote work while locked (MIDI learn is not layout editing)', () => {
    const l = setLocked(d, true);
    expect(piece(setNote(l, 'snare', 'head', 99), 'snare').midiNotes.head).toBe(99);
    expect('rim' in piece(clearNote(l, 'snare', 'rim'), 'snare').midiNotes).toBe(false);
  });
  it('rejects invalid notes and unknown pieces', () => {
    expect(setNote(d, 'snare', 'head', 128)).toBe(d);
    expect(setNote(d, 'snare', 'head', -1)).toBe(d);
    expect(setNote(d, 'snare', 'head', 1.5)).toBe(d);
    expect(setNote(d, 'tom4', 'head', 40)).toBe(d);
  });
  it('clearNote is a no-op for a missing zone/piece', () => {
    expect(clearNote(d, 'snare', 'nope')).toBe(d);
    expect(clearNote(d, 'tom4', 'head')).toBe(d);
  });
  it('matchNote finds piece and zone, or null', () => {
    expect(matchNote(d, 38)).toEqual({ piece: 'snare', zone: 'head' });
    expect(matchNote(d, 37)).toEqual({ piece: 'snare', zone: 'rim' });
    expect(matchNote(d, 46)).toEqual({ piece: 'hihat', zone: 'open' });
    expect(matchNote(d, 57)).toEqual({ piece: 'crash2', zone: 'bow' });
    expect(matchNote(d, 100)).toBeNull();
  });
  it('matchNote is deterministic: first piece in order wins on a conflict', () => {
    const c = setNote(d, 'ride', 'bow', 38);
    expect(matchNote(c, 38)).toEqual({ piece: 'snare', zone: 'head' });
  });
  it('findConflicts reports shared notes', () => {
    const c = setNote(setNote(d, 'ride', 'bow', 38), 'tom1', 'head', 36);
    expect(findConflicts(c)).toEqual([
      { note: 36, where: [{ piece: 'kick', zone: 'head' }, { piece: 'tom1', zone: 'head' }] },
      { note: 38, where: [{ piece: 'snare', zone: 'head' }, { piece: 'ride', zone: 'bow' }] },
    ]);
  });
});

describe('duplicatePreset', () => {
  const d = createDefaultPreset();
  it('copies with a new id, default and custom name, deep copied notes', () => {
    const c = duplicatePreset(d);
    expect(c.id).not.toBe(d.id);
    expect(c.name).toBe('Alesis Nitro Max copy');
    expect(duplicatePreset(d, 'Mine').name).toBe('Mine');
    expect(c.pieces).toEqual(d.pieces);
    expect(c.pieces[1]!.midiNotes).not.toBe(d.pieces[1]!.midiNotes);
  });
});

describe('lock rule for structure', () => {
  const l = setLocked(createDefaultPreset(), true);
  it('addPiece and removePiece are no-ops when locked', () => {
    expect(addPiece(l, 'tom4')).toBe(l);
    expect(removePiece(l, 'ride')).toBe(l);
  });
  it('rename, notes and mirror still work when locked', () => {
    expect(renamePreset(l, 'X').name).toBe('X');
    expect(setNote(l, 'snare', 'head', 40).pieces[1]!.midiNotes.head).toBe(40);
    expect(setMirrored(l, true).mirrored).toBe(true);
  });
});

describe('unique names', () => {
  it('nextKitName finds the first unused Kit N', () => {
    expect(nextKitName([])).toBe('Kit 1');
    expect(nextKitName(['Kit 1', 'kit 3', 'A'])).toBe('Kit 2');
    expect(nextKitName(['Kit 1', 'Kit 2'])).toBe('Kit 3');
  });
  it('uniqueName appends a counter', () => {
    expect(uniqueName('A copy', ['A'])).toBe('A copy');
    expect(uniqueName('A copy', ['A', 'a copy'])).toBe('A copy 2');
    expect(uniqueName('A copy', ['A copy', 'A copy 2'])).toBe('A copy 3');
  });
});
