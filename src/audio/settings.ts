export interface SoundSettings {
  enabled: boolean;
  /** 0..1 */
  volume: number;
  /** Also sound hits that come from real MIDI input. */
  playForMidi: boolean;
}

export const SOUND_SETTINGS_KEY = "drum-bass.settings.sound";

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.8,
  playForMidi: false,
};

export function sanitizeSoundSettings(raw: unknown): SoundSettings {
  const d = DEFAULT_SOUND_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const vol = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    volume: vol,
    playForMidi: typeof r.playForMidi === "boolean" ? r.playForMidi : d.playForMidi,
  };
}

export function loadSoundSettings(): SoundSettings {
  try {
    const text = localStorage.getItem(SOUND_SETTINGS_KEY);
    if (!text) return { ...DEFAULT_SOUND_SETTINGS };
    return sanitizeSoundSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

export function saveSoundSettings(s: SoundSettings): void {
  try {
    localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(sanitizeSoundSettings(s)));
  } catch {
    /* storage unavailable: setting just lasts for this session */
  }
}
