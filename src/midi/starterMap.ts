/**
 * Starter General MIDI drum mapping from SPEC section 4.3.
 * UNVERIFIED against the real Nitro Max. MIDI learn / the MIDI monitor decide.
 */
export const STARTER_NOTES = {
  kick: 36,
  snare: 38,
  snareRim: 37,
  tom1: 48,
  tom2: 47,
  tom3: 45,
  tom4: 43,
  hihatClosed: 42,
  hihatPedal: 44,
  hihatOpen: 46,
  crash1: 49,
  ride: 51,
  rideBell: 53,
} as const;
