import { useEffect, useRef, useState } from "preact/hooks";
import { getSharedAudioContext } from "../../audio/transportImpl";
import { ClickGroup } from "../../audio/click";
import {
  CAL_BPM,
  CAL_CLICKS,
  calibrate,
  clickSchedule,
  estimateClockOffsetMs,
  offsetToApply,
  applyProblem,
  retuneOutput,
  type CalibrationResult,
  type ClockPair,
} from "../../audio/calibration";
import { inputBus, startVirtualKeyboard, stopVirtualKeyboard } from "../../midi";
import { settingsStore } from "../../settings/store";
import "../../styles/calibration.css";

type Phase = "idle" | "running" | "done" | "error";
const LEAD_SEC = 1.5;

function useSettings() {
  const [s, setS] = useState(settingsStore.get());
  useEffect(() => settingsStore.subscribe(setS), []);
  return s;
}

function Tuner(props: { name: string; value: number; onChange: (v: number) => void }) {
  const step = (d: number) => props.onChange(props.value + d);
  return (
    <div class="cal-tune" role="group" aria-label={props.name}>
      <span class="cal-name">{props.name}</span>
      <button class="btn" aria-label={`${props.name} minus 5 ms`} onClick={() => step(-5)}>-5</button>
      <button class="btn" aria-label={`${props.name} minus 1 ms`} onClick={() => step(-1)}>-1</button>
      <output aria-live="polite">{props.value} ms</output>
      <button class="btn" aria-label={`${props.name} plus 1 ms`} onClick={() => step(1)}>+1</button>
      <button class="btn" aria-label={`${props.name} plus 5 ms`} onClick={() => step(5)}>+5</button>
    </div>
  );
}

