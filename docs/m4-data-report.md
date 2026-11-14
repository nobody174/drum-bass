# M4 data export / import / clear

Files: `src/storage/backup.ts` (+ `backup.test.ts`), `src/storage/usage.ts` (+ test), `src/ui/settings/DataSection.tsx`, `src/styles/data.css`.

## Zip format (schemaVersion 1)

```
manifest.json                      app, format, schemaVersion, createdAt, includesSongs, counts
kits.json                          { kits: KitPreset[] }
settings.json                      { app, sound, display, approach }
songs/<id>/song.json               SongRecord (notes, meta, scores, stems list)
songs/<id>/audio/<i>.<ext>         stem i of song.json, bytes exactly as stored (zip method 0, not recompressed)
```

Two modes: "Kits and settings only" (default) and "Everything". Songs whose id is not a safe path segment get a `s<n>` directory; `song.json` carries the real id.

## Export

- Built with fflate's streaming `Zip`: JSON via `ZipDeflate`, audio via `ZipPassThrough` in 1 MB slices, output flushed into Blob parts every 8 MB. Peak JS memory is about one slice plus the unflushed tail, not the archive twice. The final `Blob` is handed to the browser (it can be disk backed).
- Audio is sized first; above 500 MB the export is refused with a readable message (also shown in the UI before you tap). No zip64 needed below that.
- Download is a Blob URL + `a[download]` click, with a visible "tap here to save" fallback link. Filename `drum-bass-kits-settings-YYYY-MM-DD.zip` / `drum-bass-everything-YYYY-MM-DD.zip`.
- Only app-owned data is read: kits, songs and their audio, `drum-bass.settings.*` values.

## Import (untrusted zip)

`inspectBackup` validates everything and writes nothing; `applyBackup` writes.

- Whole-file cap 500 MB (+16 MB slack), entry cap 5000, 2000 songs, 500 kits; declared sizes come from the zip central directory and are checked before anything is inflated (total, per data file, total JSON). Unsafe names (`..`, absolute, drive letters, backslashes, control chars) reject the whole zip. Duplicate names reject.
- Only a fixed name grammar is read; unknown files are ignored with a warning and never inflated.
- Every JSON is rebuilt field by field from a strict schema (types, ranges, string lengths, enums, note counts); unknown fields are dropped. No eval, forbidden zone names (`__proto__`, ...) rejected.
- Kits go through the kit model: unknown/duplicate piece ids dropped (warning), size clamped to 0.05..0.5 and position clamped to the stage via `resizePiece`/`movePiece`, canonical piece order, kits without kick or snare skipped.
- Unsafe or duplicate song ids are replaced by fresh ids.
- Audio is inflated one song at a time during the write phase (peak = zip bytes + one song).
- **Add (keep existing)**: never overwrites. Same id, different content: new id. Name clash: `uniqueName` ("Kit 2"). Identical kit, or same title+artist song: skipped and reported. Settings only if the user ticks "Also apply settings".
- **Replace**: only for the types present in the zip (kits.json non-empty / songs present / settings present). New data is written first, old items are removed afterwards and only if every write succeeded. Needs two taps (Replace..., then "Yes, replace my data").
- Quota or other write failures stop the import, produce a readable message plus the partial summary, delete nothing, and leave settings untouched.

## Clear

Per type (kits, songs, settings) and everything, each behind a type-DELETE confirm. Done through the stores' record APIs; the database itself is never deleted, so there are no blocked deletes with other tabs open. Clearing kits recreates the default Nitro Max preset immediately (`kitStore.ensureDefault`); if that call is skipped, the next load recreates it anyway (tested). Clearing settings resets to defaults (including latency calibration) and removes the display/approach keys.

## Storage usage

`usage.ts`: `navigator.storage.estimate()` plus `persisted()`; hidden when unsupported. "Request persistent storage" button shown while not persistent.

## Limits and honest caveats

- Import needs the whole zip in memory (`unzipSync` works on one buffer): a 500 MB backup needs roughly 500 MB plus one song on the phone. A low-RAM phone may fail on a big "Everything" file; use the light export for routine backups.
- Export of big files has not been tried; the 500 MB cap is a guess, not a measured safe value.
- Zip CRCs are not verified on import (fflate does not); a corrupt stem in an otherwise valid zip is only detected by size at write time and then stops the import part-way (earlier songs stay, nothing is deleted).
- A Replace of songs removes songs not in the file, but "Everything" from a device with zero songs carries no songs, so Replace leaves your songs alone.
- App state held in memory by other screens (kit editor, library) is not live-refreshed; the UI tells the user to reload.
- Settings written by the calibration/audio work through `settingsStore` and `updateSoundSettings`, so they update live.

## Verified

- Unit tests (jsdom, in-memory backends): export contents and store-level compression, round trip kits+songs+audio+settings, add-mode collisions, double import, replace scope, quota failure, kit invariants, malicious zips (traversal, too many entries, declared-size cap, bomb-like JSON, bad schemas, wrong app, newer version), clear behaviors and default-kit recreation.
- Headless Chrome against the dev server (800x360 and 390x844): layout, light export produced a zip and the result line, Clear kits flow (button disabled until DELETE typed, then IndexedDB held exactly one fresh default kit).
- NOT verified: a real file download on the Android phone, importing a file picked from the phone's file chooser, huge files, persistent-storage prompt behavior.

## Phone checklist

1. Settings > Data: the "stored only on this device" note and the usage line show.
2. Export "Kits and settings only": a zip lands in Downloads (check the name has today's date).
3. Import that zip with "Add": summary says items skipped (already here), nothing duplicated.
4. Change a setting, import the zip with Replace (two taps), setting returns.
5. Import some songs, export "Everything", note file size and how long it takes; check the phone does not run out of memory.
6. Clear songs (type DELETE), library empty; import the everything zip with Add; songs and audio play again.
7. Clear kits: a default Nitro Max kit is there again in the Kit screen.
8. Tap "Request persistent storage" and note the result.
9. Check 48 px targets and the layout in landscape and portrait.


## Review fixes (limits, settings rules, state)

- Size limit: backups (export and import) are capped at 200 MB (`MAX_BACKUP_BYTES`), lowered from 500 MB because import needs the whole zip in memory (`unzipSync`). An over-limit file is refused with a message that suggests "Kits and settings only" or splitting the songs into several backups. From 100 MB (`WARN_BACKUP_BYTES`) the Data panel warns about memory, both before an export and after choosing a file. Lazy zip reading from `File.slice` is not done. Export uses the same cap so a file this app writes can always be read back.
- Settings rules on import: Replace mode applies the file's settings; Add mode never touches settings unless the user ticks "Also apply the settings in the file". Latency calibration (`inputLatencyMs`, `outputLatencyMs`) is device specific and is skipped in both modes unless the user ticks "Also restore latency calibration from this backup (device-specific)" (`applyLatency`).
- Add-mode kit dedupe compares a canonical form (sorted keys, pieces sorted by id, `id` and `updatedAt` ignored), so importing the same backup twice adds nothing.
- `applyBackup` and `clearData` share a module-level busy guard: a second call while one runs returns/throws "still running".
- Settings tabs now keep every panel mounted (inactive ones `hidden`), so export/import state survives tab switches. The export Blob URL is revoked when a new export replaces it, or 60 s after the Data panel unmounts.
- Settings latency range widened to +-500 ms for both values (store, backup validation).
