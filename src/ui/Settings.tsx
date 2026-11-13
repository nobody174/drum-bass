import { useEffect, useState } from "preact/hooks";
import "../styles/settings.css";
import {
  getSoundSettings,
  isAudioUnlocked,
  playTestSound,
  subscribeAudioLock,
  subscribeSoundSettings,
  updateSoundSettings,
} from "../audio";

function useSoundSettings() {
  const [s, setS] = useState(getSoundSettings);
  useEffect(() => subscribeSoundSettings(() => setS(getSoundSettings())), []);
  return s;
}

function useUnlocked() {
  const [u, setU] = useState(isAudioUnlocked);
  useEffect(() => {
    const on = () => setU(isAudioUnlocked());
    on();
    return subscribeAudioLock(on);
  }, []);
  return u;
}

const TESTS = [
  { label: "Kick", note: 36 },
  { label: "Snare", note: 38 },
  { label: "Hat", note: 42 },
  { label: "Crash", note: 49 },
];

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="set-row">
      <span class="set-text">
        <span class="set-label">{props.label}</span>
        {props.hint && <span class="set-hint">{props.hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        class="set-switch"
        checked={props.checked}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </label>
  );
}

export default function Settings() {
  const s = useSoundSettings();
  const unlocked = useUnlocked();
  return (
    <div class="stack settings">
      <h1>Settings</h1>
      <section class="panel">
        <h2>Sound</h2>
        {!unlocked && <p class="set-lock">Tap anywhere to enable sound.</p>}
        <Toggle label="Hit sounds" hint="Synthesized drum sounds for pads and keyboard" checked={s.enabled} onChange={(v) => updateSoundSettings({ enabled: v })} />
        <label class="set-row">
          <span class="set-text">
            <span class="set-label">Volume</span>
          </span>
          <input
            type="range"
            class="set-range"
            min={0}
            max={100}
            step={1}
            value={Math.round(s.volume * 100)}
            aria-label="Hit sound volume"
            onInput={(e) => updateSoundSettings({ volume: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
          />
          <output class="set-value">{Math.round(s.volume * 100)}%</output>
        </label>
        <Toggle
          label="Also play sound for the real kit (MIDI)"
          hint="Off by default: the drum module already makes its own sound. Turn on if the module is muted."
          checked={s.playForMidi}
          onChange={(v) => updateSoundSettings({ playForMidi: v })}
        />
        <div class="set-tests" role="group" aria-label="Test sound">
          <span class="set-label">Test sound</span>
          {TESTS.map((t) => (
            <button key={t.note} type="button" class="pedal set-test" onClick={() => playTestSound(t.note)}>
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <section class="panel">
        <h2>More settings coming in M4</h2>
        <p>Latency calibration, timing windows, display options and data export arrive later.</p>
      </section>
    </div>
  );
}
