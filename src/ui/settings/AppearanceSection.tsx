import { settingsStore } from "../../settings/store";
import { PALETTE_PREVIEW } from "../../settings/palette";
import { Toggle } from "./controls";
import { useAppSettings } from "./PlaySection";

export default function AppearanceSection() {
  const s = useAppSettings();
  const cb = s.colorblindPalette;
  return (
    <div>
      <Toggle
        label="Colorblind-friendly colors"
        hint="Okabe-Ito palette for the drum pieces; cymbals turn white/grey."
        checked={cb}
        onChange={(v) => settingsStore.set({ colorblindPalette: v })}
      />
      <div class="set-preview" role="img" aria-label="Piece color preview">
        {PALETTE_PREVIEW.map((p) => (
          <span key={p.id} class="set-chip">
            <span class="set-dot" style={{ background: cb ? p.color : p.normal }} />
            {p.label}
          </span>
        ))}
      </div>
      <p class="set-hint set-note">
        Animations (hit flashes, shakes) switch off automatically when your device has "reduce motion" turned on. There is no separate setting for that.
      </p>
    </div>
  );
}
