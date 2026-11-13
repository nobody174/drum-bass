import { useEffect, useRef, useState } from "preact/hooks";
import { inputBus } from "../midi/inputBus";
import { guessDrumName } from "../midi/gmNames";
import { useWebMidi } from "../midi/useWebMidi";
import { DEMO_PATTERN, playMock } from "../midi/mockInput";
import { KEYBOARD_MAP, startVirtualKeyboard, stopVirtualKeyboard } from "../midi/virtualKeyboard";
import "./midiMonitor.css";

const MAX_LOG = 50;

interface LogRow {
  id: number;
  kind: "note" | "cc";
  t: number;
  source: string;
  channel: number;
  /** note number, or controller number for cc */
  num: number;
  /** velocity, or cc value */
  val: number;
}

interface NoteStat {
  count: number;
  maxVel: number;
  lastVel: number;
  channels: Set<number>;
}

const STATUS_TEXT: Record<string, string> = {
  unsupported: "Web MIDI is not supported in this browser (use Chrome on Android or desktop).",
  idle: "Not connected. Tap Connect MIDI to ask for permission.",
  requesting: "Waiting for permission...",
  denied: "Permission denied. Allow MIDI access in the browser site settings, then try again.",
  ready: "Connected.",
  error: "Error while opening MIDI.",
};

function fmtTime(ms: number): string {
  return (ms / 1000).toFixed(3);
}

