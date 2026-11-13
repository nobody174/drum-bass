# M1 UI report: kit editor

Files: `src/ui/KitEditor.tsx`, `src/ui/kitEditor.css`, `src/ui/kit/{Stage.tsx,draw.ts,flash.ts,zones.ts}`; `src/app.tsx` swaps the Kit route (and adds `no-scroll` for it).

## Decisions
- **Canvas 2D, not SVG**: same renderer style as the Play screen, flash animation redraws per frame; redraws are on demand (props, resize, active flash), no idle RAF loop. DPR + ResizeObserver, 16:9 fit.
- **Mirror**: the model's `setMirrored` flips piece x itself, so the stage draws x as stored (no second flip).
- **Pointer Events** with capture and `touch-action:none`. One drag at a time. Resize: slider, drag the amber handle on the right edge, and **pinch** (second finger while an unlocked piece is selected; cancels the drag). Snap = 0.05 grid (passed as `snap` step to `movePiece`).
- **Lock**: no move/resize/add/remove; tap selects (for learn) and test-flashes. Learn/clear and the "Left-handed view" switch still work while locked (by design).
- **Taps vs drags**: 5 px threshold before a drag/handle move starts; mouse drags need the primary button.
- **Learn**: per-zone Learn buttons on the selected piece; next `inputBus` event from any source stores the note; 10 s timeout, Cancel, "Listening... Ns". Conflicts via `findConflicts`. UNVERIFIED notice shown by the notes. Only the first event after Learn starts is captured (unsubscribes synchronously); the monitor shows it as "captured by Learn" instead of the old mapping. Monitor row shows last note, velocity, channel, source, matched piece/zone or "unmapped"; matched notes flash the piece.
- **Presets**: select, new, duplicate, rename (inline), delete (two-step confirm, disabled for the last). Autosave 400 ms debounce; `flush` returns success, switch/new/duplicate abort with a visible notice if the pending save fails, and run one at a time (busy flag; edits are ignored while one is in flight). Flushed on unmount, `visibilitychange` (hidden) and `pagehide`. Failed saves retry on the next edit or via a "Retry save" button. Delete only clears pending edits after it succeeded. Rename uses a local draft committed on blur/Enter. New/Duplicate pick unique names. Loading and error (Retry) states.
- **Keyboard/AT**: a "Select piece" button group selects pieces without the canvas, so Learn works without a pointer.
- Layout: landscape (>=560px wide) = stage left, scrollable panel right; portrait = sticky stage on top, collapsible `<details>` sections below. Touch targets >= 48px, reduced motion honored (no scale/pulse), all listeners/RAF/timers cleaned up.

## Learn without the kit (added after phone test)
- `src/ui/kit/VirtualPads.tsx`: 14 touch pads (>=48px; starter GM notes + crash 2 = 57) and a custom note stepper (0-127, +/-, number input, Send), all emitting `inputBus.emit({note, velocity:100, channel:9, source:'pad'})`.
- While Listening, the zone shows a "Hit the real kit, press a keyboard key, or tap a pad below" box with the pads inside it. A collapsible "Virtual pads" section (closed by default) offers the same pads outside learn to test the monitor and flash. The editor now starts the virtual keyboard too (stopped on unmount), so keyboard keys work here.
- Lock still allows learn.

## Verified
- `npx tsc --noEmit` passes.
- Headless Chrome (CDP, real time) at 800x360 and 390x800 (mobile emulation): stage, toolbar, panel render correctly; default preset loaded from IndexedDB.

- Headless Chrome (CDP, 800x360 and 390x800 mobile): select Snare, Learn, pads appear (14, none under 48px), a simulated Tom 1 tap saved note 48 to Snare head. `vitest` 65 pass.

## Not verified (needs a phone)
Real touch on the new pads, keyboard keys in the editor, custom stepper by hand, the Virtual pads section outside learn.
(Earlier list:)
Actual drag, pinch, multi-touch, handle drag, learn flow, autosave persistence across reload, preset ops, flash on pad input (all logic exercised only by code review).

## Phone checklist
1. Landscape: stage fits, panel scrolls, nav rail OK. Rotate to portrait: stage stays on top while controls scroll.
2. Drag each piece; with Snap on it jumps to the grid. Pieces stay on stage.
3. Select a piece: pinch to resize, drag the amber handle, use the slider.
4. Lock: nothing moves, tap flashes; unlock again. Reload: lock state kept.
5. Left-handed toggle mirrors the kit and persists.
6. Add/remove pieces; limits respected (toms 4, crashes 3), kick/snare locked in.
7. Select snare, Learn head, tap a pad on the Pads screen is not reachable (different route): use a keyboard key or a connected MIDI device; check timeout and Cancel.
8. Assign the same note twice: conflict warning appears.
9. New / duplicate / rename / delete (not last); reload keeps the active preset.

## Known gaps
- Kick label overlaps the "drummer's seat" caption at default layout (cosmetic).
