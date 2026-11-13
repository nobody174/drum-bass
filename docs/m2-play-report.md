# M2 report: Play screen, scoring, Library

Files: `src/game/{judge,timeline}.ts` (+ `judge.test.ts`, 15 tests), `src/render/lanes.ts`, `src/ui/{Library,PrePlay,Play,Results}.tsx`, `src/ui/play/{params.ts,PadRow.tsx,silentWav.ts}`, `src/styles/{play,library}.css`, route edit in `src/app.tsx`. Screenshots: `docs/img/m2-*.png` (800x360 headless).

## Routes
`#/library` -> tap song -> `#/song/<id>` (PrePlay) -> Start -> `#/play/<id>?d=<difficulty>&m=<mix>&c=<countIn>`. The nav rail is hidden on Play. Play always shows a "Tap to play" overlay first: `transport.play()` must run synchronously in a user gesture, and decoding can outlast the PrePlay tap's activation window.

## Judging (`Judge`)
- Windows Perfect 35 / Good 70 / OK 120 ms (`DEFAULT_WINDOWS`, overridable), `latencyMs` param (default 0, wired to nothing yet; calibration is M4).
- Per-piece pointer to the first unresolved note; a hit scans only notes inside the OK window; `update(t)` sweeps misses once per frame. 20k-note test passes in well under 500 ms.
- Strays are counted but never penalised and never break the combo. Combo/max combo, accuracy (perfect 1, good .75, ok .5, miss 0), grade (S>=95, A>=88, B>=75, C>=60, D>=40, F), score (100/75/50 x combo multiplier up to x4), 12-bin timing histogram (-120..+120 ms), per-piece accuracy and mean early/late.
- Input to song time: the bus listener takes `transport.songTime` at receipt and subtracts the event's wait (`performance.now() - e.timeStamp`, clamped 0..100 ms). This is an approximation: Web MIDI timestamps are not mapped onto the audio clock, and JS event-loop jitter is not removed (a few ms). Acceptable for v1.
- The run ends when `songTime > last note + 2.5 s` or the transport ends; the rest is resolved as misses.

## Renderer
Single RAF loop, DPR-aware (capped 2), ResizeObserver, binary-search visible window, preallocated typed-array sparks (48 max), no gradients or per-frame allocations in the note loop. It gets times/lane/state arrays and judgement events only. Reduced motion disables sparks, pulse and text drift. Lanes: one per used kit piece, ordered by kit x; cymbal diamond, drum circle, kick bar.

## Assumptions about the other agents' code
- Imports `importSongFiles` from `chart/importSong`, `remapToKit` from `chart/remap` (no `chart/index.ts` existed).
- A song with no audio gets a generated silent WAV, because `transport.load` rejects zero stems; mix is then "Click only".
- Offset: `load(..., {delayMs: meta.delayMs + offsetMs})`. Restart and Retry rebuild the whole run (audio decoded again) instead of seek(0), to keep judge/renderer state simple.
- Demo import: probes `BASE_URL + demo/demo-rock/song.ini` (rejecting an HTML fallback response), optional `files.json` manifest, else common file names. Button hidden on 404. Not exercised (no demo asset yet).

## Verified
- `npx tsc --noEmit` clean; `vitest` 177 tests pass across 17 files.
- NOTE: on this machine plain `npx vitest run` fails every file with "Cannot read properties of undefined (reading 'config')" (also pre-existing tests). `npx vitest run --pool=vmThreads` works. Not caused by this milestone.
- Headless Chrome 800x360 with a seeded synthetic song: Library empty state, PrePlay, Play (count-in, falling notes, pad taps produce MISS/hit text, progress bar). Real touch, frame rate and audio sync were NOT measured.

## Not verified / phone checklist
1. Import a real Clone Hero folder (Import folder may not offer folders on Android Chrome; use zip), check warnings text.
2. Pre-play: difficulty/mix greyed correctly, remap notice, offset slider saves and persists.
3. Tap to play: audio starts, count-in click, notes reach the line on the beat; frame rate smooth in landscape.
4. Pads, keyboard, and MIDI kit hits all register; hits feel in sync (compare with click-only mix). Note the feel for latency calibration (M4).
5. Pause/Resume keeps sync; locking the screen auto-pauses; screen stays awake while playing.
6. Results: grade, histogram, best score saved and shown in Library; Retry/Back work.
7. Portrait layout of Play, Library, PrePlay.

## Known gaps
Not implemented (outside the M2 brief): kit-view mode, loop A-B, tempo slider, wait mode, mute pieces. Pause-menu Restart re-decodes audio (slow on big songs).

## Review fixes (post-M2)

- Count-in uses the chart tempo (`startBpm`, else `estimateBpm`) and shows beat numbers (4,3,2,1), not seconds (`countInBeatNumber`).
- `parseParams`: absent `c` now means 4 beats (it was 0).
- Wake lock: after the async request the phase is re-checked and the lock released at once if the run is no longer playing.
- Click-only runs are practice: Results does not record them. "New best" compares with the best for the same difficulty.
- PrePlay shows missing stems and an accurate click-only / no-audio text.
