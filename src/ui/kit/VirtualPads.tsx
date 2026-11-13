import { useState } from "preact/hooks";
import { inputBus, STARTER_NOTES as N } from "../../midi";

/** Starter GM notes (UNVERIFIED against the real kit). Crash 2 is GM 57. */
const PADS: { name: string; note: number }[] = [
  { name: "Kick", note: N.kick },
  { name: "Snare", note: N.snare },
  { name: "Rim", note: N.snareRim },
  { name: "HH closed", note: N.hihatClosed },
  { name: "HH open", note: N.hihatOpen },
  { name: "HH pedal", note: N.hihatPedal },
  { name: "Tom 1", note: N.tom1 },
  { name: "Tom 2", note: N.tom2 },
  { name: "Tom 3", note: N.tom3 },
  { name: "Tom 4", note: N.tom4 },
  { name: "Crash 1", note: N.crash1 },
  { name: "Crash 2", note: 57 },
  { name: "Ride", note: N.ride },
  { name: "Bell", note: N.rideBell },
];

export function sendNote(note: number): void {
  inputBus.emit({ note, velocity: 100, channel: 9, source: "pad", timeStamp: performance.now() });
}

const clamp = (n: number) => Math.max(0, Math.min(127, Math.round(n)));

/** Touch-friendly simulated hits through the shared input bus. No listeners, so nothing to clean up. */
export function VirtualPads() {
  const [custom, setCustom] = useState(60);
  const [draft, setDraft] = useState("60");
  const set = (n: number) => { const v = clamp(Number.isFinite(n) ? n : 0); setCustom(v); setDraft(String(v)); };
  return (
    <div class="ke-vp">
      <div class="ke-vp-grid" role="group" aria-label="Virtual pads">
        {PADS.map((p) => (
          <button
            key={p.name} class="ke-vp-pad" aria-label={`${p.name}, note ${p.note}`}
            onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button !== 0) return; sendNote(p.note); }}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); sendNote(p.note); } }}
          >
            <span>{p.name}</span><small>{p.note}</small>
          </button>
        ))}
      </div>
      <div class="ke-vp-custom" role="group" aria-label="Custom note">
        <span class="muted">Custom note</span>
        <button class="ke-btn" aria-label="Note minus one" onClick={() => set(custom - 1)} disabled={custom <= 0}>-</button>
        <input
          class="ke-vp-num" type="number" inputMode="numeric" min={0} max={127} value={draft} aria-label="Note number 0 to 127"
          onInput={(e) => { const t = (e.target as HTMLInputElement).value; setDraft(t); if (t !== "" && Number.isFinite(Number(t))) setCustom(clamp(Number(t))); }}
          onBlur={() => set(draft === "" ? custom : Number(draft))}
          onKeyDown={(e) => { if (e.key === "Enter") { set(Number(draft)); sendNote(clamp(Number(draft))); } }}
        />
        <button class="ke-btn" aria-label="Note plus one" onClick={() => set(custom + 1)} disabled={custom >= 127}>+</button>
        <button class="ke-btn accent" onClick={() => sendNote(custom)}>Send</button>
      </div>
    </div>
  );
}
