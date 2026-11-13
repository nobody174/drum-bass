import type { KitPiece } from "../../kit/types";
import { inputBus } from "../../midi";

function firstNote(p: KitPiece): number | null {
  const v = Object.values(p.midiNotes);
  return v.length ? v[0]! : null;
}

/** Compact touch pad row (one pad per lane, same order). Emits through the shared input bus. */
export function PadRow({ lanes }: { lanes: readonly KitPiece[] }) {
  return (
    <div class="pl-pads" role="group" aria-label="On-screen pads">
      {lanes.map((p) => {
        const note = firstNote(p);
        return (
          <button
            key={p.id}
            class="pl-pad"
            style={{ "--c": p.color } as Record<string, string>}
            disabled={note === null}
            aria-label={p.id}
            onPointerDown={(e) => {
              if (note === null || (e.pointerType === "mouse" && e.button !== 0)) return;
              e.preventDefault();
              inputBus.emit({ note, velocity: 100, channel: 9, source: "pad", timeStamp: performance.now() });
            }}
          >
            {p.id.replace("hihat", "hat")}
          </button>
        );
      })}
    </div>
  );
}
