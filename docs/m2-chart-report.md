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

## UNVERIFIED
- All Rock Band / Clone Hero note numbers (96-100, 84-88, 72-76, 60-64, 95, 110-112, ignored 103/116/120-124) come from the spec and community docs. `fixtures/local/` was empty, so nothing was checked against a real `notes.mid`/`notes.chart`. Drop a real song there and run the importer on it.
- 5-lane layout (yellow hihat, blue tom1, orange crash1, green tom2) is a guess.
- Real velocities in real charts (ghost/accent) untested. SMPTE-division MIDI untested.
- Zip bomb defence relies on fflate honoring the declared size; a hostile zip that lies is rejected on the size check after inflation, so memory use is bounded by the declared total only.
- Not tested in a real browser (only jsdom Files).

## Review fixes (post-M2)

- **Tempo data in `SongMeta`** (additive, optional; old songs fall back to `estimateBpm`): `tempoMap` (`{timeSec,bpm}[]`, equal consecutive tempos merged), `startBpm` (tempo at the first drum note, used for the count-in), `beatsPerBar` (first time signature only; later changes are ignored). Filled for `.mid`, `.chart` (`B` and `TS` events) and GM MIDI.
- **Zip import memory**: entries are filtered by extension from the name alone, before inflating. Only chart/mid/midi/ini and audio (ogg, opus, mp3, wav, m4a, aac, flac) are inflated; video, images, wma/aif/aiff/mp2 and everything else are skipped (unsupported audio gets a warning, the rest one summary warning). Uncompressed cap is now 400 MB over inflated entries; the 5000-entry cap counts all entries; path traversal rejection is unchanged.
- **Disco flip (UNVERIFIED)**: `src/chart/cloneHeroMidi.ts` reads `[mix <0-3> drums<N><flags>]` text events on PART DRUMS (via `src/chart/midiText.ts`, because @tonejs/midi only exposes text events of track 0). Flag exactly `d` flips (charted red = hi-hat, charted yellow = snare) from the event tick until the next mix event of that difficulty; `dnoflip`, `easy`, `easynokick` and empty do not. The event strings come from community docs and have NOT been checked against a real file; only a synthetic test covers it. A warning reports how many notes were flipped. Not applied in 5-lane files.
- **song.ini `delay` sign is still UNVERIFIED** and deliberately unchanged (needs a real chart).
