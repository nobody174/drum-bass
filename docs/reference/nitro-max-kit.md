# Nitro Max kit reference (from photos)

Machine-readable version: `nitro-max-kit.json`. Visual: `nitro-max-layout.svg`. The original photos are intentionally not stored in the repo (it is public); everything needed is extracted here.

## TL;DR

The real kit has **8 playable things**: kick, snare, hi-hat (with foot controller), 3 toms, 1 crash, 1 ride. The app's current default preset assumes 2 crashes and uses guessed positions and some wrong MIDI notes. Update the default "Alesis Nitro Max" preset from `nitro-max-kit.json`.

## What the photos show

Five photos were analysed (front view, front view with labels, module top, module rear, top-down):

- Module top: display, knob, +/- buttons, "Nitro Max", BFD logo, Bluetooth logo.
- Module rear: POWER, 9 V DC, **USB (type B, unused)**, trigger inputs CYM 2 and TOM 4 (expansion, empty), audio output, AUX IN.
- Top-down view: used for the coordinates.

The USB-B port confirms the cable plan in `docs/hardware-and-cables.md`.

## Layout (drummer's seat, right-handed)

```
              far / back
        [crash]
  [module]  [tom1]  [tom2]            [ride]
[hi-hat]
              [snare]   [tom3]
        (hh pedal)        [kick]
            near / drummer
```

Two rows at the back (crash above, tom 1 and tom 2 below it), snare and tom 3 in front, hi-hat far left, ride far right, kick pedal centre-right, hi-hat pedal left of the snare.

## Coordinates (app stage, 0..1, size relative to stage height)

| Piece | x | y | size | Zones and MIDI notes |
|---|---|---|---|---|
| hihat | 0.22 | 0.48 | 0.24 | closed 42, open 46, pedal 44, half-open 23, splash 21 |
| crash1 | 0.44 | 0.14 | 0.24 | bow 49 (choke) |
| tom1 | 0.48 | 0.35 | 0.19 | head 48 |
| tom2 | 0.62 | 0.36 | 0.19 | head 45 |
| snare | 0.44 | 0.60 | 0.24 | head 38, rim 40 |
| tom3 | 0.67 | 0.61 | 0.19 | head 43 |
| ride | 0.80 | 0.50 | 0.24 | bow 51 (single zone, no bell) |
| kick | 0.58 | 0.83 | 0.20 | head 36 |

Positions are approximate (about +/- 0.03). The kick and the hi-hat pedal are estimated because the top-down photo cuts off the foot area. The kit editor lets the user adjust and lock the final layout.

## Hardware facts

- Kit: 10 in dual-zone snare, three 8 in single-zone toms, three 10 in cymbals (crash with choke, ride, hi-hat with foot controller).
- Only the snare has two zones. Toms, crash, ride and hi-hat pad are single-zone.
- MIDI over USB only (no audio). Channel 10.
- Bluetooth is for audio, not MIDI.
- Spare inputs CYM 2 and TOM 4 exist for the optional expansion kit; they are empty, so the app should not assume a 4th tom or 2nd crash.

## Changes needed in the app

1. `src/kit/model.ts` `createDefaultPreset`: remove `crash2`; use the positions and sizes above.
2. `src/midi/starterMap.ts`: snare rim 40, tom2 45, tom3 43; remove ride bell; add hi-hat half-open 23 and splash 21.
3. Update tests that assume the old notes or piece set.
4. Keep MIDI learn as the source of truth. The notes above come from the manual text and are not yet verified on the real kit.
5. Optional: show a small hi-hat foot-controller icon at (0.40, 0.91).

## Open questions

- Confirm the notes with MIDI learn on the real kit (manual text was parsed from a PDF).
- Does the hi-hat send CC4 for openness? The manual does not say.
