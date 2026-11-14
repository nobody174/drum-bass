# M2 chart import report

Files: `src/chart/*` (tempo, songIni, cloneHeroMidi, cloneHeroChart, gmMidi, importSong, remap, laneMap, index), `scripts/make-synthetic-song.mjs`, `fixtures/synthetic/demo-rock/`.

## API (import from `src/chart`)
- `importSongFiles(files, limits?) -> ImportedSong` (File[] from folder picker, `{name, blob}[]`, one .zip, or a lone .mid). Hard errors throw `Error`; soft problems land in `warnings`.
- `remapToKit(notes, preset) -> {notes, remapped:[{from,to,count}]}`; `describeRemap(remapped)` gives Pre-play notice lines.
- Lower level: `createTempoMap`, `parseSongIni`, `parseCloneHeroMidi`, `parseCloneHeroChart`, `parseGmMidi`.
- `types.ts` got one additive type, `ParsedChart`.

## Behaviour
- Chart pick order: `notes.mid`, `notes.chart`, any other `.mid`. A `.mid` with a `PART DRUMS` track is Clone Hero, otherwise General MIDI (with a warning). First candidate with notes wins.
- Tom markers 110/111/112 apply to every difficulty and are exclusive at the end tick. No marker = cymbal. If the track has no markers at all, a warning is added (option `noMarkerPolicy: "toms"`).
- `.chart`: toms by default, cymbal flags 66/67/68 on the same tick; 32 = 2x kick.
- Velocity: 100 unless the file's gem velocities differ (then real velocities).
- Audio: only the chart's own folder is used. `preview*` is skipped. One non-drum file becomes `full`. Unknown names get role `other` plus a warning.
- Zip: entries are never executed; unsafe names (`..`, absolute, drive letters, NUL) skipped with a warning; cap 1.5 GB total and 5000 entries (overridable via `limits`); entry size must match the declared size.
- Remap: missing tom -> nearest tom (then snare); crash2/3 -> crash1 (then nearest crash, china, splash, ride); ride -> crash; hihat -> ride, then crashes; kick/snare have no substitute (dropped and reported).

## Verified (automated, 47 tests in `src/chart`)
Tempo changes, song.ini tolerance, tom-marker logic, .chart parsing, GM mapping, importer classification, zip safety, remap rules, and the synthetic `demo-rock` folder (all note counts and times across a 120 -> ~140 BPM change, computed independently by the generator).

## VERIFIED against documentation (2026-11-14, no real chart used)
Sources: GuitarGame_ChartFormats, mid drums https://thenathannator.github.io/GuitarGame_ChartFormats/Chart-File-Formats/mid-format/Tracks/Drums ; chart drums https://thenathannator.github.io/GuitarGame_ChartFormats/Chart-File-Formats/chart-format/Tracks/Drums ; chart overview https://thenathannator.github.io/GuitarGame_ChartFormats/Chart-File-Formats/chart-format/Format-Overview ; Clone Hero wiki https://wiki.clonehero.net/books/guides-and-tutorials/page/songini-guide
- `.mid` note numbers: kick/red/yellow/blue/green = 96-100 expert, 84-88 hard, 72-76 medium, 60-64 easy; 5-lane green = base+5 (101/89/77/65); 2x kick 95 (expert only); tom markers 110/111/112; fills 120-124; solo 103; overdrive 116; versus 105/106; flam 109; rolls 126/127. Cymbals are the default in .mid, red is always a tom.
- `[mix <0-3> drums<config><flag>]`: brackets, spaces or underscores all accepted (parser now accepts all three; before it required brackets and spaces). `d` = disco flip: on Pro it swaps red with yellow cymbal/tom; on non-Pro it only swaps audio stems (notes untouched). `dnoflip`, `easy`, `easynokick` never swap notes. Each mix event resets all modifications.
- 5-lane: red/blue/green toms, yellow/orange cymbals. Pro and 5-lane both detected -> prefer Pro (parser now lets tom markers veto 5-lane).
- `.chart`: lanes 0 kick, 1 red, 2 yellow, 3 blue, 4 green(4-lane)/orange(5-lane), 5 green(5-lane), 32 = 2x kick; cymbal flags 66/67/68; no flag = tom; accent 34-38, ghost 40-44 (ignored). `B` = thousandths of BPM, `TS n e` denominator = 2^e (default e=2). All match the code.
- song.ini `delay`: CH wiki says "Positive numbers will make the chart start later, while negative numbers will make it start sooner." Current code (audioPos = songTime + delay) makes the chart start later for positive values, so it agrees; code unchanged. Frets on Fire / FoFiX docs also describe `delay` as delaying the notes, in ms (negative allowed). Caveats: the CH wiki gives no unit (ms comes from the FoF docs) and marks the tag as legacy.

## UNVERIFIED (needs a real file)
- Whether tom markers 110-112 apply to all four difficulties (the docs are silent; implemented as yes).
- Behaviour on real charts: ghost/accent velocities (127 accent / 1 ghost, only when the dynamics event is enabled; we do not read that event), SMPTE-division MIDI, `Resolution` default when missing (docs give none, 192 assumed with a warning).
- `pro_drums` / `five_lane_drums` song.ini tags are not read; detection is by markers / base+5 note only.
- Pad choice for 5-lane (yellow hihat, blue tom1, orange crash1, green tom2) is our design, not a spec item.
- Zip bomb defence relies on fflate honoring the declared size; memory is bounded by the declared total only.
- Not tested in a real browser (only jsdom Files). Real audio sync still needs a phone test.

## Review fixes (post-M2)

- **Tempo data in `SongMeta`** (additive, optional; old songs fall back to `estimateBpm`): `tempoMap` (`{timeSec,bpm}[]`, equal consecutive tempos merged), `startBpm` (tempo at the first drum note, used for the count-in), `beatsPerBar` (first time signature only; later changes are ignored). Filled for `.mid`, `.chart` (`B` and `TS` events) and GM MIDI.
- **Zip import memory**: entries are filtered by extension from the name alone, before inflating. Only chart/mid/midi/ini and audio (ogg, opus, mp3, wav, m4a, aac, flac) are inflated; video, images, wma/aif/aiff/mp2 and everything else are skipped (unsupported audio gets a warning, the rest one summary warning). Uncompressed cap is now 400 MB over inflated entries; the 5000-entry cap counts all entries; path traversal rejection is unchanged.
- **Disco flip (event format now VERIFIED, see above; the stale text below predates that)**: `src/chart/cloneHeroMidi.ts` reads `[mix <0-3> drums<N><flags>]` text events on PART DRUMS (via `src/chart/midiText.ts`, because @tonejs/midi only exposes text events of track 0). Flag exactly `d` flips (charted red = hi-hat, charted yellow = snare) from the event tick until the next mix event of that difficulty; `dnoflip`, `easy`, `easynokick` and empty do not. The event strings come from community docs and have NOT been checked against a real file; only a synthetic test covers it. A warning reports how many notes were flipped. Not applied in 5-lane files.
- **song.ini `delay` sign**: now checked against the Clone Hero wiki, see above; code unchanged.
