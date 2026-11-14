# M3 report: kit view (SPEC 6.2)

Files: `src/render/kitView.ts` (renderer), `src/render/kitGeometry.ts` (pure geometry) + `kitGeometry.test.ts`, `src/ui/Play.tsx`, `src/ui/PrePlay.tsx`, `src/ui/play/params.ts` (+ tests), `src/styles/play.css`. Screenshots (800x360 headless, synthetic demo song only): `docs/img/m3-*.png`. SPEC 6.3 split mode is NOT built (stretch).

## What it does
- **Kit view** draws the user's own saved preset on a 16:9 stage fitted into the canvas (same proportions and look as the kit editor: drum = circle with rim, cymbal = flat ellipse, hi-hat = two stacked, kick = pedal bar). Positions are used exactly as stored; `mirrored` is already baked into `piece.x` by `setMirrored`, same as the editor stage, so a mirrored preset is simply the mirror image (tested).
- **Approach rings**: ring radius = `edge + travel * clamp((noteTime - songTime) / approach, 0, 1)`: linear, a pure function of the audio-clock song time (no timers), exactly the piece edge at note time. Colour per piece, alpha and stroke grow as it nears, a crisp white line at the moment it crosses the edge. Cymbals and the kick scale their own shape.
- **Dense passages**: only the nearest 3 pending rings per piece are drawn, alpha x0.55 per rank. Missed notes fade grey for 0.3 s without using the quota.
- **Lighting**: a piece glows as its nearest pending note is within 0.2 s; a judgement gives a coloured flash + expanding ring and PERFECT / GOOD / OK / MISS text above the piece. Combo top-left, progress bar on top, count-in number as in lanes. Pieces not used by the song are drawn dimmed.
- **Performance design**: one RAF loop; static layer (floor, all pieces, labels, gradients) painted once per layout into an offscreen canvas and blitted per frame; per frame only binary search (`windowStart/windowEnd`) + preallocated selection buffers + stroke/fill of shapes; no gradients or allocations in the frame; DPR capped at 2; ResizeObserver; `destroy()` stops RAF and observer; reduced motion removes the burst, text drift and combo pulse.
- **Mode switch**: `Play` header button (Lanes / Kit view) works live in ready, playing and paused. Only the renderer is destroyed and recreated (canvas is keyed per mode); transport, judge and the input subscription are untouched, so audio and scoring do not notice. The new renderer is primed with the current combo and pause state. The choice is saved in `localStorage drum-bass.settings.display` and written to the address bar as `?v=lanes|kit` with `history.replaceState` (no hashchange, so the run is not rebuilt); Restart/Retry keep the mode. `?a=<sec>` carries the approach time.
- **PrePlay**: Display segment (Lanes / Kit view) and, in kit view, an approach slider 0.8-2.5 s (default 1.5, saved in `drum-bass.settings.approach`). The remap notice is unchanged. On-screen pad row stays in Play.
- **Default is Lanes.** Kit view is untested with a real player and weaker for dense passages (SPEC 6.2); change the default after the nephew test.

## Verified
- `npx tsc --noEmit` clean. `npx vitest run --pool=vmThreads`: 283 tests in 22 files pass (plain `npx vitest run` fails on this machine with "Cannot read properties of undefined (reading 'config')", a pre-existing environment issue, see M2 report). New: 19 in `kitGeometry.test.ts` (ring radius exact at note time, linear, clamp; window selection; nearest-N and quota rules; buffer bounds; stage fit; mirrored positions; shapes; lighting), 3 in `params.test.ts` (display/approach params).
- Headless Chrome 800x360 via DevTools protocol against `npm run dev`: demo imported through the Library button, PrePlay with Kit view selected, Play in kit view (count-in, approaching rings, hits with GOOD/OK/MISS text, combo), live switch to Lanes and back, URL became `...&v=lanes` and localStorage `lanes`; no console errors or exceptions.

## NOT verified (cannot be done headlessly)
- Real-device frame rate on a mid-range Android (design is allocation-light, but unmeasured).
- Audio/visual sync and input feel: headless audio is not heard, and pad taps in the script were random, not timed.
- Real touch on the mode button, portrait layout of kit view, and a user kit with unusual positions (screenshots use the default preset).
- Kick ring can extend past the stage bottom edge on kits where the kick sits low (clipped by the canvas, still readable).

## Phone test checklist (compare with the nephew, SPEC 6.3)
1. PrePlay: pick Kit view, move the approach slider; go back and forth, setting persists.
2. Start in each mode with the same song/difficulty; which mode does he hit more accurately, and which one feels better after 2 minutes? Note per mode: accuracy, early/late tendency in Results.
3. Kit view: do the rings reach the piece edge on the beat (compare with the click-only mix)? Is 1.5 s right, or does he prefer 1.0 or 2.0?
4. Dense fills: is 3 rings per piece readable? Does he lose track of which piece is next?
5. Switch modes mid-song (button top-right): music and score must carry on without a gap.
6. Rotate to portrait and back; frame rate in both modes (smooth at 60 fps?).
7. Mirrored preset: pieces appear where the editor shows them.
8. Decide: default mode, and whether SPEC 6.3 split mode is worth building.