export default function CalibrationSection() {
  const settings = useSettings();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [beat, setBeat] = useState(0);
  const [hitCount, setHitCount] = useState(0);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = async () => {
    cleanup.current?.();
    setError("");
    setResult(null);
    setApplied(false);
    setApplyMsg("");
    setBeat(0);
    setHitCount(0);
    try {
      const ctx = getSharedAudioContext();
      if (ctx.state !== "running") await ctx.resume();
      const bus = ctx.createGain();
      bus.connect(ctx.destination);
      const group = new ClickGroup(ctx, bus);
      const t0 = ctx.currentTime + LEAD_SEC;
      const sched = clickSchedule(t0, CAL_BPM, CAL_CLICKS);
      for (const c of sched) group.tick(c.time, c.accent);

      const pairs: ClockPair[] = [];
      const sample = () => pairs.push({ ctxSec: ctx.currentTime, perfMs: performance.now() });
      const hits: number[] = [];
      const onHit = (perfMs: number) => {
        sample();
        hits.push(perfMs);
        setHitCount(hits.length);
      };
      sample();
      const offBus = inputBus.subscribe((e) => onHit(e.timeStamp));
      startVirtualKeyboard();
      const lastClick = sched[sched.length - 1]!.time;
      const poll = setInterval(() => {
        sample();
        setBeat(Math.max(0, Math.min(CAL_CLICKS, Math.floor((ctx.currentTime - t0) / (60 / CAL_BPM)) + 1)));
        if (ctx.currentTime > lastClick + 0.8) finish();
      }, 50);
      let over = false;
      const stop = () => {
        over = true;
        clearInterval(poll);
        offBus();
        stopVirtualKeyboard();
        group.cancelAll();
        try {
          bus.disconnect();
        } catch {
          /* ignore */
        }
        cleanup.current = null;
      };
      const finish = () => {
        if (over) return;
        sample();
        const offset = estimateClockOffsetMs(pairs);
        stop();
        setResult(calibrate(hits, sched.map((c) => c.time), offset));
        setPhase("done");
      };
      cleanup.current = stop;
      // Tap button: handled by the same collector (pointer event timestamps use the performance.now clock).
      tapHandler.current = (ts) => {
        if (!over) onHit(ts);
      };
      setPhase("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };
  const tapHandler = useRef<((ts: number) => void) | null>(null);

  const cancel = () => {
    cleanup.current?.();
    setPhase("idle");
  };

  const apply = () => {
    if (!result || result.verdict === "too-few") return;
    const value = offsetToApply(result.offsetMs, settingsStore.get().outputLatencyMs);
    const problem = applyProblem(value);
    if (problem) {
      setApplyMsg(problem);
      return;
    }
    setApplyMsg("");
    settingsStore.set({ inputLatencyMs: value });
    setApplied(true);
  };

  const fmt = (n: number) => (Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(0)} ms` : "-");

  return (
    <div class="cal">
      <p>
        Hit along to the click: when you hear it, tap the big button (or hit any pad or key) exactly at that moment.
        You do not need to play a rhythm, just follow the beat. It plays {CAL_CLICKS} clicks at {CAL_BPM} BPM; the first
        few hits are ignored as warm-up.
      </p>
      <p class="cal-warn">
        Honest limit: without a microphone the app cannot tell audio output delay and input delay apart. The wizard
        measures one combined number and applies it to your input timing. Use the same way of hitting (and the same
        headphones, speaker or Bluetooth) as when you play.
      </p>

      {phase !== "running" && <button class="pedal" onClick={() => void start()}>{phase === "done" ? "Run again" : "Start calibration"}</button>}
      {phase === "running" && (
        <>
          <p class="cal-progress" role="status">Click {beat} / {CAL_CLICKS} - hits {hitCount}</p>
          <button
            class="cal-tap"
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              e.preventDefault();
              tapHandler.current?.(e.timeStamp);
            }}
          >
            TAP ON THE CLICK
          </button>
          <div class="cal-actions"><button class="btn" onClick={cancel}>Cancel</button></div>
        </>
      )}
      {phase === "error" && <p class="cal-warn" role="alert">{error}</p>}

      {phase === "done" && result && (
        <div role="status">
          <p class={`cal-verdict ${result.verdict}`}>
            {result.verdict === "good" ? "Good" : result.verdict === "noisy" ? "Noisy, try again" : "Too few hits, try again"}
          </p>
          <p>{result.message}</p>
          <div class="cal-stats">
            <div class="cal-stat"><b>{fmt(result.medianMs)}</b><span>Median</span></div>
            <div class="cal-stat"><b>{fmt(result.meanMs)}</b><span>Mean</span></div>
            <div class="cal-stat"><b>{Number.isFinite(result.spreadMs) ? result.spreadMs.toFixed(0) : "-"} ms</b><span>Spread (sd)</span></div>
            <div class="cal-stat"><b>{result.used} / {result.received}</b><span>Hits used</span></div>
          </div>
          <p>Positive means your hits came late. Applying it shifts your hits earlier by that amount when scoring.</p>
          <div class="cal-actions">
            <button class="btn accent" disabled={result.verdict === "too-few" || applied} onClick={apply}>
              {applied ? "Applied" : `Apply ${fmt(result.verdict === "too-few" ? NaN : offsetToApply(result.offsetMs, settings.outputLatencyMs))}`}
            </button>
          </div>
          {applyMsg && <p class="cal-warn" role="alert">{applyMsg}</p>}
          <p>Run it twice and compare: if the two results differ by more than about 15 ms, trust neither and try again.</p>
        </div>
      )}

      <Tuner name="Input latency" value={settings.inputLatencyMs} onChange={(v) => settingsStore.set({ inputLatencyMs: v })} />
      <p>Your hits are moved earlier by this much when scoring. Raise it if the results screen keeps saying you are late even when you feel on time.</p>
      <Tuner name="Output latency" value={settings.outputLatencyMs} onChange={(v) => {
        const cur = settingsStore.get();
        const r = retuneOutput(cur.inputLatencyMs, cur.outputLatencyMs, v);
        settingsStore.set({ inputLatencyMs: r.inputLatencyMs, outputLatencyMs: r.outputLatencyMs });
      }} />
      <p>Delays the falling notes to match sound that reaches you late (Bluetooth, some phones). Leave at 0 unless the picture runs ahead of the sound.</p>
      <p class="cal-hint">The two tuners are linked: changing Output by some ms changes Input by the opposite amount, so your scoring stays the same and only the picture moves.</p>
      <div class="cal-actions">
        <button class="btn" onClick={() => settingsStore.set({ inputLatencyMs: 0, outputLatencyMs: 0 })}>Reset to 0</button>
      </div>
    </div>
  );
}
