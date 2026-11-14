# M4 Settings report (UI part)

## What changed
- `src/ui/Settings.tsx`: tabbed screen (Sound, Play, Look, MIDI, Calibration, Data, About). Sticky, horizontally scrollable tab bar, 48 px targets; selected tab remembered per session. Heading hides at heights under 420 px.
- `src/ui/settings/PlaySection.tsx`: default display, ring approach (0.8-3.0 s, step 0.2), default count-in 0/2/4, timing preset with live ms windows from `TIMING_WINDOWS`, metronome, keep awake. Display and approach edit the existing `drum-bass.settings.display` / `.approach` keys (same as PrePlay), count-in and the rest go to `settingsStore`.
- `AppearanceSection.tsx`: colorblind toggle, live preview chips, reduced-motion note (follows the OS setting, no own toggle).
- `MidiSection.tsx`: webMidi status, connect button, device picker (if more than one input), links to Monitor and Kit editor (Learn wizard lives there; no deep link exists).
- About: version from `package.json`, GitHub link, on-device data text, disabled "Language: English (Norwegian planned)" row.
- `src/settings/palette.ts`: `applyPalette(preset, colorblind)`, `PALETTE_PREVIEW`, `COLORBLIND_COLORS` (Okabe-Ito drums, neutral greys for cymbals), `contrastRatio`. Tests in `palette.test.ts` (distinct >= 30 RGB distance, >= 3:1 contrast on #0d0d0f, deterministic, pure). `store.test.ts` covers sanitize/defaults.
- `PrePlay.tsx` / `play/params.ts`: count-in default now `settingsStore.get().defaultCountIn` (default is still 4, so no change for users who never open Settings).

## Integration notes
- Calibration and Data sections are loaded with `import.meta.glob` so the build never breaks if a file is missing or has no default export; a "not available yet" note shows instead. Once both files exist, this can become two plain imports.
- Play.tsx (audio engineer) must call `applyPalette(preset, settingsStore.get().colorblindPalette)`.

## Verified
- `npx tsc --noEmit` clean. Vitest: all pass except one test in `src/audio/calibration.test.ts` (audio engineer's work in progress: expected 'good', got 'ok').
- Headless Chrome at 800x360 and 390x800: every tab renders, no horizontal page overflow. Looked at Play (800x360) and Look (390x800) screenshots.
- Not verified: Calibration and Data tabs with real content (those files were empty/missing at the time), real phone, MIDI with a device, wake lock, Play screen consuming the settings.

## Phone checklist
1. Settings opens; tabs scroll sideways with a thumb; every tab reachable.
2. Landscape: panel scrolls, tab bar stays on top, nothing cut off.
3. Play tab: change display/approach, open a song: Pre-play shows the same values.
4. Change count-in to 2: Pre-play starts with 2 selected.
5. Timing preset shows ms; the Play result reflects it.
6. Look: toggle colorblind, start a song in Kit view: piece colors change, cymbals white/grey.
7. MIDI: Connect MIDI, plug the kit, status shows device name; Monitor and Kit links work.
8. Calibration and Data tabs work (other agents).
9. About: version, GitHub link opens, language row greyed out.
