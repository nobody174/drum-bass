import { useEffect, useRef, useState } from "preact/hooks";
import { inputBus } from "../midi/inputBus";
import { STARTER_NOTES as N } from "../midi/starterMap";
import { KEYBOARD_MAP, startVirtualKeyboard, stopVirtualKeyboard } from "../midi/virtualKeyboard";

interface PadDef {
  id: string;
  label: string;
  note: number;
  color: string;
  /** CSS grid-area: row-start / col-start / row-end / col-end */
  area: string;
  round?: boolean;
}

// Right-handed kit seen from the drummer's seat. 6 columns x 3 rows.
// Crash 2 (GM 57) is not in STARTER_NOTES yet.
const CRASH2 = 57;
const PADS: PadDef[] = [
  { id: "crash1", label: "Crash", note: N.crash1, color: "var(--c-crash)", area: "1 / 1 / 2 / 2", round: true },
  { id: "tom1", label: "Tom 1", note: N.tom1, color: "var(--c-tom1)", area: "1 / 2 / 2 / 3" },
  { id: "tom2", label: "Tom 2", note: N.tom2, color: "var(--c-tom2)", area: "1 / 3 / 2 / 4" },
  { id: "crash2", label: "Crash 2", note: CRASH2, color: "var(--c-crash)", area: "1 / 4 / 2 / 5", round: true },
  { id: "ride", label: "Ride", note: N.ride, color: "var(--c-ride)", area: "1 / 5 / 2 / 7", round: true },
  { id: "hatC", label: "Hat closed", note: N.hihatClosed, color: "var(--c-hat)", area: "2 / 1 / 3 / 2", round: true },
  { id: "snare", label: "Snare", note: N.snare, color: "var(--c-snare)", area: "2 / 2 / 3 / 4", round: true },
  { id: "rim", label: "Rim", note: N.snareRim, color: "var(--c-snare)", area: "2 / 4 / 3 / 5" },
  { id: "tom3", label: "Tom 3", note: N.tom3, color: "var(--c-tom3)", area: "2 / 5 / 3 / 6" },
  { id: "tom4", label: "Floor tom", note: N.tom4, color: "var(--c-tom4)", area: "2 / 6 / 3 / 7" },
  { id: "hatO", label: "Hat open", note: N.hihatOpen, color: "var(--c-hat)", area: "3 / 1 / 4 / 2", round: true },
  { id: "hatP", label: "Hat pedal", note: N.hihatPedal, color: "var(--c-hat)", area: "3 / 2 / 4 / 3" },
  { id: "kick", label: "Kick", note: N.kick, color: "var(--c-kick)", area: "3 / 3 / 4 / 5" },
  { id: "bell", label: "Ride bell", note: N.rideBell, color: "var(--c-ride)", area: "3 / 5 / 4 / 7" },
];

const LEVELS = [
  { id: "soft", label: "Soft", velocity: 60 },
  { id: "medium", label: "Medium", velocity: 100 },
  { id: "hard", label: "Hard", velocity: 127 },
] as const;

const KEY_LABEL = new Map(KEYBOARD_MAP.map((b) => [b.note, b.label]));

export function OnScreenPads() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]["id"]>("medium");
  const velocityRef = useRef(100);
  velocityRef.current = LEVELS.find((l) => l.id === level)!.velocity;
  const els = useRef(new Map<number, HTMLElement[]>());

  // Keyboard input only lives while the Pads screen is mounted.
  useEffect(() => {
    startVirtualKeyboard();
    return stopVirtualKeyboard;
  }, []);

  // Flash pads for every input source (pad, keyboard, MIDI).
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    return inputBus.subscribe((e) => {
      const targets = els.current.get(e.note);
      if (!targets) return;
      const strength = 0.4 + (e.velocity / 127) * 0.6;
      for (const el of targets) {
        el.animate(
          [
            {
              filter: `brightness(${1 + strength * 1.2})`,
              transform: reduce.matches ? "none" : "scale(.94)",
              boxShadow: `0 0 ${12 + strength * 26}px var(--c), inset 0 0 22px var(--c)`,
            },
            { filter: "brightness(1)", transform: "none" },
          ],
          { duration: 180, easing: "ease-out" },
        );
      }
    });
  }, []);

  const hit = (note: number) => (ev: PointerEvent) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    ev.preventDefault();
    inputBus.emit({
      note,
      velocity: velocityRef.current,
      channel: 9,
      source: "pad",
      timeStamp: performance.now(),
    });
  };

  const register = (note: number) => (el: HTMLElement | null) => {
    const m = els.current;
    if (!el) return;
    const list = m.get(note) ?? [];
    if (!list.includes(el)) m.set(note, [...list, el]);
  };

  return (
    <div class="pads-screen">
      <div class="pads-bar">
        <h1>Pads</h1>
        <div class="seg" role="group" aria-label="Hit strength">
          {LEVELS.map((l) => (
            <button key={l.id} type="button" aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div class="kit" onContextMenu={(e) => e.preventDefault()}>
        {PADS.map((p) => (
          <button
            key={p.id}
            type="button"
            ref={register(p.note)}
            class={`pad${p.round ? " round" : ""}`}
            style={{ gridArea: p.area, "--c": p.color }}
            aria-label={p.label}
            onPointerDown={hit(p.note)}
            onContextMenu={(e) => e.preventDefault()}
            // Keyboard activation is handled by the virtual keyboard module, not by button clicks.
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") e.preventDefault();
            }}
          >
            <span>{p.label}</span>
            {KEY_LABEL.has(p.note) && <span class="key">{KEY_LABEL.get(p.note)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
