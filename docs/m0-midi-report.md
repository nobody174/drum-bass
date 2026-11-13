# M0 MIDI layer report

## What exists (`src/midi/`)
- `parse.ts` - pure `parseMidiMessage(bytes, timeStamp)`: note-on -> `DrumInputEvent` (source `midi`), note-on vel 0 / note-off / other status / short messages -> `null`, CC -> `CcEvent`.
- `webMidi.ts` - singleton `webMidi`: `getState()`, `subscribe(fn)`, `connect()` (call from a user gesture, `sysex:false`), `select(id)`, `dispose()`. State: `status` (`unsupported|idle|requesting|denied|ready|error`), `inputs[]` (id, name, manufacturer, state), `selectedId`, `error`. Selected id persisted in localStorage (`drum-bass.midi.input`); hot-plug via `onstatechange`; only the selected input has a message listener (detached on change). Notes go to `inputBus.emit`, CC to `inputBus.emitCc`.
- `useWebMidi.ts` - Preact hook returning the state plus `connect` and `select`.
- `virtualKeyboard.ts` - `startVirtualKeyboard()/stopVirtualKeyboard()`, exported `KEYBOARD_MAP` (Space kick, J snare, H snare rim, K hat closed, L hat open, N hat pedal, F/D/S/A toms 1-4, U crash, I ride, O ride bell). Uses `KeyboardEvent.code`, velocity 100, channel 9, ignores repeat, modifiers and typing targets.
- `mockInput.ts` - `playMock(steps, onDone?)` returns a cancel function; `DEMO_PATTERN` (one synthetic rock bar).
- `gmNames.ts` - `guessDrumName(note)`; `index.ts` re-exports everything.
- `midi.test.ts` - 10 tests (parsing, bus, mock with fake timers, keyboard repeat suppression). All pass; `tsc --noEmit` clean.

## UI
`src/ui/MidiMonitor.tsx` (default export, no props) + `midiMonitor.css`: status, Connect/Rescan, Demo pattern, Pause, Clear, Copy log; device radio list; seen-notes table (note, guess, count, max vel, channels); 50-row live log (newest first) with velocity bars and CC rows; keyboard hints. Events are buffered in refs and flushed once per animation frame. It starts the virtual keyboard while mounted. 48px touch targets, landscape layout, CSS variables with fallbacks.

## Known gaps
- No real device test yet (USB-OTG, Nitro Max mapping, latency).
- Ignores note-off, aftertouch, pitch bend, program change, sysex. CC4 is only logged, not yet interpreted.
- Auto-selects the first connected input when none was remembered; remembered id that is unplugged stays selected until replugged.
- Keyboard map assumes `KeyboardEvent.code` (physical QWERTY positions).
- Vitest quirk: run from a shell whose cwd uses the canonical `C:\Dev\...` casing (PowerShell). From Git Bash with `/c/...` all suites fail with "Cannot read properties of undefined (reading 'config')".
