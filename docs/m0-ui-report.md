# M0 UI report

## Screens
- Shell: hash routing (`#/library|kit|pads|monitor|settings`, default `#/pads`). Bottom nav in portrait, left side rail in landscape (`max-height:600px` landscape or width >= 900px). Safe-area insets applied.
- Pads (`src/ui/OnScreenPads.tsx`): 14 pads on a 6x3 grid, right-handed kit layout, Pointer Events (multi-touch), soft/medium/hard = velocity 60/100/127, flash on every inputBus event (pad, keyboard, MIDI), key hints on width >= 700px. Starts/stops the virtual keyboard on mount/unmount.
- Library / Kit / Settings: placeholders. Monitor: `MidiMonitor` from the MIDI agent.

## Design tokens
`src/styles/theme.css`: --bg, --panel, --panel-2, --text, --muted, --accent, --accent-2, --amber, --c-kick/snare/tom1-4/hat/crash/ride, --touch (48px), safe-area vars, SVG noise + scratch gradients. `.panel` (riveted), `.pedal` (primary button). Fonts self-hosted via @fontsource. Reduced motion respected (no scale on hit, animations shortened).

## Verification
- `npx tsc --noEmit` passes.
- `npx vite build`: bundling succeeds, but the vite-plugin-pwa closeBundle step fails with ERR_DLOPEN_FAILED loading rollup's native module (environment / PWA owner issue, not UI).
- Headless Chrome screenshots: 800x360 landscape looks right. 390x800 portrait could not be checked reliably (headless Chrome enforces a ~500px minimum width, the capture overflowed). Not tested on a real phone or with real multi-touch.

## Known gaps
- Crash 2 uses GM note 57, which is not in STARTER_NOTES and has no keyboard binding.
- Portrait pads are tall pills; acceptable but not polished.
- Hit sound, velocity-from-position: out of scope.
- No favicon / app icons (PWA owner).
