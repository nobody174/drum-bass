# M1 sound report: synthesized hit sounds

Cause of the silence: nothing in the app produced audio. Added a pure Web Audio synth (no samples) driven by `inputBus`.

## Files
- `src/audio/voiceMap.ts` - note to voice mapping, velocity to gain, source filter, `VoiceLimiter` (cap 16, cuts oldest).
- `src/audio/settings.ts` - `drum-bass.settings.sound` (`enabled` true, `volume` 0.8, `playForMidi` false); try/catch everywhere, sanitizes corrupt data.
- `src/audio/hitSounds.ts` - engine: lazy `AudioContext` (`latencyHint: 'interactive'`), unlock on first pointerdown/keydown/touchend, shared noise buffer, nodes cleaned via `onended`, hits before unlock are silent no-ops.
- `src/audio/index.ts`, `src/ui/Settings.tsx`, `src/styles/settings.css`; `src/app.tsx` swaps the placeholder and calls `startSoundEngine()` once.
- Tests: `src/audio/audio.test.ts`.

## Behaviour
- Real MIDI input is silent by default (module sounds itself); toggle "Also play sound for the real kit (MIDI)" enables it.
- Settings screen: on/off, volume, MIDI toggle, test buttons (kick/snare/hat/crash), "Tap anywhere to enable sound" hint while locked, "More settings coming in M4" note.

## Verification
- `npx tsc --noEmit` clean; `npx vitest run` 78/78 pass.
- Headless Chrome screenshot at 800x360 of `#/settings` looks right; no console errors (only vite connect logs).
- NOT verified: actual sound. Nobody can listen headlessly; synth parameters (pitches, decays, levels) are untuned guesses. Please listen on the phone and report what to adjust.
- Note: the dev server base path is `/drum-bass/`.
