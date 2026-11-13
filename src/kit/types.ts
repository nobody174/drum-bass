/** Kit data model (SPEC section 5). Coordinates are normalized 0..1 on the stage. */
export type PieceId =
  | "kick" | "snare" | "hihat"
  | "tom1" | "tom2" | "tom3" | "tom4"
  | "crash1" | "crash2" | "crash3"
  | "ride" | "splash" | "china";

export type PieceKind = "drum" | "cymbal" | "pedal";

export interface KitPiece {
  id: PieceId;
  kind: PieceKind;
  x: number;
  y: number;
  /** Normalized diameter relative to stage height (0.05..0.5). */
  size: number;
  color: string;
  /** zone name -> MIDI note, e.g. snare { head: 38, rim: 37 }, hihat { closed: 42, open: 46, pedal: 44 }. */
  midiNotes: Record<string, number>;
}

export interface KitPreset {
  id: string;
  name: string;
  pieces: KitPiece[];
  locked: boolean;
  mirrored: boolean;
  updatedAt: number;
}

/** Result of looking up an incoming MIDI note in a preset. */
export interface NoteMatch {
  piece: PieceId;
  zone: string;
}
