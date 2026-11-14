# M3 real-kit verification (Alesis Nitro Max)

Template for the first session with the physical kit. Fill it in on the phone or afterwards; commit the result. Reference: `docs/reference/nitro-max-kit.md` (notes come from the manual text and are NOT yet verified).

## Session

| Field | Value |
|---|---|
| Date | |
| MIDI device name (as shown in the app) | |
| Phone / Android / Chrome version | |
| Cable chain (USB-B to OTG, hub?) | |
| App build / commit | |
| Kit module firmware (if shown) | |

## How to run it (about 5 minutes)

1. Connect the kit, open the app, go to **Monitor**, tap Connect MIDI and pick the Nitro Max. Hit every pad once and watch the notes arrive (channel should be 10).
2. Go to **Kit**. Optionally press **Reset to Nitro Max default** in Presets so the start state is the manual defaults.
3. Press **Learn all pads**. For each step the target piece is highlighted on the stage. Hit that pad (or press a key / tap a virtual pad when testing without the kit). The wizard saves the note, shows a short confirmation and moves on.
   - Optional steps (hi-hat half-open, hi-hat splash) can be skipped.
   - If a note was already learned for another zone you get a warning: keep the earlier zone, or replace it.
   - Hits repeated within about 150 ms on the same note are ignored (double trigger).
   - Hi-hat pedal: press the foot controller. It arrives as a normal note-on (expected 44). CC4 is only shown, not required.
4. At the summary, check the "differs from manual" badges, redo any wrong row, then press **Copy report** and paste it under "Learn-all-pads report" below. Press **Finish**; the kit autosaves.
5. Back on **Monitor**, play each pad hard and soft and note anything odd (see tables below).

## Learn-all-pads report

Paste the Markdown from **Copy report** here (it includes date, device, CC4 line and the table).

```
(paste here)
```

## Notes: expected vs observed

Expected values are from the manual (`nitro-max-kit.json`). Fill "Observed" from the wizard report or the Monitor.

| Piece / zone | Expected | Observed | Matches? | Comment |
|---|---|---|---|---|
| Kick head | 36 | | | |
| Snare head | 38 | | | |
| Snare rim (rimshot / cross-stick) | 40 | | | |
| Tom 1 head | 48 | | | |
| Tom 2 head | 45 | | | |
| Tom 3 head | 43 | | | |
| Hi-hat closed | 42 | | | |
| Hi-hat open | 46 | | | |
| Hi-hat pedal (foot controller chick) | 44 | | | |
| Hi-hat half-open (optional) | 23 | | | |
| Hi-hat splash (optional) | 21 | | | |
| Crash bow (choke?) | 49 | | | |
| Ride bow | 51 | | | |
| Ride bell / edge (expected: none) | - | | | Does the ride send anything different on the bell? |

## Hi-hat and CC4

| Question | Observation |
|---|---|
| Does the hi-hat send CC4 (foot controller position)? Values seen (min..max) | |
| Does CC4 change while the pedal is pressed slowly, or only on the chick? | |
| Does the hi-hat pad send 42 for closed and 46 for open from the pedal position alone, or is half-open (23) used? | |
| Pedal chick note and velocity (expected 44) | |
| Pedal hit while the pad is open: any extra notes? | |
| Hi-hat splash 21: how do you trigger it? | |

## Crash choke

| Question | Observation |
|---|---|
| Does grabbing the crash send polyphonic aftertouch / channel pressure / a note-off / a CC? | |
| Does the app need a choke mapping? | |

## Latency and reliability

| Item | Observation |
|---|---|
| Perceived latency, kit to app flash (ms, rough) | |
| Latency with audio playing (Play screen) | |
| Dropped or doubled hits (the wizard ignores same-note repeats within 150 ms; did it fire?) | |
| Velocity range seen (min..max) and whether soft hits register | |
| Cross-talk (hitting one pad triggers a neighbour) | |
| Bluetooth audio on at the same time? Effect on MIDI | |
| USB reconnect behaviour (unplug / replug while the app is open) | |

## Open questions (from `docs/reference/nitro-max-kit.md`)

- [ ] Confirm the notes with MIDI learn on the real kit (manual text was parsed from a PDF). See the report above.
- [ ] Does the hi-hat send CC4 for openness? The manual does not say.
- [ ] Is the on-stage layout (positions in the reference file, kick and hi-hat pedal estimated) close enough, or must pieces be moved? Lock the final layout afterwards.
- [ ] Do the empty expansion inputs (CYM 2, TOM 4) matter? The app assumes no 4th tom and no 2nd crash.
- [ ] Does the snare send separate notes for head, rim and cross-stick? Is there a third zone?

## Follow-ups

List code or default-kit changes needed after this session (update `createDefaultPreset`, `starterMap.ts`, tests).

-
