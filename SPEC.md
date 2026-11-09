# Drum Trainer PWA — Spec v0.1

Personal learning app for an Alesis Nitro Max e-drum kit. Android (Chrome), installable PWA. Single user, offline-first. All code and comments in English.

## 1. Goals / Non-goals

**Goals**
- Learn to play rock/metal songs (first target: Metallica) on the real kit.
- Kit layout in the app mirrors the physical kit (user-configurable, drag and drop, lockable).
- Show what to hit and when, in two switchable display modes.
- Load user-supplied songs: MIDI drum chart + audio (full mix / no-drums / drums-only).
- Rock-style UI.

**Non-goals (v1)**
- Spotify/YouTube integration (no note data available, not usable).
- Auto-transcription of audio.
- iOS support (Safari has no Web MIDI).
- Accounts, cloud, sharing. Nothing copyrighted is bundled; user imports own files.

## 2. Tech stack

- Vite + TypeScript + Preact (small, fast UI)
- Rendering: HTML Canvas 2D (play screen and kit editor). No game engine.
- Web MIDI API (input), Web Audio API (playback, click, latency)
- `@tonejs/midi` for parsing .mid files
- IndexedDB (via `idb`) for songs, audio blobs, kits, settings
- `vite-plugin-pwa` for installable + offline
- Vitest for unit tests (timing, mapping, scoring)
- Fonts self-hosted (offline): Bebas Neue / Oswald for headings, Inter for body

## 3. Screens

1. **Home / Library** — song list (cover, title, artist, difficulty, best score), import button.
2. **Kit Setup** — see section 4.
3. **Song Select / Pre-play** — audio mix choice, tempo, display mode, parts to show, count-in.
4. **Play** — the main view, see section 6.
5. **Results** — accuracy %, grade, combo, timing histogram (early/late), per-drum accuracy, retry button.
6. **Settings** — see section 8.

Bottom nav or hamburger: Library, Kit, Settings. Landscape is the primary orientation for Play and Kit Setup.

## 4. Kit configurator

### 4.1 Pick the pieces
Checklist with counts:

| Piece | Count | Notes |
|---|---|---|
| Kick | 1 | |
| Snare | 1 | head + rim zones |
| Hi-hat | 0–1 | closed / open / pedal |
| Tom | 0–4 | tom 1..4 (floor tom = last) |
| Crash | 0–3 | |
| Ride | 0–1 | bow / bell |
| Splash / China | 0–2 | optional |

Defaults pre-set for "Alesis Nitro Max" (4 pieces + hat + 2 crash + ride: verify against the real kit). Allow multiple saved kit presets with names.

### 4.2 Place them (drag and drop)
- Canvas "stage" with pieces as colored circles/ellipses (drum heads vs cymbals distinguished by shape).
- Pointer Events (touch + mouse). Drag to move, pinch or slider to resize, optional snap-to-grid.
- Default layout = standard right-handed kit seen from the drummer's seat; "Mirror (left-handed)" toggle.
- **Lock button**: when locked, pieces cannot be moved or resized; tapping a piece only triggers a test flash. Unlock to edit. Lock state saved with the preset.

### 4.3 MIDI learn
- Per piece (and per zone, e.g. snare head vs rim): "Learn" button, then hit the pad, the incoming MIDI note is stored.
- Starter mapping (General MIDI drums, must be verified with MIDI learn on the real kit, do not trust blindly):
  kick 36, snare 38, snare rim 37/40, tom high 48, tom mid 47, tom low 45, floor tom 43, hat closed 42, hat pedal 44, hat open 46, crash 49, ride 51, ride bell 53.
- Live MIDI monitor in Kit Setup (shows note, velocity, channel) for debugging.
- Hi-hat openness may arrive as CC4 (foot controller); store and handle later.

### 4.4 Chart-to-kit remapping
Songs use GM drum notes. The kit may have fewer pieces than the chart. Mapping rules (configurable):
- Missing tom → nearest existing tom.
- Missing 2nd crash → crash 1; missing ride → crash.
- Missing hat pedal → hide (or map to kick).
- Rim click → snare.
Show a small notice in Pre-play if remapping occurred.

## 5. Data model (TypeScript sketch)

