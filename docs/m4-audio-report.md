# M4 audio report: latency calibration and settings in Play

Status: code and headless tests done. Nothing here is verified on a real phone or kit; real-device accuracy cannot be checked headlessly.

## Sign convention

- `error = hit time - click time` (ms). Positive = the hit was stamped late.
- `inputLatencyMs = median error`. `Judge` computes `songTime*1000 - latencyMs`, so a positive offset moves hits earlier and cancels constant lateness. Tested end to end (synthetic taps 80 ms late -> offset +80 -> Judge scores perfect).

## Clock mapping

Clicks are scheduled on the audio clock (`ctx.currentTime`). Hits arrive as `performance.now()` timestamps (pointer events, keys, Web MIDI `timeStamp`, `inputBus`). The wizard samples `(ctx.currentTime, performance.now())` pairs every 50 ms and on every hit, and uses `min(perf - ctx*1000)` as the clock offset (currentTime moves in about 3 ms render quanta, so each pair overestimates; the minimum is the least biased).

It deliberately uses the render clock, not `getOutputTimestamp()`: Play computes `songTime = currentTime - outputLatency`, so the number Play needs is the combined output + input delay relative to the render clock.

## Combined offset, honestly

Without a microphone, output latency and input latency cannot be separated. The wizard measures one combined value and applies `inputLatencyMs = measured - outputLatencyMs` (equal to the measured value when output latency is 0, the default). Subtracting the manual output value avoids double counting, since Play already removes `outputLatencyMs` from song time.

## Analysis

16 clicks at 90 BPM, accent on 1. Per click only the closest hit is kept. First 4 hits dropped, then |error| > 250 ms, then outliers beyond 2 MAD (MAD floored at 10 ms). Needs at least 6 usable hits, else "too few". Verdict "good" when sd <= 25 ms, otherwise "noisy, try again". Shows median, mean, sd and used/received.

## Settings wired into Play (read once at run start)

- `inputLatencyMs` -> `Judge.latencyMs`; `outputLatencyMs/1000` -> `transport.outputLatencySec`.
- `TIMING_WINDOWS[timingPreset]` -> `Judge` windows (normal equals the previous defaults).
- `keepAwake` gates the wake lock.
- `metronomeDuringPlay` -> new `TransportImpl.setMetronome(on)`. It reuses the click-only track, so the two cannot double up.
- `applyPalette(preset, colorblindPalette)` is applied to the loaded kit preset before remap, timeline and rendering.
- Changes made in Settings take effect on the next run (including Retry).

## Files

`src/audio/calibration.ts` (+ `.test.ts`), `src/ui/settings/CalibrationSection.tsx` (default export, no props), `src/styles/calibration.css`, `src/ui/Play.tsx`, `src/audio/transportImpl.ts` (`setMetronome`, additive), one test added in `src/audio/transport.test.ts`.

## Phone checklist

1. Settings > Calibration: run the wizard with the same output you will play with (speaker, wired or Bluetooth headphones). Hit the pad or big button exactly when you hear the click.
2. Run it twice. If the two medians differ by more than about 15 ms, or the verdict is noisy, repeat. Apply only a trustworthy result.
3. Apply, then play a song with a clear steady part (or the demo song) and check that the results timing tendency (early/late) is near 0. Fine-tune with +/-1 and +/-5 ms.
4. Repeat with the real kit via USB-OTG: MIDI latency differs from touch latency, so calibrate per input method you actually use.
5. If the falling notes visibly run ahead of or behind the sound, adjust Output latency (this moves the picture, not just scoring).
6. Check: metronome during play toggle, keep-awake toggle (screen stays on), timing preset change, colorblind palette. Each should apply on the next run.
7. Log findings (numbers per device and input) here.


## Review fixes (calibration)

- Linked tuners: Play subtracts `outputLatencyMs` from song time and the judge subtracts `inputLatencyMs`, so the effective compensation is their sum. Moving Output by D now moves Input by -D (`retuneOutput`, clamped so both stay in range and the sum holds); only the picture moves, scoring of a fixed player is unchanged (unit tested). A hint in the UI says so.
- Hard discard cap 250 -> 400 ms, and outliers are measured from a first-pass median (250 ms deviation, then the MAD cut), so a steadily 300 ms late Bluetooth user still calibrates.
- Warm-up is skipped by click index (hits paired to clicks 0-3), not by hit count.
- Apply refuses a result outside +-500 ms (what the store accepts) with a message instead of silently clamping.
