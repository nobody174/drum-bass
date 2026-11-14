# M3: real Nitro Max kit applied (kit model, MIDI map, pads, sounds)

Source of truth: `docs/reference/nitro-max-kit.json` (photos, not in the repo; manual PDF text for notes).

## What changed

- `createDefaultPreset()` (src/kit/model.ts): 8 pieces: kick, snare, hihat, tom1, tom2, tom3, crash1, ride. No crash2. x/y/size/kind are exactly the JSON values (a test reads the JSON and compares). Hi-hat is a cymbal with zones closed 42, open 46, pedal 44, halfOpen 23, splash 21 (the foot controller is a zone, not a piece). Ride has bow 51 only. Snare head 38, rim 40. Toms 48/45/43. Preset carries `template: { id: "nitro-max", version: 2 }` (new optional field in src/kit/types.ts).
- `PIECE_LIMITS` unchanged: users can still add tom4 (note 41), crash2 (57), crash3, splash, china in the editor. Their notes live in `EXTRA_PIECE_NOTES` (src/midi/starterMap.ts), not in the Nitro Max map.
- `STARTER_NOTES`: snareRim 40, tom2 45, tom3 43, added hihatHalfOpen 23 and hihatSplash 21; removed rideBell, tom4.
- MIDI monitor names (src/midi/gmNames.ts): `guessDrumName` returns "Kit: <name>" for notes in the Nitro Max map, the General MIDI name otherwise (`GM_NAMES`, unchanged meaning, used for charts), "?" if unknown. `kitNoteName` / `gmNoteName` exported.
- Keyboard: removed O (ride bell) and A (floor tom); added M = hi-hat half-open, B = hi-hat splash.
- On-screen pads: 11 pads (crash, tom 1-3, ride, snare, rim, hat closed/open/pedal, kick); no crash 2, no bell, no floor tom. Grid unchanged (6x3, touch targets stay large, multi-touch untouched). Virtual pads (kit editor): same notes plus half-open and splash; custom note stepper kept.
- Sounds (src/audio/voiceMap.ts): toms 48/45/43 plus GM 41/47/50; 40 snare; 23 half-open hat (open sound); 21 splash (crash sound). All earlier GM notes still map as before.

## Saved-preset migration (src/kit/migrate.ts, store.migrate())

Runs from `ensureDefault()`, recorded in IndexedDB meta key `kitMigration.nitroMax` = `2`.

1. Preset named exactly "Alesis Nitro Max", no `template`, equal to the frozen OLD default (also not locked or mirrored): replaced in place (same id, stays active) by the new default.
2. Same name but modified: left untouched; the new default is added once as "Alesis Nitro Max (real kit)".
3. Anything else (renamed, copies, already templated): never touched.
4. Second run: no-op (`skipped: true`). Fresh installs record the migration as done.

## Reset helper

`resetToNitroMaxDefault(preset): KitPreset` (src/kit/model.ts). Pure; keeps `id` and `name`, replaces `pieces`, `locked` (false), `mirrored` (false), sets the template marker, bumps `updatedAt`. The caller persists it with `kitStore.savePreset`.

## Still UNVERIFIED

- All MIDI note numbers come from the user guide's PDF text. Check each with the MIDI monitor / MIDI learn on the real kit, especially 23 (half-open), 21 (splash), 40 (snare rim) and the tom notes 48/45/43.
- Positions are approximate (about +/- 0.03) and kick/hi-hat pedal were estimated from the front photo.
- Whether the module sends 46/23/21 for hi-hat states, or CC4 plus 42/44, is not confirmed.
- src/kit/index.ts does not re-export `./migrate` (not needed by the app; import from `./migrate` in tests).
