/**
 * Web Audio implementation of the Transport contract.
 *
 * Timing model: all positions derive from AudioContext.currentTime. While playing,
 *   songTime = (ctx.currentTime - anchorCtxTime) + anchorSongTime - outputLatencySec
 * where the anchor is set every time the sources are (re)started. Audio position of a stem
 * for a given song time is `songTime + delayMs/1000` (song.ini delay: positive = the chart is
 * delayed relative to the audio, so chart time 0 sits `delay` seconds into the audio).
 * Buffer sources are one-shot, so they are recreated on every play/seek/resume; mix changes only
 * move the per-stem gains and never touch the sources.
 */
import type { ImportedAudio, StemRole } from "../chart/types";
import { createBeatGrid, type BeatGrid, type TempoPoint } from "../chart/tempo";
import { ClickGroup, countInBeats } from "./click";
import { gainsForStems, planMix } from "./stems";
import type { MixMode, Transport, TransportState } from "./transport";

export interface TransportImpl extends Transport {
  readonly mix: MixMode;
  /** False when `nodrums` cannot remove drums (only a full mix, or nothing but drums). */
  readonly nodrumsAvailable: boolean;
  /** False when there is no drums stem. */
  readonly drumsonlyAvailable: boolean;
  /** Seconds subtracted from songTime to account for output latency. Calibration is M4. */
  outputLatencySec: number;
  /** Length of the loaded audio in song-time seconds (0 when nothing is loaded). */
  readonly durationSec: number;
  readonly context: AudioContext;
  /**
   * Chart tempo map used by the "clickonly" mix: a metronome is scheduled on the audio clock for the whole
   * song (accent on beat 1, tempo changes honoured). Without it clickonly is silent after the count-in.
   */
  setClickTrack(track: { points: readonly TempoPoint[]; beatsPerBar?: number } | null): void;
  /**
   * Metronome during play for the non-clickonly mixes (M4 setting). Uses the same click track as "clickonly",
   * so the two can never double up. Takes effect immediately when playing.
   */
  setMetronome(on: boolean): void;
}

/** Lead between "now" and the first scheduled sample, so the start is sample-accurate. */
export const START_LEAD_SEC = 0.05;
const GAIN_RAMP = 0.01;
/** Click-track scheduling: how far ahead of the audio clock ticks are created, and how often we top up. */
const CLICK_LOOKAHEAD_SEC = 0.5;
const CLICK_PUMP_MS = 50;

let shared: AudioContext | null = null;

/** Lazily creates the app-wide AudioContext for playback. */
export function getSharedAudioContext(): AudioContext {
  if (shared && shared.state !== "closed") return shared;
  const Ctor: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not supported in this browser.");
  shared = new Ctor({ latencyHint: "interactive" });
  return shared;
}

