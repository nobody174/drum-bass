import { useEffect, useRef, useState } from "preact/hooks";
import { remapToKit } from "../chart/remap";
import { createTransport, type TransportImpl } from "../audio/transportImpl";
import { Judge, type JudgeSummary } from "../game/judge";
import { buildTimeline, songTempo, type Timeline } from "../game/timeline";
import { kitStore, matchNote, type KitPiece, type KitPreset } from "../kit";
import { inputBus, startVirtualKeyboard, stopVirtualKeyboard } from "../midi";
import { createLanesRenderer, type LanesRenderer } from "../render/lanes";
import { bestFor, songStore } from "../storage/songs";
import Results from "./Results";
import { silentStem } from "./play/silentWav";
import { PadRow } from "./play/PadRow";
import { parseParams, type PlayParams } from "./play/params";
import "../styles/play.css";

type Phase = "loading" | "ready" | "playing" | "paused" | "results" | "error";

/** Time after the last note before the run ends on its own (audio may carry on with an outro). */
const END_TAIL_SEC = 2.5;
/** Receipt-delay compensation is clamped so a stale timestamp can never move a hit far. */
const MAX_COMP_SEC = 0.1;

interface Session {
  transport: TransportImpl;
  judge: Judge;
  timeline: Timeline;
  renderer: LanesRenderer;
  params: PlayParams;
  bpm: number;
  prevBest: number;
  /** Click-only runs are practice and never recorded as a best. */
  ranked: boolean;
}