```ts
type PieceId = "kick" | "snare" | "hihat" | "tom1" | "tom2" | "tom3" | "tom4"
  | "crash1" | "crash2" | "crash3" | "ride" | "splash" | "china";

interface KitPiece {
  id: PieceId;
  kind: "drum" | "cymbal" | "pedal";
  x: number; y: number;       // normalized 0..1 on stage
  size: number;               // normalized
  color: string;
  midiNotes: Record<string, number>; // zone -> note, e.g. { head: 38, rim: 37 }
}

interface KitPreset {
  id: string;
  name: string;
  pieces: KitPiece[];
  locked: boolean;
  mirrored: boolean;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  midiBlob: Blob;
  audio: { full?: Blob; noDrums?: Blob; drumsOnly?: Blob };
  offsetMs: number;           // audio vs MIDI alignment, per song
  bestScore?: number;
}

interface NoteEvent { timeSec: number; piece: PieceId; velocity: number; }
```

## 6. Play screen

Time source of truth: `AudioContext.currentTime` (audio clock), never `setTimeout` / `requestAnimationFrame` time. Chart notes pre-converted to seconds using the MIDI tempo map.

### 6.1 Display mode A — Falling lanes
- One lane per kit piece, lanes ordered left-to-right like the kit.
- Notes fall toward a hit line at the bottom. Color per piece, shape hints (cymbal = diamond, drum = circle, kick = wide bar).
- Hit feedback: flash on the lane, "PERFECT / GOOD / MISS" text.

### 6.2 Display mode B — Notes on the kit ("kit view")
- Shows the user's own kit layout (from the saved preset).
- Upcoming notes shown as **shrinking approach rings** around each piece (ring reaches the piece edge exactly at hit time), plus the piece **lights up** when it should be hit.
- Optional faint preview of the next ~1.5 s so the player sees what is coming.
- Good for learning where to move hands; weaker for dense fast passages.

### 6.3 Mode C — Split (stretch)
Kit view on one side, a compact falling-lane strip on the other. Build A and B first, then test with the nephew which one works, then decide.

### 6.4 Controls on Play
Pause, restart, loop A-B (drag handles on a progress bar), tempo slider (25–120%), mute/hide pieces ("only kick + snare"), volume mix, back.

### 6.5 Hit detection and scoring
- On MIDI note-on: map note to piece, find nearest unmatched chart note of that piece within the window.
- Windows (defaults, adjustable): Perfect ±35 ms, Good ±70 ms, OK ±120 ms, else miss. Extra hit with no note = "stray" (no penalty in beginner mode).
- Latency calibration offset applied to both audio and input (see Settings).
- **Practice modes:**
  - *Play-along*: song keeps going, score at end.
  - *Wait mode*: song pauses until the next required piece is hit (great for learning).
- Results track early/late tendency per piece.

## 7. Audio

User supplies the audio. Per song up to three versions:
1. Full mix
2. No-drums (backing for playing over)
3. Drums-only (for listening to how it should sound)

Pre-play choice: "Full / No drums / Drums only / Click only". Drums-only + muted band is also possible if both stems exist.

- Tempo change with pitch preserved: `HTMLMediaElement.preservesPitch` first; if quality is poor, use SoundTouchJS in an AudioWorklet.
- Count-in (1 bar, click) before start, optional metronome during play.
- Per-song `offsetMs` slider to align MIDI chart to audio (MIDI charts are often a little off). Include a "tap to sync" helper later.
- No-drums stems: made outside the app (e.g. Demucs on a PC for personal use); app only imports them. Document this in README.

## 8. Settings

- MIDI input device (list, remember last), connection status indicator
- Input latency offset (ms) + calibration wizard ("hit along to the click")
- Audio output latency offset
- Display mode default (Lanes / Kit / Split), note scroll speed, approach time
- Timing windows preset (Beginner / Normal / Strict)
- Hit sounds on/off (play a sample when pad is hit, useful if kit module is muted)
- Volumes: music, click, hit sound
- Count-in bars, metronome on/off
- Keep screen awake (Screen Wake Lock API) during play
- Colors per piece, colorblind-friendly palette
- Language (nb / en)
- Data: export/import all kits + songs (zip), clear data

## 9. Library / import

- Import `.mid` / `.midi` (select the drum track automatically: channel 10 / index 9; fallback: let user pick track)
- Import audio files (mp3/ogg/wav/m4a) and tag them as full / no-drums / drums-only
- Metadata form: title, artist, optional cover image
- **Clone Hero song folder import (primary source of free songs, see 9.1)**
- Everything stored in IndexedDB; works offline

### 9.1 Clone Hero import (priority)

Free fan-made drum charts exist for thousands of songs (sources: Chorus Encore, Custom Songs Central, RhythmVerse; the Bridge tool can search/download). The user downloads a song folder and imports it into the app (file picker, multi-file or zip).

