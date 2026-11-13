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

## Current status

M0 code written (scaffold, MIDI monitor, virtual pads, PWA + Pages workflow). Awaiting phone test; next is M1 (kit editor). See docs/m0-*.md.
