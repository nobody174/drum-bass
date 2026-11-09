# Suggested agent roles (optional)

These are suggestions, not rules. Claude Code may use them, pick other roles, or work without subagents when a task is small. Match the role to the task, not the other way round.

## Roles

| Role | Good for | Notes |
|---|---|---|
| **Planner / architect** | Module boundaries, audio-clock design, data model changes, milestone breakdown | Built-in `Plan` agent fits. Run before M0 and before any large refactor. |
| **Explorer** | "Where is X used?", finding files, reading unfamiliar code or fixtures | Built-in `Explore` agent. Read-only. |
| **MIDI / audio engineer** | Web MIDI input, Web Audio playback, tempo change with pitch preservation, latency calibration, A-B loop timing | Highest-risk area. Everything keys off `AudioContext.currentTime`. |
| **Chart parser engineer** | Clone Hero `notes.mid` / `.chart` parsing, `song.ini`, stem handling, lane-to-piece mapping, GM MIDI import | Needs real sample song folders as fixtures (user provides). Verify note numbers against real files. |
| **Canvas / graphics engineer** | Falling lanes, kit view with approach rings, particles, 60 fps on a mid-range Android | Keep rendering free of game logic. Test on the real device. |
| **UI / UX engineer** | Screens, kit editor (drag and drop, lock), settings, rock theme, touch targets | Skills `frontend-design` and `design:*` can help with the look. |
| **Test engineer** | Vitest for timing, note matching, scoring, remapping, parsers; virtual MIDI input | Write tests alongside each module, not at the end. |
| **Reviewer** | Review diffs before merge: correctness, timing bugs, memory leaks, accessibility | Skill `engineering:code-review`. Use a fresh agent so it does not grade its own work. |
| **Debugger** | Device-only problems: USB-OTG, MIDI permissions, hot-plug, latency | Skill `engineering:debug`. Ask the user for console logs from the phone. |
| **Release / PWA engineer** | `vite-plugin-pwa`, offline caching, HTTPS hosting (Web MIDI needs a secure context), install flow | Pick hosting that serves HTTPS (e.g. Cloudflare Pages, Netlify, GitHub Pages). |
| **Docs writer** | README, user guide for importing songs, changelog | Short and practical. |

## Suggested mapping to milestones

| Milestone | Primary roles |
|---|---|
| M0 Scaffold + MIDI monitor | Planner, MIDI/audio engineer, Release/PWA engineer |
| M1 Kit editor | UI/UX engineer, Test engineer |
| M2 Player + Clone Hero import | Chart parser engineer, MIDI/audio engineer, Canvas engineer, Test engineer |
| M3 Kit view mode | Canvas engineer, UI/UX engineer |
| M4 Library, stems, settings, calibration | MIDI/audio engineer, UI/UX engineer |
| M5 Practice tools | MIDI/audio engineer, Test engineer |
| M6 Polish, offline, export | UI/UX engineer, Release/PWA engineer, Reviewer |

## Working agreement

- Plan and scope in chat (claude.ai); implement in Claude Code.
- Code and comments in English.
- Reports and findings go in `docs/` as `.md` files, with only a short TL;DR in chat.
- Parallelize independent work (for example, parser and kit editor), but never let two agents edit the same files at once.
- Hardware facts that cannot be verified without the kit (MIDI note numbers, zones) are checked via MIDI learn and logged in `docs/`.
