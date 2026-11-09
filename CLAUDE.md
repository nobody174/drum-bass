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

## Current status

Spec only. Start with M0 and M1 (see `SPEC.md`, section 13).
