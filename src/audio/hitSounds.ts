/**
 * Synthesized drum hit sounds (pure Web Audio, no samples). Subscribes to the
 * input bus and plays a voice per hit so virtual pads / keyboard are audible.
 * Timing uses AudioContext.currentTime only.
 */
import { inputBus } from "../midi/inputBus";
import type { DrumInputEvent } from "../midi/types";
import {
  DEFAULT_SOUND_SETTINGS,
  loadSoundSettings,
  saveSoundSettings,
  type SoundSettings,
} from "./settings";
import { noteToVoice, shouldPlaySource, velocityToGain, VoiceLimiter, type VoiceKind } from "./voiceMap";

export const MAX_VOICES = 16;

interface Voice {
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  pending: number;
  cut: boolean;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
let started = false;
let unsubBus: (() => void) | null = null;
let unlockInstalled = false;

const settingsListeners = new Set<() => void>();
const lockListeners = new Set<() => void>();

const limiter = new VoiceLimiter<Voice>(MAX_VOICES, (v) => cutVoice(v));

function cutVoice(v: Voice): void {
  if (v.cut) return;
  v.cut = true;
  try {
    const t = ctx!.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setValueAtTime(v.out.gain.value, t);
    v.out.gain.linearRampToValueAtTime(0, t + 0.01);
    for (const s of v.sources) {
      try {
        s.stop(t + 0.012);
      } catch {
        /* already stopped */
      }
    }
  } catch {
    /* ignore */
  }
}

// ---- settings -------------------------------------------------------------

export function getSoundSettings(): SoundSettings {
  return settings;
}

export function updateSoundSettings(patch: Partial<SoundSettings>): void {
  settings = { ...settings, ...patch };
  saveSoundSettings(settings);
  if (master && ctx) master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.01);
  settingsListeners.forEach((l) => l());
}

export function subscribeSoundSettings(l: () => void): () => void {
  settingsListeners.add(l);
  return () => settingsListeners.delete(l);
}

// ---- audio context lifecycle ---------------------------------------------

export function isAudioUnlocked(): boolean {
  return !!ctx && ctx.state === "running";
}

export function subscribeAudioLock(l: () => void): () => void {
  lockListeners.add(l);
  return () => lockListeners.delete(l);
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
    ctx.addEventListener("statechange", () => lockListeners.forEach((l) => l()));
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

function tryUnlock(): void {
  const c = ensureContext();
  if (!c) return;
  const done = () => {
    if (c.state === "running") {
      removeUnlockListeners();
      lockListeners.forEach((l) => l());
    }
  };
  if (c.state === "running") return done();
  c.resume().then(done, () => {});
}

const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;
function removeUnlockListeners(): void {
  if (!unlockInstalled) return;
  unlockInstalled = false;
  for (const e of UNLOCK_EVENTS) window.removeEventListener(e, tryUnlock, true);
}

function installUnlock(): void {
  if (unlockInstalled) return;
  unlockInstalled = true;
  for (const e of UNLOCK_EVENTS) window.addEventListener(e, tryUnlock, true);
}

// ---- synthesis ------------------------------------------------------------

function getNoise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

class Builder {
  voice: Voice;
  constructor(
    readonly c: AudioContext,
    readonly t: number,
    peak: number,
  ) {
    const out = c.createGain();
    out.gain.value = peak;
    out.connect(master!);
    this.voice = { out, sources: [], pending: 0, cut: false };
  }

  private track(s: AudioScheduledSourceNode, end: number, offset?: number): void {
    this.voice.sources.push(s);
    this.voice.pending++;
    s.onended = () => {
      s.disconnect();
      if (--this.voice.pending === 0) {
        this.voice.out.disconnect();
        limiter.remove(this.voice);
      }
    };
    if (offset !== undefined && s instanceof AudioBufferSourceNode) s.start(this.t, offset);
    else s.start(this.t);
    s.stop(this.t + end + 0.02);
  }

  /** Oscillator with exponential amplitude decay into `dest`. */
  osc(type: OscillatorType, f0: number, f1: number, fTime: number, amp: number, decay: number, dest?: AudioNode): void {
    const { c, t } = this;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + fTime);
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest ?? this.voice.out);
    this.track(o, decay);
  }

  /** Filtered noise burst with exponential decay. */
  noise(filter: BiquadFilterType, freq: number, q: number, amp: number, decay: number): void {
    const { c, t } = this;
    const s = c.createBufferSource();
    s.buffer = getNoise(c);
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(g).connect(this.voice.out);
    // Random start offset so repeated hits are not identical.
    this.track(s, decay, Math.random());
  }
}