- Folder contents: `song.ini` (metadata), `notes.mid` or `notes.chart`, and audio, often as separate stems (drums, guitar, bass, vocals, song/backing) in `.ogg`/`.opus`/`.mp3`.
- Format is the Rock Band 3 "pro drums" layout, NOT General MIDI. Parser must handle:
  - `PART DRUMS` track in `notes.mid`: Expert difficulty notes 96 (kick), 97 (snare), 98 (yellow), 99 (blue), 100 (green); tom markers (notes 110/111/112 = yellow/blue/green are toms, otherwise cymbals); double-kick note 95 (optional, treat as kick); verify against real files, do not trust this list blindly.
  - `.chart` text format as a fallback (`[ExpertDrums]` section).
  - Difficulty selection (Easy/Medium/Hard/Expert) as an app option: easy mode for learning.
- Map the lanes to kit pieces: yellow = hi-hat or tom depending on marker, blue = tom or ride, green = tom or crash, etc. Remap to the user's kit via section 4.4.
- Audio stems: if separate stems exist, the app mixes them. "No drums" = all stems except the drum stem(s); "Drums only" = the drum stem. This avoids running Demucs.
- Decode audio once and keep in IndexedDB as blobs; offline afterwards.
- Treat all imported content as user-owned local data. Nothing is bundled or uploaded.

Plain General MIDI drum files (`.mid`, channel 10) stay supported as a second import path.

## 10. Visual design — "rock"

- Dark charcoal/black base, high-contrast red + orange accents, small amber highlights
- Bold condensed headings (Bebas Neue / Oswald), uppercase, slight letter spacing
- Subtle grunge/noise texture, scratched-metal panels, riveted card borders; keep textures as light SVG/CSS to stay fast
- Amp-knob style sliders and toggles; guitar-pedal style buttons for primary actions
- Neon glow + shake/pulse on hits and combos, flame/spark particles on streak milestones (canvas, capped for performance)
- Distinct piece colors: kick orange, snare red, toms blue/teal/purple, hat yellow, crash/ride cyan/white
- Big touch targets (min 48 px), thumb-reachable on a tablet in landscape
- Respect `prefers-reduced-motion`

## 11. Dev and testing without the kit

- **Virtual drum input**: keyboard keys (desktop) and on-screen tap pads (touch) emit the same events as MIDI. Required, since development happens without the physical kit.
- **MIDI mock**: feed recorded MIDI event streams into the input layer for tests.
- Unit tests: chart-to-seconds conversion with tempo changes, note matching, scoring windows, remapping rules.
- Manual device test checklist: USB-OTG connection on Android, permission prompt, hot-plug/unplug, latency calibration.

## 12. Suggested repo layout

```
drum-trainer/
  src/
    midi/        # Web MIDI input, virtual input, mapping
    audio/       # engine, clock, tempo, click, stems
    chart/       # midi parsing, remapping, note timeline
    game/        # judging, scoring, wait mode, loop
    render/      # canvas: lanes, kit view, particles
    kit/         # editor, presets, MIDI learn
    ui/          # screens, components, theme
    storage/     # IndexedDB, import/export
    settings/
  public/        # icons, manifest, fonts
  docs/
  SPEC.md
```

## 13. Milestones

- **M0** — Scaffold (Vite/TS/Preact/PWA), MIDI monitor screen proving Nitro Max works over USB-OTG on the Android device.
- **M1** — Kit editor: piece selection, drag and drop, lock, presets, MIDI learn.
- **M2** — Player with falling lanes: import one Clone Hero song folder (and plain GM .mid + audio as second path), audio-clock sync, scoring v1.
- **M3** — Kit view mode (approach rings + light-up), mode switch, compare with nephew.
- **M4** — Library, audio mix choices (full/no-drums/drums-only), settings screen, latency calibration.
- **M5** — Practice tools: tempo, A-B loop, wait mode, hide pieces, results screen.
- **M6** — Rock UI polish, particles, offline PWA, export/import.
- **M7 (later)** — Split mode, band mode ideas, `.chart` fallback polish, more import sources.

## 14. Risks / open questions

- Exact MIDI notes/zones on the Nitro Max (resolved by MIDI learn; verify early in M0).
- Android audio output latency varies by device; calibration wizard is essential.
- MIDI chart quality for Metallica varies; offset slider and chart cleanup may be needed.
- Tempo change + pitch preservation quality in Chrome; fallback to SoundTouch.
- Web MIDI needs a secure context (HTTPS or localhost) and user permission.
- Legal: personal use of own files only; no copyrighted audio or charts bundled or distributed.
- Hardware and cabling: see `docs/hardware-and-cables.md`.
- Optional agent role suggestions for implementation: see `docs/agent-roles.md`.

## 15. First task for Claude Code

Start with M0 and M1: scaffold the project, build the MIDI monitor, then the kit editor with virtual input so it can be tested without the physical kit.