export default function Play({ songId, query }: { songId: string; query: URLSearchParams }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lanes, setLanes] = useState<readonly KitPiece[]>([]);
  const [summary, setSummary] = useState<JudgeSummary | null>(null);
  const [run, setRun] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>("loading");
  const sess = useRef<Session | null>(null);
  const presetRef = useRef<KitPreset | null>(null);
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const queryStr = query.toString();

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Build everything for one run. `run` changes on Retry.
  useEffect(() => {
    let alive = true;
    let transport: TransportImpl | null = null;
    let renderer: LanesRenderer | null = null;
    let offEnded: (() => void) | null = null;
    go("loading");
    setSummary(null);
    setError(null);
    startVirtualKeyboard();

    const finishRun = () => {
      const s = sess.current;
      if (!alive || !s || phaseRef.current === "results") return;
      s.judge.finish();
      s.transport.pause();
      s.renderer.stop();
      setSummary(s.judge.summary());
      go("results");
    };

    (async () => {
      try {
        const [song, preset] = await Promise.all([songStore.getSong(songId), kitStore.ensureDefault()]);
        if (!alive) return;
        if (!song) throw new Error("This song is not in your library any more.");
        presetRef.current = preset;
        const present = (["easy", "medium", "hard", "expert"] as const).filter((d) => (song.notesByDifficulty[d]?.length ?? 0) > 0);
        const params = parseParams(new URLSearchParams(queryStr), [...present], song.audio.map((a) => a.role));
        const mapped = remapToKit(song.notesByDifficulty[params.difficulty] ?? [], preset);
        const timeline = buildTimeline(mapped.notes, preset);
        if (timeline.notes.length === 0) throw new Error("This difficulty has no notes that fit your kit.");
        setLanes(timeline.lanes);

        const laneIndex = new Map(timeline.lanes.map((l, i) => [l.id, i]));
        let sink: LanesRenderer | null = null; // judge events feed the renderer created just below
        const judge = new Judge(timeline.notes, {
          onEvent: (e) => {
            const li = laneIndex.get(e.piece);
            if (li !== undefined) sink?.judgement(li, e.kind);
            if (e.kind !== "stray") sink?.setCombo(e.combo);
          },
        });
        transport = createTransport();
        await transport.load(song.audio.length ? song.audio : [silentStem(timeline.lastTime + END_TAIL_SEC + 2)], { delayMs: song.meta.delayMs + song.offsetMs });
        if (!alive) return;
        const tempo = songTempo(song.meta, timeline.notes);
        transport.setClickTrack({ points: tempo.points, beatsPerBar: tempo.beatsPerBar });
        transport.setMix(params.mix);

        renderer = createLanesRenderer(canvasRef.current!, {
          lanes: timeline.lanes,
          notes: { times: timeline.times, laneOf: timeline.laneOf, state: judge.state },
          durationSec: timeline.lastTime + END_TAIL_SEC,
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
          countIn: params.countIn > 0 ? { beats: params.countIn, beatSec: 60 / tempo.startBpm } : undefined,
        });
        sink = renderer;
        sess.current = { transport, judge, timeline, renderer, params, bpm: tempo.startBpm, prevBest: bestFor(song, params.difficulty), ranked: params.mix !== "clickonly" };
        offEnded = transport.onEnded(finishRun);
        renderer.start(() => {
          const s = sess.current!;
          const t = s.transport.songTime;
          if (phaseRef.current === "playing") {
            s.judge.update(t);
            if (t > s.timeline.lastTime + END_TAIL_SEC) finishRun();
          }
          return t;
        });
        go("ready");
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        go("error");
      }
    })();

    return () => {
      alive = false;
      offEnded?.();
      renderer?.destroy();
      transport?.dispose();
      sess.current = null;
      stopVirtualKeyboard();
    };
  }, [songId, queryStr, run]);

  // Live input: pads, keyboard and MIDI all arrive through the bus.
  useEffect(() => {
    return inputBus.subscribe((e) => {
      const s = sess.current;
      const preset = presetRef.current;
      if (!s || !preset || phaseRef.current !== "playing") return;
      const m = matchNote(preset, e.note);
      if (!m) return;
      // Song time at receipt, minus how long the event waited before reaching us (0 for taps and keys).
      const waited = Math.min(MAX_COMP_SEC, Math.max(0, (performance.now() - e.timeStamp) / 1000));
      s.judge.hit(m.piece, s.transport.songTime - waited);
    });
  }, []);

  // Wake lock while playing; auto-pause when the tab is hidden.
  useEffect(() => {
    const release = () => {
      void lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
    let acquiring = false;
    let alive = true;
    const acquire = async () => {
      try {
        if (phaseRef.current === "playing" && !lockRef.current && !acquiring && document.visibilityState === "visible") {
          acquiring = true;
          const lock = (await navigator.wakeLock?.request("screen")) ?? null;
          acquiring = false;
          // The phase may have changed while the request was pending: do not keep a lock we no longer need.
          if (lock && (phaseRef.current !== "playing" || !alive)) void lock.release().catch(() => {});
          else lockRef.current = lock;
        }
      } catch { acquiring = false; /* not supported or denied: ignore */ }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (phaseRef.current === "playing") pause();
        release();
      } else void acquire();
    };
    if (phase === "playing") void acquire();
    else release();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      release();
    };
  }, [phase]);

  const start = async () => {
    const s = sess.current;
    if (!s) return;
    try {
      // play() must run synchronously inside this tap so the browser lets audio start.
      await s.transport.play({ countInBeats: s.params.countIn, bpm: s.bpm });
      s.renderer.setPaused(false);
      go("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      go("error");
    }
  };

  function pause() {
    const s = sess.current;
    if (!s || phaseRef.current !== "playing") return;
    s.transport.pause();
    s.renderer.setPaused(true);
    go("paused");
  }

  const resume = async () => {
    const s = sess.current;
    if (!s) return;
    try {
      await s.transport.play({});
      s.renderer.setPaused(false);
      go("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      go("error");
    }
  };

  // A fresh run is the simplest way to reset judge state and renderer together (audio is decoded again).
  const restart = () => setRun((n) => n + 1);

  const back = () => {
    location.hash = `#/song/${encodeURIComponent(songId)}`;
  };

  return (
    <div class="play">
      <canvas ref={canvasRef} aria-label="Falling notes" />
      <PadRow lanes={lanes} />
      {phase === "playing" && (
        <button class="pl-pause" aria-label="Pause" onClick={pause}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        </button>
      )}
      {phase === "results" && summary && sess.current && (
        <div class="pl-results">
          <Results
            summary={summary} songId={songId} prevBest={sess.current.prevBest} lanes={lanes}
            difficulty={sess.current.params.difficulty} ranked={sess.current.ranked}
            onRetry={() => setRun((n) => n + 1)} onBack={back}
          />
        </div>
      )}
      {phase === "loading" && <div class="pl-overlay"><h2>Loading...</h2></div>}
      {phase === "ready" && (
        <div class="pl-overlay">
          <h2>Ready</h2>
          <p>Tap to unlock audio and start{sess.current && sess.current.params.countIn > 0 ? ` (${sess.current.params.countIn}-beat count-in)` : ""}.</p>
          <div class="pl-menu">
            <button class="pedal" onClick={() => void start()}>Tap to play</button>
            <button class="btn" onClick={back}>Back</button>
          </div>
        </div>
      )}
      {phase === "paused" && (
        <div class="pl-overlay">
          <h2>Paused</h2>
          <div class="pl-menu">
            <button class="pedal" onClick={() => void resume()}>Resume</button>
            <button class="btn accent" onClick={restart}>Restart</button>
            <button class="btn" onClick={back}>Back</button>
          </div>
        </div>
      )}
      {phase === "error" && (
        <div class="pl-overlay">
          <h2>Cannot play</h2>
          <p class="pl-err" role="alert">{error}</p>
          <div class="pl-menu">
            <button class="btn accent" onClick={() => setRun((n) => n + 1)}>Try again</button>
            <button class="btn" onClick={back}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
