import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import "../styles/settings.css";
import pkg from "../../package.json";
import {
  getSoundSettings,
  isAudioUnlocked,
  playTestSound,
  subscribeAudioLock,
  subscribeSoundSettings,
  updateSoundSettings,
} from "../audio";
import { Toggle } from "./settings/controls";
import PlaySection from "./settings/PlaySection";
import AppearanceSection from "./settings/AppearanceSection";
import MidiSection from "./settings/MidiSection";
import CalibrationSection from "./settings/CalibrationSection";
import DataSection from "./settings/DataSection";

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

function SoundSection() {
  const s = useSoundSettings();
  const unlocked = useUnlocked();
  return (
    <div>
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
    </div>
  );
}

function AboutSection() {
  return (
    <div>
      <div class="set-row set-row-col">
        <span class="set-text">
          <span class="set-label">Drum Bass v{pkg.version}</span>
          <span class="set-hint">Drum learning app for e-drum kits.</span>
        </span>
        <a class="btn" href="https://github.com/nobody174/drum-bass" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </div>
      <p class="set-hint set-note">
        Your kits, songs, scores and settings stay on this device (browser storage). Nothing is uploaded anywhere. Use Data &gt; Export to back them up.
      </p>
      <div class="set-row set-row-dis" aria-disabled="true">
        <span class="set-text">
          <span class="set-label">Language: English</span>
          <span class="set-hint">Norwegian planned.</span>
        </span>
      </div>
    </div>
  );
}

const TABS: { id: string; label: string; render: () => ComponentChildren }[] = [
  { id: "sound", label: "Sound", render: () => <SoundSection /> },
  { id: "play", label: "Play", render: () => <PlaySection /> },
  { id: "appearance", label: "Look", render: () => <AppearanceSection /> },
  { id: "midi", label: "MIDI", render: () => <MidiSection /> },
  { id: "calibration", label: "Calibration", render: () => <CalibrationSection /> },
  { id: "data", label: "Data", render: () => <DataSection /> },
  { id: "about", label: "About", render: () => <AboutSection /> },
];
const TAB_KEY = "drum-bass.settings.tab";

export default function Settings() {
  const [tab, setTab] = useState(() => {
    try {
      const t = sessionStorage.getItem(TAB_KEY);
      if (t && TABS.some((x) => x.id === t)) return t;
    } catch { /* ignore */ }
    return "sound";
  });
  const pick = (id: string) => {
    setTab(id);
    try { sessionStorage.setItem(TAB_KEY, id); } catch { /* ignore */ }
  };
  const curId = (TABS.find((t) => t.id === tab) ?? TABS[0]!).id;
  return (
    <div class="stack settings">
      <h1>Settings</h1>
      <div class="set-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`set-tab-${t.id}`} aria-selected={t.id === curId} aria-controls={`set-panel-${t.id}`} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Only the Data panel stays mounted when inactive, so export/import state survives tab switches.
          Every other panel unmounts, which also stops a running calibration (clicks, listeners) when you leave it. */}
      {TABS.map((t) => (
        <section key={t.id} class="panel" id={`set-panel-${t.id}`} role="tabpanel" aria-labelledby={`set-tab-${t.id}`} hidden={t.id !== curId}>
          {t.id === "data" || t.id === curId ? t.render() : null}
        </section>
      ))}
    </div>
  );
}