export default function MidiMonitor() {
  const midi = useWebMidi();
  const rowsRef = useRef<LogRow[]>([]);
  const statsRef = useRef<Map<number, NoteStat>>(new Map());
  const seqRef = useRef(0);
  const rafRef = useRef(0);
  const cancelDemoRef = useRef<(() => void) | null>(null);
  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const schedule = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setTick((n) => n + 1);
      });
    };
    const push = (row: LogRow) => {
      const rows = rowsRef.current;
      rows.unshift(row);
      if (rows.length > MAX_LOG) rows.length = MAX_LOG;
      schedule();
    };
    const offNote = inputBus.subscribe((e) => {
      if (pausedRef.current) return;
      const stats = statsRef.current;
      let s = stats.get(e.note);
      if (!s) {
        s = { count: 0, maxVel: 0, lastVel: 0, channels: new Set() };
        stats.set(e.note, s);
      }
      s.count++;
      s.lastVel = e.velocity;
      if (e.velocity > s.maxVel) s.maxVel = e.velocity;
      s.channels.add(e.channel);
      push({
        id: ++seqRef.current,
        kind: "note",
        t: e.timeStamp,
        source: e.source,
        channel: e.channel,
        num: e.note,
        val: e.velocity,
      });
    });
    const offCc = inputBus.subscribeCc((e) => {
      if (pausedRef.current) return;
      push({
        id: ++seqRef.current,
        kind: "cc",
        t: e.timeStamp,
        source: "midi",
        channel: e.channel,
        num: e.controller,
        val: e.value,
      });
    });
    startVirtualKeyboard();
    return () => {
      offNote();
      offCc();
      stopVirtualKeyboard();
      cancelDemoRef.current?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  const clear = () => {
    rowsRef.current = [];
    statsRef.current = new Map();
    setTick((n) => n + 1);
  };

  const demo = () => {
    cancelDemoRef.current?.();
    cancelDemoRef.current = playMock(DEMO_PATTERN);
  };

  const buildText = (): string => {
    const lines: string[] = [];
    lines.push(`# MIDI monitor log (${new Date().toISOString()})`);
    lines.push(`# status=${midi.status} input=${midi.inputs.find((i) => i.id === midi.selectedId)?.name ?? "none"}`);
    lines.push("# seen notes: note name count maxVel channels");
    const notes = [...statsRef.current.entries()].sort((a, b) => a[0] - b[0]);
    for (const [n, s] of notes) {
      lines.push(`note ${n} ${guessDrumName(n)} x${s.count} maxVel=${s.maxVel} ch=${[...s.channels].join(",")}`);
    }
    lines.push("# recent events (newest first): time source ch kind num val");
    for (const r of rowsRef.current) {
      lines.push(`${fmtTime(r.t)} ${r.source} ch${r.channel} ${r.kind} ${r.num} ${r.val}`);
    }
    return lines.join("\n");
  };

  const copy = async () => {
    const text = buildText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Fallback for insecure contexts or denied clipboard permission.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        setCopied(document.execCommand("copy"));
      } finally {
        ta.remove();
      }
    }
    setTimeout(() => setCopied(false), 1800);
  };

  const rows = rowsRef.current;
  const notes = [...statsRef.current.entries()].sort((a, b) => a[0] - b[0]);
  const canConnect = midi.status === "idle" || midi.status === "denied" || midi.status === "error" || midi.status === "ready";

  return (
    <section class="mm">
      <header class="mm-head">
        <div class={`mm-status mm-status-${midi.status}`} role="status">
          <span class="mm-dot" aria-hidden="true" />
          <span>{STATUS_TEXT[midi.status]}</span>
          {midi.error ? <span class="mm-err"> {midi.error}</span> : null}
        </div>
        <div class="mm-actions">
          <button class="mm-btn mm-primary" disabled={!canConnect} onClick={() => void midi.connect()}>
            {midi.status === "ready" ? "Rescan MIDI" : "Connect MIDI"}
          </button>
          <button class="mm-btn" onClick={demo}>Demo pattern</button>
          <button class="mm-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button class="mm-btn" onClick={clear}>Clear</button>
          <button class="mm-btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy log"}</button>
        </div>
      </header>

      <div class="mm-grid">
        <div class="mm-col">
          <h3>Input devices</h3>
          {midi.inputs.length === 0 ? (
            <p class="mm-muted">No MIDI inputs found. Connect the kit by USB-OTG, then tap Rescan.</p>
          ) : (
            <ul class="mm-devices">
              {midi.inputs.map((d) => (
                <li key={d.id}>
                  <label class={`mm-device${d.id === midi.selectedId ? " sel" : ""}`}>
                    <input
                      type="radio"
                      name="mm-input"
                      checked={d.id === midi.selectedId}
                      onChange={() => midi.select(d.id)}
                    />
                    <span class="mm-dname">
                      {d.name}
                      <small>
                        {d.manufacturer ? `${d.manufacturer} - ` : ""}
                        {d.state}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <h3>Seen notes</h3>
          {notes.length === 0 ? (
            <p class="mm-muted">Hit each pad once. Every distinct note shows up here.</p>
          ) : (
            <div class="mm-tablewrap">
              <table class="mm-table">
                <thead>
                  <tr>
                    <th>Note</th>
                    <th>Guess</th>
                    <th>Count</th>
                    <th>Max vel</th>
                    <th>Ch</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map(([n, s]) => (
                    <tr key={n}>
                      <td class="mm-num">{n}</td>
                      <td>{guessDrumName(n)}</td>
                      <td class="mm-num">{s.count}</td>
                      <td class="mm-num">{s.maxVel}</td>
                      <td class="mm-num">{[...s.channels].map((c) => c + 1).join(",")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>Keyboard hints</h3>
          <p class="mm-keys">
            {KEYBOARD_MAP.map((k) => (
              <span class="mm-key" key={k.code} title={k.name}>
                <kbd>{k.label}</kbd> {k.name}
              </span>
            ))}
          </p>
        </div>

        <div class="mm-col">
          <h3>
            Live log <small class="mm-muted">last {MAX_LOG}, newest first</small>
          </h3>
          <div class="mm-log" role="log" aria-live="off">
            {rows.length === 0 ? <p class="mm-muted">Waiting for events...</p> : null}
            {rows.map((r) => (
              <div class={`mm-row mm-${r.kind}`} key={r.id}>
                <span class="mm-t">{fmtTime(r.t)}</span>
                <span class={`mm-src mm-src-${r.source}`}>{r.source}</span>
                <span class="mm-ch">ch{r.channel + 1}</span>
                {r.kind === "note" ? (
                  <>
                    <span class="mm-n">{r.num}</span>
                    <span class="mm-name">{guessDrumName(r.num)}</span>
                  </>
                ) : (
                  <>
                    <span class="mm-n">CC{r.num}</span>
                    <span class="mm-name">{r.num === 4 ? "hi-hat foot" : "controller"}</span>
                  </>
                )}
                <span class="mm-v">{r.val}</span>
                <span class="mm-bar" aria-hidden="true">
                  <i style={{ width: `${(r.val / 127) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