const METAL_RATIOS = [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637];

function build(kind: VoiceKind, pitch: number, t: number, gain: number): Voice {
  const b = new Builder(ctx!, t, gain);
  switch (kind) {
    case "kick":
      b.osc("sine", 150, 45, 0.12, 1, 0.38);
      b.osc("triangle", 1800, 300, 0.01, 0.35, 0.02); // click
      break;
    case "snare":
      b.noise("highpass", 1800, 0.7, 0.8, 0.2);
      b.osc("triangle", 220, 160, 0.08, 0.6, 0.12);
      b.osc("sine", 330, 250, 0.08, 0.3, 0.09);
      break;
    case "rim":
      b.osc("square", 1700, 1200, 0.01, 0.5, 0.03);
      b.noise("bandpass", 3000, 1.5, 0.5, 0.03);
      break;
    case "tom":
      b.osc("sine", pitch * 1.8, pitch, 0.09, 1, 0.35);
      b.osc("triangle", pitch * 3, pitch * 2, 0.05, 0.2, 0.1);
      b.noise("bandpass", 2500, 1, 0.15, 0.03);
      break;
    case "hatClosed":
      b.noise("highpass", 7000, 0.8, 0.7, 0.05);
      break;
    case "hatOpen":
      b.noise("highpass", 6500, 0.8, 0.65, 0.42);
      break;
    case "crash":
      b.noise("highpass", 5000, 0.6, 0.7, 1.4);
      for (const r of METAL_RATIOS) b.osc("square", 420 * r, 420 * r, 0, 0.04, 0.9);
      break;
    case "ride":
      for (const r of METAL_RATIOS) b.osc("square", 340 * r, 340 * r, 0, 0.05, 0.6);
      b.noise("highpass", 7000, 0.8, 0.25, 0.35);
      b.osc("triangle", 5200, 5200, 0, 0.1, 0.15);
      break;
    case "bell":
      for (const r of METAL_RATIOS.slice(0, 4)) b.osc("triangle", 900 * r, 900 * r, 0, 0.18, 0.7);
      b.osc("sine", 3200, 3200, 0, 0.2, 0.5);
      break;
    default:
      b.osc("sine", 700, 600, 0.05, 0.5, 0.06);
  }
  return b.voice;
}

/** Plays one voice now. Silent no-op while the context is locked. */
export function playHit(note: number, velocity: number): void {
  try {
    if (!ctx || ctx.state !== "running" || !master) return;
    const spec = noteToVoice(note);
    const gain = velocityToGain(velocity);
    if (gain <= 0) return;
    const voice = build(spec.kind, spec.pitch, ctx.currentTime, gain * 0.9);
    limiter.add(voice);
  } catch {
    /* never let audio errors break input handling */
  }
}

/** Plays a test sound regardless of the enabled flag (still needs unlocked audio). */
export function playTestSound(note: number): void {
  tryUnlock();
  playHit(note, 110);
}

function onInput(e: DrumInputEvent): void {
  if (!shouldPlaySource(e.source, settings)) return;
  playHit(e.note, e.velocity);
}

/** Starts the engine once: loads settings, installs unlock listeners, subscribes to the bus. */
export function startSoundEngine(): void {
  if (started) return;
  started = true;
  settings = loadSoundSettings();
  installUnlock();
  unsubBus = inputBus.subscribe(onInput);
}

export function stopSoundEngine(): void {
  unsubBus?.();
  unsubBus = null;
  removeUnlockListeners();
  started = false;
}
