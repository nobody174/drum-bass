import { useEffect, useRef, useState } from "preact/hooks";
import type { KitPreset, PieceId } from "../../kit";
import { inputBus, useWebMidi } from "../../midi";
import { VirtualPads } from "./VirtualPads";
import { findConflicts } from "../../kit";
import {
  CONFIRM_MS, advanceAndReplay, back, buildReport, captureNote, conflictLines, createSession, currentStep, goTo,
  isListening, progress, redo, resolveDuplicate, skip, statusText, summaryRows,
} from "./learnPlan";
import type { CaptureResult, Cc4Info, LearnSession, NoteEffect } from "./learnPlan";

export interface LearnWizardProps {
  /** Preset at wizard start; the step list is built from it once. */
  preset: KitPreset;
  /** Apply note changes (setNote / clearNote) to the active preset; must work while the kit is locked. */
  onApply(effects: NoteEffect[]): void;
  /** Piece to highlight on the stage (null when the wizard closes or has no target). */
  onTarget(id: PieceId | null): void;
  /** Leave the wizard. `finished` is true after the summary's Finish button. */
  onExit(finished: boolean): void;
}

const show = (n: number | undefined) => (n === undefined ? "-" : String(n));

export function LearnWizard({ preset, onApply, onTarget, onExit }: LearnWizardProps) {
  const [session, setSessionState] = useState<LearnSession>(() => createSession(preset));
  const sessionRef = useRef(session);
  const [heard, setHeard] = useState<{ note: number; source: string } | null>(null);
  const [cc4, setCc4] = useState<Cc4Info>({ seen: false, count: 0, min: 127, max: 0 });
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const confirmTimer = useRef(0);
  /** Set when a single row is redone from the summary: finish that row, then return to the summary. */
  const fromSummary = useRef(false);
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const midi = useWebMidi();
  const device = midi.status === "ready" ? midi.inputs.find((i) => i.id === midi.selectedId && i.state === "connected")?.name ?? null : null;

  const setSession = (s: LearnSession) => { sessionRef.current = s; setSessionState(s); };
  const clearConfirm = () => { window.clearTimeout(confirmTimer.current); confirmTimer.current = 0; };
  const scheduleAdvance = () => {
    clearConfirm();
    confirmTimer.current = window.setTimeout(() => {
      confirmTimer.current = 0;
      const cur = sessionRef.current;
      if (cur.phase !== "confirm") return;
      if (fromSummary.current) { setSession({ ...cur, phase: "done", queued: null }); return; }
      // Replays the hit queued during the confirm window (if any) against the next step.
      handleResult(advanceAndReplay(cur, performance.now()));
    }, CONFIRM_MS);
  };
  const handleResult = (r: CaptureResult) => {
    if (r.kind === "ignored" && r.session === sessionRef.current) return;
    setSession(r.session);
    if (r.effects.length) applyRef.current(r.effects);
    if (r.kind === "captured") scheduleAdvance();
  };

  // One subscription for the wizard's lifetime: reads the latest session through a ref.
  useEffect(() => {
    const off = inputBus.subscribe((ev) => {
      setHeard({ note: ev.note, source: ev.source });
      const r = captureNote(sessionRef.current, ev.note, ev.timeStamp || performance.now());
      if (r.kind === "queued") { setSession(r.session); return; } // replayed when the confirm window ends
      if (r.kind === "ignored") return;
      handleResult(r);
    });
    const offCc = inputBus.subscribeCc((e) => {
      if (e.controller !== 4) return;
      setCc4((c) => ({ seen: true, count: c.count + 1, min: Math.min(c.min, e.value), max: Math.max(c.max, e.value) }));
    });
    return () => { off(); offCc(); clearConfirm(); };
  }, []);

  const step = currentStep(session);
  const targetPiece = session.phase === "done" ? null : step?.piece ?? null;
  useEffect(() => {
    onTarget(targetPiece);
    return () => onTarget(null);
  }, [targetPiece]);

  const prog = progress(session);
  const listening = isListening(session);

  const act = (fn: (s: LearnSession) => LearnSession) => { clearConfirm(); setCopied("idle"); setSession(fn(sessionRef.current)); };
  const nav = (fn: (s: LearnSession) => LearnSession) => { fromSummary.current = false; act(fn); };
  const redoRow = (i: number) => { fromSummary.current = true; act((s) => goTo(s, i)); };
  const skipStep = () => act((s) => {
    const k = skip(s);
    if (!fromSummary.current) return k;
    fromSummary.current = false;
    return { ...k, index: s.index, phase: "done" };
  });
  const pickDuplicate = (choice: "keep" | "replace") => {
    handleResult(resolveDuplicate(sessionRef.current, choice));
  };

  if (session.phase === "done") {
    const rows = summaryRows(session);
    const conflicts = findConflicts(preset);
    const meta = { presetName: preset.name, device, date: new Date(), cc4, conflicts };
    const copy = async () => {
      const text = buildReport(session, meta);
      try { await navigator.clipboard.writeText(text); setCopied("ok"); }
      catch { setCopied("fail"); }
    };
    const differs = rows.filter((r) => r.differs).length;
    return (
      <div class="kw" role="region" aria-label="Learn all pads: summary">
        <h2 class="kw-title">Summary</h2>
        <p class="kw-sub">
          {prog.learned} of {prog.total} learned, {prog.pending} pending, {prog.skipped} skipped, {differs} differ from the manual default.
          Notes are already saved to the kit; pending and skipped rows show what the kit holds now.
        </p>
        {conflicts.length > 0 && (
          <div class="kw-dup" role="alert">
            <p><b>Note conflicts remain.</b> Two zones on one note cannot be told apart. Redo one of them.</p>
            {conflictLines(conflicts).map((l) => <p key={l}>{l}</p>)}
          </div>
        )}
        <p class="kw-sub">
          {device ? <>Device: <b>{device}</b>. </> : "No MIDI device connected. "}
          {cc4.seen ? `CC4 seen (${cc4.count} messages, ${cc4.min}..${cc4.max}).` : "CC4 (hi-hat foot controller) not seen; it is not required."}
        </p>
        <div class="kw-tablewrap">
          <table class="kw-table">
            <thead><tr><th>Pad</th><th>Manual</th><th>Learned</th><th><span class="kw-sr">Redo</span></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} class={r.differs ? "differs" : ""}>
                  <td>{r.label}{r.optional && <small class="muted"> optional</small>}</td>
                  <td>{show(r.expected)}</td>
                  <td class={`kw-st ${r.status}`}>
                    {r.status === "learned" && r.learned !== undefined ? <b>{r.learned}</b> : statusText(r)}
                    {r.differs && <span class="kw-badge" title="Differs from the manual default">differs</span>}
                  </td>
                  <td><button class="ke-btn" aria-label={`Redo ${r.label}`} onClick={() => redoRow(i)}>Redo</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="ke-row kw-actions">
          <button class="ke-btn accent" onClick={() => void copy()}>Copy report</button>
          <button class="ke-btn" onClick={() => nav(back)}>Back</button>
          <button class="ke-btn on" onClick={() => onExit(true)}>Finish</button>
        </div>
        <p class="kw-sub" role="status" aria-live="polite">
          {copied === "ok" && "Report copied as Markdown. Paste it into docs/m3-kit-verification.md."}
          {copied === "fail" && "Clipboard blocked. Select the text below and copy it by hand."}
        </p>
        {copied === "fail" && <textarea class="kw-report" readOnly rows={8} value={buildReport(session, meta)} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />}
      </div>
    );
  }

  const dup = session.duplicate ? { label: session.duplicate.otherLabel } : null;
  return (
    <div class="kw" role="region" aria-label="Learn all pads">
      <div class="kw-head">
        <span class="kw-step">Step {prog.step} of {prog.total}</span>
        <span class="kw-count muted">{prog.learned} learned</span>
      </div>
      <div class="kw-bar" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.step - 1 + (step?.status === "learned" ? 1 : 0)}>
        <i style={{ width: `${(prog.learned / Math.max(1, prog.total)) * 100}%` }} />
      </div>

      <h2 class="kw-target">{step?.label}</h2>
      <p class="kw-sub">
        {step?.optional && <span class="kw-badge opt">optional, skip if unused</span>}{" "}
        {step?.expected !== undefined ? <>Manual default: note <b>{step.expected}</b></> : "No manual default for this one."}
      </p>

      <div class={`kw-state${listening ? " listening" : ""}${session.phase === "confirm" ? " ok" : ""}`} role="status" aria-live="polite">
        {session.phase === "confirm" && step && <>Saved note <b>{step.learned}</b> to {step.label}{step.expected !== undefined && step.learned !== step.expected ? " (differs from manual)" : ""}</>}
        {session.phase === "duplicate" && <>Note {session.duplicate?.note} is already used</>}
        {listening && <>Hit the pad now</>}
        {session.phase === "listening" && step && step.status === "learned" && <>Already learned: note <b>{step.learned}</b>. Redo to hit it again.</>}
        {session.phase === "listening" && step && step.status === "skipped" && <>Skipped. Redo to learn it.</>}
      </div>
      {step?.cleared && step.status === "pending" && (
        <p class="kw-sub kw-relearn" role="status">This pad's note was cleared when another pad took it. It needs to be learned again: hit it now.</p>
      )}

      {session.phase === "duplicate" && dup && session.duplicate && (
        <div class="kw-dup" role="alert">
          <p>Note <b>{session.duplicate.note}</b> is already assigned to <b>{dup.label}</b>. Two zones on one note cannot be told apart.
            Replace clears {dup.label}'s note and it must be learned again; Keep leaves it and drops this hit.</p>
          <div class="ke-row">
            <button class="ke-btn accent" onClick={() => pickDuplicate("keep")}>Keep {dup.label}</button>
            <button class="ke-btn danger" onClick={() => pickDuplicate("replace")}>Replace with {step?.label}</button>
          </div>
        </div>
      )}

      <p class="kw-heard muted" aria-live="off">
        {heard ? <>Last input: note {heard.note} ({heard.source})</> : "Waiting for input from the kit, a keyboard key or the pads below."}
        {cc4.seen && <> | CC4 {cc4.count} msgs</>}
      </p>

      <div class="ke-row kw-actions">
        <button class="ke-btn" disabled={session.index === 0} onClick={() => nav(back)}>Back</button>
        <button class="ke-btn" onClick={() => act(redo)}>Redo</button>
        <button class="ke-btn accent" onClick={skipStep}>Skip</button>
        <button class="ke-btn" onClick={() => onExit(false)}>Cancel</button>
      </div>
      <p class="kw-sub muted">Each hit is saved at once, also while the kit is locked. Cancel keeps what is already saved.</p>

      <details open class="kw-pads">
        <summary>Virtual pads</summary>
        <VirtualPads />
      </details>
    </div>
  );
}
