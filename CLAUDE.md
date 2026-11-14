# drum-bass

Drum learning PWA for an Alesis Nitro Max e-drum kit (Android, Chrome, Web MIDI). Falling notes or notes drawn on the user's own kit layout. Songs come from user-imported Clone Hero charts and MIDI files.

## Read first

- `SPEC.md` — full spec, milestones, data model
- `docs/hardware-and-cables.md` — cabling (Norwegian)
- `docs/agent-roles.md` — optional role suggestions for subagents

## Conventions

- All code and comments in English.
- TypeScript, Vite, Preact, Canvas 2D, Web MIDI, Web Audio, IndexedDB, Vitest.
- Audio clock (`AudioContext.currentTime`) is the single source of truth for timing.
- No copyrighted audio or charts in the repo. Test fixtures must be synthetic or user-provided and git-ignored.
- Reports and investigation notes go in `docs/` as `.md` files; keep chat summaries to a short TL;DR.
- Develop without the physical kit using the virtual drum input (keyboard and on-screen pads).

## Order of work

1. Read `SPEC.md` fully, then `docs/agent-roles.md` (optional roles; pick what fits).
2. **M0** — scaffold + HTTPS deploy so the app can be installed on the user's Android phone right away, plus a MIDI monitor and the virtual drum input (on-screen pads, keyboard). The user will first test **without the drum kit** on their own Android phone: install the PWA, check design, UI and UX, touch targets, landscape layout.
3. **M1** — kit editor (choose pieces, drag and drop, lock, MIDI learn, presets). Must be fully usable with touch and without the kit.
4. **M2** onward — follow `SPEC.md`, section 13. Clone Hero import is in M2.
5. The real kit test (USB-OTG, MIDI notes, latency) happens later; log findings in `docs/`.

After each milestone: short TL;DR in chat, details in `docs/`, and ask the user to test on the phone before continuing.

## Real kit reference

`docs/reference/nitro-max-kit.md` and `nitro-max-kit.json` describe the real kit from photos: 1 crash, 1 ride, 3 toms, hi-hat with foot controller, exact placement, and MIDI notes from the manual. **Next task:** update the default preset and starter MIDI map to match (see the "Changes needed in the app" list in that file).

## Current status

M0 and M1 done and phone-tested. M2 written (Clone Hero import, falling-lane player, scoring, library, synthetic demo song); awaiting phone test. Unverified: song.ini delay sign, RB note numbers and disco-flip events (need a real chart). See docs/m2-*.md.
