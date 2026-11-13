# M2 audio and song storage report

## What was built

- `src/audio/transportImpl.ts`: `createTransport(ctx?)` returns a `TransportImpl` (a superset of `Transport`). Also exports `getSharedAudioContext()` (lazy, `latencyHint: 'interactive'`), `reportedOutputLatencySec(ctx)` (for M4 calibration), `START_LEAD_SEC` (0.05).
- `src/audio/stems.ts`: pure `planMix(roles, mode)` and `gainsForStems(roles, mode)`.
- `src/audio/click.ts`: `scheduleTick`, `ClickGroup`, `countInBeats`, `createMetronome` (lookahead scheduler, 25 ms timer, 120 ms window; timers only top up the window, tick times are audio-clock times).
- `src/storage/songs.ts`: `createSongStore(backend)`, `createSongIdbBackend`, lazy `songStore`, `SongStorageError`, types `StoredSong`, `SongSummary`, `SongRecord`, `SongBackend`.
- `src/storage/db.ts`: `DB_VERSION` 2; new stores `songs` (keyPath `id`) and `songAudio` (out-of-line key `<songId>/<name>`). The upgrade creates any missing store, so v1 databases (kits, meta) upgrade in place.
- Test helper `src/audio/fakeAudio.testutil.ts` (fake AudioContext with a manual clock).

## Timing model

`songTime = (ctx.currentTime - anchorCtx) + anchorSong - outputLatencySec` while playing. The anchor is reset on each (re)start. `outputLatencySec` defaults to 0 and is clamped to >= 0. Changing it while playing shifts the reported songTime but not the audio.

Stem audio position = `songTime + delayMs/1000`. This matches the convention "positive song.ini delay = the chart is delayed relative to the audio" (songTime = audioPos - delay). **This sign must be checked against real Clone Hero files**; it is a one-line change in `startAt` and `durationSec`. Negative audio positions are handled by scheduling the source later.

Sources are recreated on every play/resume/seek. All stems are always started; the mix only changes per-stem gain (10 ms ramp), so switching mix while playing does not restart or move the position.

Count-in: `play({countInBeats, bpm})` applies only when the position is exactly 0 (fresh, ended, or seeked to 0). songTime starts at `-beats*60/bpm`; clicks are scheduled on the audio clock with the accent on beat 1. Pausing during count-in resumes with only the remaining clicks. Seeking to a position > 0 drops the count-in.

Other behaviour: `play()` calls `ctx.resume()` first (must be called from a user gesture) and throws a readable error if blocked; a `pause()` during the pending resume cancels the play. `load()` decode errors name the file. `onEnded` fires from the longest source's `onended` and ignores stale sources; seeking past the end ends immediately. `load([])` leaves state `empty` and `play()` then throws. `dispose()` closes nothing shared. Transport does not share the context with `hitSounds` (it does not expose one), so there are two AudioContexts in the app; fine on Chrome Android.

Mix rules: `full` plays the `full` stem alone if present, otherwise all stems. `nodrums` plays every stem except `drums`/`full`; with only a `full` stem it falls back to it and `nodrumsAvailable=false`. `drumsonly` plays `drums` (silent plus `drumsonlyAvailable=false` if none). `clickonly` mutes all.

## Song store

`listSongs()` returns summaries only (no notes, no blobs; audio blobs live in `songAudio`). `saveImported` writes record + blobs in one transaction (all or nothing), de-duplicates stem names inside a song, and starts with `offsetMs: 0`. `replaceDuplicate: true` overwrites a same title+artist song in place keeping its id, `offsetMs`, `bestScore`; the default creates a new song. Quota errors become `SongStorageError` with `kind: 'quota'` and a readable message; other errors are wrapped with context. The IDB backend never caches a rejected open (same pattern as the kit store).

## Tests

36 new tests (stems 9, click 3, transport 16, songs 8); full suite 130 passing. `tsc --noEmit` shows one error, in `src/chart/importSong.ts` (not my file).

## NOT verified

Audio sync and sound are **not** verified. Everything above is checked with a fake AudioContext and a manual clock, which proves the arithmetic and call sequence, not real playback. Not checked headlessly: actual decoding of ogg/opus/mp3 in Chrome Android, audible click/stem alignment, real output latency, behaviour of the real `AudioBufferSourceNode.onended` timing, IndexedDB behaviour (no fake-indexeddb; the IDB backend is only tested for open/retry), and the delay sign above. These need a phone test.

## Review fixes (post-M2)

- **Click only** now plays a metronome for the whole song: `transport.setClickTrack({points, beatsPerBar})` builds a beat grid (`createBeatGrid` in `src/chart/tempo.ts`, tempo changes honoured, accent on beat 1 of each bar) and a lookahead pump (500 ms window, topped up every 50 ms) schedules ticks on the audio clock. It follows the mix: switching to/from clickonly while playing starts/stops it; pause/seek/end cancel it. Songs without audio use a silent stem and a metronome. Count-in leads straight into beat 0.
- **Decode memory**: stems are decoded sequentially and each encoded buffer is released right after decoding (peak = decoded stems so far + one encoded file). Trade-off: slower loading; decoded PCM is still large (about 10 MB per stereo minute per stem).
- **DB v3**: new `songMeta` store with per-song summaries (no notes, no blobs). The upgrade backfills it from `songs` without touching kits, songs or audio; `getAllSummaries` also repairs any song missing a summary. `putSong`, `patchRecord` and `deleteSong` keep `songs`, `songMeta` and `songAudio` in one transaction. `listSongs`/`findDuplicate` read summaries only.
- **Scores**: `bestByDifficulty` added; `bestScore` stays (legacy, and the max of all). `setBestScore(id, score, difficulty?)` only raises. `bestFor` falls back to the legacy score for songs with no per-difficulty data. Library shows the best of the highest difficulty played, with its label.
- `getSong` returns `missingAudio` (stem names without a blob). `requestPersistentStorageOnce()` runs after the first successful import.