/** Browser-reported output latency (seconds), a starting point for M4 calibration. */
export function reportedOutputLatencySec(ctx: AudioContext): number {
  const c = ctx as AudioContext & { outputLatency?: number };
  const v = c.outputLatency ?? ctx.baseLatency ?? 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

interface Stem {
  name: string;
  role: StemRole;
  buffer: AudioBuffer;
  gain: GainNode;
}

export function createTransport(injected?: AudioContext): TransportImpl {
  let ctxRef: AudioContext | null = injected ?? null;
  const getCtx = (): AudioContext => (ctxRef ??= getSharedAudioContext());

  let master: GainNode | null = null;
  let clicks: ClickGroup | null = null;
  let trackClicks: ClickGroup | null = null;
  let clickBus: GainNode | null = null;
  const ensureGraph = (): AudioContext => {
    const ctx = getCtx();
    if (!master) {
      master = ctx.createGain();
      master.connect(ctx.destination);
      clickBus = ctx.createGain();
      clickBus.connect(master);
      clicks = new ClickGroup(ctx, clickBus);
      trackClicks = new ClickGroup(ctx, clickBus);
    }
    return ctx;
  };

  let state: TransportState = "empty";
  let stems: Stem[] = [];
  let delaySec = 0;
  let mix: MixMode = "full";
  let metronome = false;
  let latency = 0;
  let sources: AudioBufferSourceNode[] = [];
  let gen = 0; // bumped whenever sources are stopped; stale onended callbacks are ignored
  let token = 0; // bumped on pause/seek/dispose/load; aborts a play() waiting on resume()
  let anchorCtx = 0;
  let anchorSong = 0;
  let pausedPos = 0;
  let countIn: { beats: number; bpm: number } | null = null;
  let grid: BeatGrid | null = null;
  let clickTimer: ReturnType<typeof setInterval> | null = null;
  const endedCbs = new Set<() => void>();

  const durationSec = (): number => stems.reduce((m, s) => Math.max(m, s.buffer.duration), 0) - delaySec;
  const finiteOr0 = (n: number) => (Number.isFinite(n) ? n : 0);

  function currentSongTime(): number {
    if (state === "playing") return getCtx().currentTime - anchorCtx + anchorSong - latency;
    if (state === "ended") return durationSec();
    return pausedPos;
  }

  function applyGains(immediate: boolean): void {
    if (!stems.length) return;
    const ctx = getCtx();
    const gains = gainsForStems(
      stems.map((s) => s.role),
      mix,
    );
    stems.forEach((s, i) => {
      const g = gains[i] ?? 0;
      if (immediate) {
        s.gain.gain.value = g;
      } else {
        s.gain.gain.cancelScheduledValues?.(ctx.currentTime);
        s.gain.gain.setTargetAtTime(g, ctx.currentTime, GAIN_RAMP / 3);
      }
    });
  }

  function stopSources(): void {
    gen++;
    for (const src of sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* never started or already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* ignore */
      }
    }
    sources = [];
    clicks?.cancelAll();
    stopClickTrack();
  }

  function stopClickTrack(): void {
    if (clickTimer !== null) clearInterval(clickTimer);
    clickTimer = null;
    trackClicks?.cancelAll();
  }

  /** Metronome for the whole song from chart time `from` (anchored by anchorCtx/anchorSong). Only in clickonly. */
  function startClickTrack(from: number): void {
    stopClickTrack();
    if ((mix !== "clickonly" && !metronome) || !grid || !trackClicks) return;
    const g = grid;
    const group = trackClicks;
    const end = durationSec();
    let next = g.firstBeatAtOrAfter(Math.max(0, from));
    const pump = () => {
      const horizon = getCtx().currentTime + CLICK_LOOKAHEAD_SEC;
      for (;;) {
        const songT = g.timeOfBeat(next);
        if (songT > end) {
          if (clickTimer !== null) clearInterval(clickTimer);
          clickTimer = null;
          return;
        }
        const when = anchorCtx + (songT - anchorSong);
        if (when > horizon) return;
        group.tick(when, g.isAccent(next));
        next++;
      }
    };
    pump();
    clickTimer = setInterval(pump, CLICK_PUMP_MS);
  }

  function fireEnded(): void {
    state = "ended";
    stopClickTrack();
    pausedPos = durationSec();
    for (const cb of [...endedCbs]) {
      try {
        cb();
      } catch {
        /* listener errors must not break the transport */
      }
    }
  }

  /** Starts sources + count-in clicks so that song time `from` happens at ctx time `at`. */
  function startAt(from: number, at: number): void {
    const ctx = getCtx();
    const myGen = ++gen;
    anchorCtx = at;
    anchorSong = from;
    let longest = -1;
    let longestEnd = -Infinity;
    const plan: { s: Stem; when: number; off: number; end: number }[] = [];
    for (const s of stems) {
      const audioPos = from + delaySec;
      if (audioPos >= s.buffer.duration) continue;
      const when = audioPos >= 0 ? at : at - audioPos;
      const off = Math.max(0, audioPos);
      const end = when + (s.buffer.duration - off);
      plan.push({ s, when, off, end });
      if (end > longestEnd) {
        longestEnd = end;
        longest = plan.length - 1;
      }
    }
    sources = plan.map((p, i) => {
      const src = ctx.createBufferSource();
      src.buffer = p.s.buffer;
      src.connect(p.s.gain);
      if (i === longest) {
        src.onended = () => {
          if (myGen === gen && state === "playing") fireEnded();
        };
      }
      src.start(p.when, p.off);
      return src;
    });
    // Count-in clicks that are still ahead of `from`.
    if (countIn && clicks) {
      for (const b of countInBeats(countIn.beats, countIn.bpm)) {
        if (b.songTime >= from - 1e-9) clicks.tick(at + (b.songTime - from), b.accent);
      }
    }
    startClickTrack(from);
  }

  function requireReady(): void {
    if (!stems.length) throw new Error("Nothing is loaded: call load() with at least one audio stem first.");
  }

  const api: TransportImpl = {
    get state() {
      return state;
    },
    get songTime() {
      return currentSongTime();
    },
    get mix() {
      return mix;
    },
    get nodrumsAvailable() {
      return planMix(
        stems.map((s) => s.role),
        "nodrums",
      ).nodrumsAvailable;
    },
    get drumsonlyAvailable() {
      return planMix(
        stems.map((s) => s.role),
        "drumsonly",
      ).drumsonlyAvailable;
    },
    get outputLatencySec() {
      return latency;
    },
    set outputLatencySec(v: number) {
      latency = Math.max(0, finiteOr0(v));
    },
    get durationSec() {
      return stems.length ? durationSec() : 0;
    },
    get context() {
      return getCtx();
    },

    async load(files: ImportedAudio[], opts?: { delayMs?: number }) {
      const ctx = ensureGraph();
      token++;
      stopSources();
      for (const s of stems) s.gain.disconnect();
      stems = [];
      state = "empty";
      pausedPos = 0;
      delaySec = finiteOr0(opts?.delayMs ?? 0) / 1000;
      // Memory trade-off: stems are decoded one at a time and each encoded ArrayBuffer is dropped as soon as
      // it is decoded, so peak memory is (all decoded buffers so far + ONE encoded file) instead of
      // (all encoded + all decoded) with parallel decoding. Cost: loading is slower (no parallel decode).
      // Decoded PCM is large (about 10 MB per minute of stereo audio at 44.1 kHz), so a many-stem song
      // can still be heavy on low-memory phones; fewer/merged stems are the real fix.
      const buffers: (AudioBuffer | null)[] = [];
      const failed: string[] = [];
      for (const f of files) {
        let data: ArrayBuffer | null = null;
        try {
          data = await f.blob.arrayBuffer();
        } catch (e) {
          failed.push(`Could not read audio file "${f.name}": ${(e as Error)?.message ?? e}`);
          buffers.push(null);
          continue;
        }
        try {
          buffers.push(await ctx.decodeAudioData(data));
        } catch (e) {
          const why = (e as Error)?.message || "unsupported or corrupt data";
          failed.push(`Could not decode audio "${f.name}" (${why}). Try re-exporting it as ogg, mp3 or wav.`);
          buffers.push(null);
        } finally {
          data = null; // release our reference right away (decodeAudioData also detaches it)
        }
      }
      if (failed.length) throw new Error(failed.join(" "));
      stems = files.map((f, i) => {
        const gain = ctx.createGain();
        gain.connect(master!);
        return { name: f.name, role: f.role, buffer: buffers[i]!, gain };
      });
      applyGains(true);
      state = stems.length ? "ready" : "empty";
    },

    setMix(mode: MixMode) {
      mix = mode;
      applyGains(false); // gains only: sources and position are untouched
      // The click track follows the mix without touching the audio sources.
      if (state === "playing") {
        if (mix === "clickonly" || metronome) startClickTrack(getCtx().currentTime - anchorCtx + anchorSong);
        else stopClickTrack();
      }
    },

    setMetronome(on: boolean) {
      if (metronome === on) return;
      metronome = on;
      if (state === "playing") {
        if (mix === "clickonly" || metronome) startClickTrack(getCtx().currentTime - anchorCtx + anchorSong);
        else stopClickTrack();
      }
    },

    setClickTrack(track) {
      grid = track ? createBeatGrid(track.points, track.beatsPerBar ?? 4) : null;
    },

    async play(opts?: { countInBeats?: number; bpm?: number }) {
      requireReady();
      if (state === "playing") return;
      const ctx = ensureGraph();
      const myToken = ++token;
      // Must be called synchronously from the user gesture.
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch (e) {
          throw new Error(`Audio is blocked by the browser (${(e as Error)?.message ?? "resume failed"}). Tap the screen and try again.`);
        }
        if (myToken !== token) return; // paused/seeked/disposed meanwhile
        if ((ctx.state as AudioContextState) !== "running") {
          throw new Error("Audio could not be started (the audio context is not running).");
        }
      }
      let from = state === "ended" ? 0 : pausedPos;
      const beats = opts?.countInBeats ?? 0;
      const bpm = opts?.bpm ?? 0;
      if (from === 0 && beats > 0 && bpm > 0) {
        countIn = { beats, bpm };
        from = -(beats * 60) / bpm;
      } else if (from >= 0) {
        countIn = null;
      } // from < 0: resume the stored count-in
      startAt(from, ctx.currentTime + START_LEAD_SEC);
      state = "playing";
    },

    pause() {
      token++;
      if (state !== "playing") return;
      pausedPos = currentSongTime();
      stopSources();
      state = "paused";
    },

    seek(sec: number) {
      token++;
      if (!stems.length) return;
      const minTime = countIn ? -(countIn.beats * 60) / countIn.bpm : 0;
      const target = Math.min(Math.max(finiteOr0(sec), minTime), durationSec());
      if (state === "playing") {
        stopSources();
        if (target >= durationSec()) return fireEnded();
        startAt(target, getCtx().currentTime + START_LEAD_SEC);
      } else {
        pausedPos = target;
        if (state === "ended") state = "paused";
        if (state === "ready" && target !== 0) state = "paused";
        if (target >= 0 && target !== 0) countIn = null;
      }
    },

    onEnded(cb: () => void) {
      endedCbs.add(cb);
      return () => {
        endedCbs.delete(cb);
      };
    },

    dispose() {
      token++;
      stopSources();
      for (const s of stems) s.gain.disconnect();
      stems = [];
      endedCbs.clear();
      try {
        clickBus?.disconnect();
        master?.disconnect();
      } catch {
        /* ignore */
      }
      master = null;
      clickBus = null;
      clicks = null;
      trackClicks = null;
      state = "empty";
      pausedPos = 0;
    },
  };
  return api;
}
