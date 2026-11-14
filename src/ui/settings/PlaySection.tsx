import { useEffect, useState } from "preact/hooks";
import { settingsStore, TIMING_WINDOWS, type AppSettings, type TimingPreset } from "../../settings/store";
import { loadApproach, loadDisplayMode, saveApproach, saveDisplayMode, type DisplayMode } from "../play/params";
import { MAX_APPROACH_SEC, MIN_APPROACH_SEC } from "../../render/kitGeometry";
import { Choice, Toggle } from "./controls";

export function useAppSettings(): AppSettings {
  const [s, setS] = useState(() => settingsStore.get());
  useEffect(() => settingsStore.subscribe(setS), []);
  return s;
}

const PRESETS: { value: TimingPreset; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "normal", label: "Normal" },
  { value: "strict", label: "Strict" },
];

export default function PlaySection() {
  const s = useAppSettings();
  const [display, setDisplay] = useState<DisplayMode>(loadDisplayMode);
  const [approach, setApproach] = useState(loadApproach);
  const w = TIMING_WINDOWS[s.timingPreset];
  return (
    <div>
      <Choice<DisplayMode>
        label="Default display"
        value={display}
        options={[{ value: "lanes", label: "Lanes" }, { value: "kit", label: "Kit view" }]}
        onChange={(v) => { saveDisplayMode(v); setDisplay(v); }}
      />
      <label class="set-row">
        <span class="set-text">
          <span class="set-label">Ring approach time</span>
          <span class="set-hint">Kit view: how long a ring is visible before its note.</span>
        </span>
        <input
          type="range" class="set-range" aria-label="Ring approach time"
          min={MIN_APPROACH_SEC} max={MAX_APPROACH_SEC} step={0.2} value={approach}
          onInput={(e) => { saveApproach(Number((e.currentTarget as HTMLInputElement).value)); setApproach(loadApproach()); }}
        />
        <output class="set-value">{approach.toFixed(1)} s</output>
      </label>
      <Choice<0 | 2 | 4>
        label="Default count-in"
        hint="Beats before the music starts."
        value={s.defaultCountIn}
        options={[{ value: 0, label: "None" }, { value: 2, label: "2" }, { value: 4, label: "4" }]}
        onChange={(v) => settingsStore.set({ defaultCountIn: v })}
      />
      <Choice<TimingPreset>
        label="Timing windows"
        hint={<span data-testid="windows">Perfect +/-{w.perfect} ms, Good +/-{w.good} ms, OK +/-{w.ok} ms</span>}
        value={s.timingPreset}
        options={PRESETS}
        onChange={(v) => settingsStore.set({ timingPreset: v })}
      />
      <Toggle label="Metronome during play" hint="Click along with the music." checked={s.metronomeDuringPlay} onChange={(v) => settingsStore.set({ metronomeDuringPlay: v })} />
      <Toggle label="Keep screen awake" hint="Stops the screen from sleeping while you play." checked={s.keepAwake} onChange={(v) => settingsStore.set({ keepAwake: v })} />
    </div>
  );
}
