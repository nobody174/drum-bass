import { inputBus } from "./inputBus";
import { STARTER_NOTES } from "./starterMap";

export interface KeyBinding {
  /** KeyboardEvent.code, layout independent */
  code: string;
  /** Label to show in the UI */
  label: string;
  note: number;
  name: string;
}

export const KEYBOARD_MAP: readonly KeyBinding[] = [
  { code: "Space", label: "Space", note: STARTER_NOTES.kick, name: "Kick" },
  { code: "KeyJ", label: "J", note: STARTER_NOTES.snare, name: "Snare" },
  { code: "KeyH", label: "H", note: STARTER_NOTES.snareRim, name: "Snare rim" },
  { code: "KeyK", label: "K", note: STARTER_NOTES.hihatClosed, name: "Hi-hat closed" },
  { code: "KeyL", label: "L", note: STARTER_NOTES.hihatOpen, name: "Hi-hat open" },
  { code: "KeyN", label: "N", note: STARTER_NOTES.hihatPedal, name: "Hi-hat pedal" },
  { code: "KeyF", label: "F", note: STARTER_NOTES.tom1, name: "Tom 1" },
  { code: "KeyD", label: "D", note: STARTER_NOTES.tom2, name: "Tom 2" },
  { code: "KeyS", label: "S", note: STARTER_NOTES.tom3, name: "Tom 3" },
  { code: "KeyA", label: "A", note: STARTER_NOTES.tom4, name: "Floor tom" },
  { code: "KeyU", label: "U", note: STARTER_NOTES.crash1, name: "Crash 1" },
  { code: "KeyI", label: "I", note: STARTER_NOTES.ride, name: "Ride" },
  { code: "KeyO", label: "O", note: STARTER_NOTES.rideBell, name: "Ride bell" },
];

const BY_CODE = new Map(KEYBOARD_MAP.map((b) => [b.code, b]));
export const KEYBOARD_VELOCITY = 100;

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  // Space on a focused button/link must activate it, not play the kick.
  if (e.code === "Space" && (e.target as HTMLElement | null)?.closest?.("button, a, [role=button]")) return;
  const b = BY_CODE.get(e.code);
  if (!b) return;
  if (e.code === "Space") e.preventDefault(); // avoid page scroll / button click
  inputBus.emit({
    note: b.note,
    velocity: KEYBOARD_VELOCITY,
    channel: 9,
    source: "keyboard",
    timeStamp: performance.now(),
  });
}

let active = false;

export function startVirtualKeyboard(): void {
  if (active) return;
  active = true;
  window.addEventListener("keydown", onKeyDown);
}

export function stopVirtualKeyboard(): void {
  if (!active) return;
  active = false;
  window.removeEventListener("keydown", onKeyDown);
}
