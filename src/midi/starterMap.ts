/**
 * Default MIDI map of the real Alesis Nitro Max (user guide section 5.2, see
 * docs/reference/nitro-max-kit.json). The numbers come from the manual's PDF text and are
 * UNVERIFIED on hardware: MIDI learn / the MIDI monitor decide.
 */
export const STARTER_NOTES = {
  kick: 36,
  snare: 38,
  snareRim: 40,
  tom1: 48,
  tom2: 45,
  tom3: 43,
  hihatClosed: 42,
  hihatHalfOpen: 23,
  hihatOpen: 46,
  hihatPedal: 44,
  hihatSplash: 21,
  crash1: 49,
  ride: 51,
} as const;

/**
 * Notes for pieces the real kit does not have. Only used when a user adds such a piece in the
 * kit editor (tom4 expansion input, crash2 on CYM 2). Not part of the Nitro Max map.
 */
export const EXTRA_PIECE_NOTES = {
  tom4: 41,
  crash2: 57,
} as const;
