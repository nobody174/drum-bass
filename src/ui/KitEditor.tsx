import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  PIECE_LIMITS, PIECE_ORDER, addPiece, canAdd, canRemove, clearNote, countGroup, createDefaultPreset, duplicatePreset,
  findConflicts, kitStore, matchNote, movePiece, nextKitName, pieceGroup, removePiece, renamePreset, resizePiece,
  setLocked, setMirrored, setNote, uniqueName,
} from "../kit";
import type { KitPreset, NoteMatch, PieceId } from "../kit";
import { inputBus, startVirtualKeyboard, stopVirtualKeyboard } from "../midi";
import type { DrumInputEvent } from "../midi";
import { Stage, GRID_STEP } from "./kit/Stage";
import { VirtualPads } from "./kit/VirtualPads";
import { FlashStore } from "./kit/flash";
import { PIECE_NAMES, zonesFor } from "./kit/zones";
import "./kitEditor.css";

const SAVE_DEBOUNCE_MS = 400;
const LEARN_TIMEOUT_S = 10;

type SaveState = "idle" | "pending" | "saved" | "error";
interface LastNote { ev: DrumInputEvent; match: NoteMatch | null; learning: boolean }
interface LearnTarget { id: PieceId; zone: string }

const label = (id: PieceId, zone?: string) => PIECE_NAMES[id] + (zone && zone !== "head" ? ` ${zone}` : zone === "head" && id === "snare" ? " head" : "");

export default function KitEditor() {
  const [preset, setPreset] = useState<KitPreset | null>(null);
  const [list, setList] = useState<KitPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<PieceId | null>(null);
  const [snap, setSnap] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [last, setLast] = useState<LastNote | null>(null);
  const [learn, setLearn] = useState<LearnTarget | null>(null);
  const [learnLeft, setLearnLeft] = useState(LEARN_TIMEOUT_S);
  const [learnMsg, setLearnMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busyUi, setBusyUi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const presetRef = useRef<KitPreset | null>(null);
  const dirty = useRef(false);
  const timer = useRef(0);
  const alive = useRef(true);
  const busy = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const noSave = useRef(false);
  const learnRef = useRef<LearnTarget | null>(null);
  const nameDraftRef = useRef("");
  const flashes = useMemo(() => new FlashStore(), []);

  const refreshList = useCallback(async () => {
    const l = await kitStore.listPresets();
    if (alive.current) setList(l);
  }, []);

  /** Saves pending edits. Resolves true when nothing is left unsaved, false when the save failed. */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    while (saving.current) await saving.current; // serialize with an in-flight save
    const p = presetRef.current;
    if (noSave.current || !dirty.current || !p) return !dirty.current || noSave.current;
    dirty.current = false;
    let ok = true;
    const run = (async () => {
      try {
        await kitStore.savePreset(p);
      } catch {
        ok = false;
        dirty.current = true; // keep the edit pending; next activity or Retry saves it again
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
    if (alive.current) {
      if (ok) { setSave(dirty.current ? "pending" : "saved"); void refreshList(); }
      else setSave("error");
    }
    return ok;
  }, [refreshList]);

  /** Apply a pure model function to the current preset and schedule an autosave. */
  const commit = useCallback((fn: (p: KitPreset) => KitPreset) => {
    const cur = presetRef.current;
    if (!cur || busy.current) return; // a preset switch is in flight; edits would be lost
    const next = fn(cur);
    if (next === cur) return;
    presetRef.current = next;
    setPreset(next);
    dirty.current = true;
    setSave("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = await kitStore.ensureDefault();
      if (!alive.current) return;
      presetRef.current = p;
      setPreset(p);
      await refreshList();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [refreshList]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      void flush(); // best-effort final save
      window.clearTimeout(timer.current);
    };
  }, [load, flush]);

  // Flush pending edits when the page is hidden or going away (mobile browsers may never run unmount).
  useEffect(() => {
    const onHide = () => { commitNameRef.current(); void flush(); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  // Keyboard keys (see Pads screen) also work here, for Learn and the flash test.
  useEffect(() => {
    startVirtualKeyboard();
    return () => stopVirtualKeyboard();
  }, []);

  // Monitor + test flash for every input event, from any source.
  useEffect(() => {
    return inputBus.subscribe((ev) => {
      const p = presetRef.current;
      if (learnRef.current) { // this hit is being captured by Learn: do not show/flash the old mapping
        setLast({ ev, match: null, learning: true });
        return;
      }
      const match = p ? matchNote(p, ev.note) : null;
      setLast({ ev, match, learning: false });
      if (match) flashes.trigger(match.piece, ev.velocity);
    });
  }, [flashes]);

  // MIDI learn: the next event from any source stores its note.
  useEffect(() => {
    if (!learn) return;
    setLearnLeft(LEARN_TIMEOUT_S);
    let done = false;
    let off = () => {};
    off = inputBus.subscribe((ev) => {
      if (done) return; // a second event in the same frame must not overwrite the first
      done = true;
      off();
      commit((p) => setNote(p, learn.id, learn.zone, ev.note));
      setLearnMsg(`Saved note ${ev.note} to ${label(learn.id, learn.zone)}.`);
      setLearn(null);
    });
    const started = performance.now();
    const iv = window.setInterval(() => {
      const left = Math.max(0, LEARN_TIMEOUT_S - Math.floor((performance.now() - started) / 1000));
      setLearnLeft(left);
      if (left <= 0) { setLearn(null); setLearnMsg("Learn timed out. Nothing changed."); }
    }, 250);
    return () => { off(); window.clearInterval(iv); };
  }, [learn, commit]);

  learnRef.current = learn;
  const selected = preset?.pieces.find((p) => p.id === selectedId) ?? null;
  // Drop learn / selection if the piece disappeared.
  useEffect(() => {
    if (!preset) return;
    if (selectedId && !selected) setSelectedId(null);
    if (learn && !preset.pieces.some((p) => p.id === learn.id)) setLearn(null);
  }, [preset, selectedId, selected, learn]);

  useEffect(() => { setNameDraft(preset?.name ?? ""); nameDraftRef.current = preset?.name ?? ""; }, [preset?.id, preset?.name]);
  const commitName = () => {
    const v = nameDraftRef.current.trim();
    if (!presetRef.current) return;
    if (!v) { setNameDraft(presetRef.current.name); nameDraftRef.current = presetRef.current.name; return; }
    commit((p) => renamePreset(p, v));
  };
  const commitNameRef = useRef(commitName);
  commitNameRef.current = commitName;

  /** Runs one preset-changing operation at a time; flushes the name draft first. */
  const exclusive = async (fn: () => Promise<void>) => {
    if (busy.current) return;
    commitName();
    busy.current = true; setBusyUi(true); setNotice(null);
    try { await fn(); }
    catch (e) { setNotice(`Action failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { busy.current = false; if (alive.current) setBusyUi(false); }
  };

  const resetSelection = () => { setSelectedId(null); setLearn(null); setConfirmDel(false); };

  const switchPreset = (id: string) => exclusive(async () => {
    if (!presetRef.current || id === presetRef.current.id) return;
    if (!(await flush())) { setNotice("Could not save your changes, so the kit was not switched. Retry the save first."); return; }
    const p = await kitStore.getPreset(id);
    if (!p || !alive.current) return;
    await kitStore.setActiveId(id);
    presetRef.current = p;
    setPreset(p); resetSelection(); setSave("idle");
  });

  const adopt = (make: (names: string[]) => KitPreset) => exclusive(async () => {
    const cur = presetRef.current;
    if (!cur) return;
    if (!(await flush())) { setNotice("Could not save your changes, so no new kit was created. Retry the save first."); return; }
    const names = list.map((x) => (x.id === cur.id ? cur.name : x.name));
    const p = make(names);
    await kitStore.savePreset(p);
    await kitStore.setActiveId(p.id);
    presetRef.current = p;
    dirty.current = false;
    setPreset(p); resetSelection(); setSave("saved");
    await refreshList();
  });

  const newPreset = () => void adopt((names) => ({ ...createDefaultPreset(), name: nextKitName(names) }));
  const duplicate = () => void adopt((names) => duplicatePreset(presetRef.current!, uniqueName(`${presetRef.current!.name} copy`, names)));

  const remove = () => exclusive(async () => {
    const cur = presetRef.current;
    if (!cur) return;
    // Hold off autosave while deleting so the preset is not re-created; edits stay pending if the delete fails.
    window.clearTimeout(timer.current);
    noSave.current = true;
    try {
      while (saving.current) await saving.current;
      const ok = await kitStore.deletePreset(cur.id);
      if (!ok) { setConfirmDel(false); return; }
      dirty.current = false;
      const rest = await kitStore.listPresets();
      if (!alive.current) return;
      setList(rest);
      const next = rest[0]!;
      presetRef.current = next; setPreset(next); resetSelection(); setSave("idle");
      await kitStore.setActiveId(next.id);
    } catch (e) {
      if (dirty.current) { setSave("pending"); timer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS); }
      throw e;
    } finally {
      noSave.current = false;
    }
  });

  if (error) {
    return (
      <div class="ke-state panel" role="alert">
        <h2>Kit editor</h2>
        <p>Could not load kit presets: {error}</p>
        <button class="pedal" onClick={() => void load()}>Retry</button>
      </div>
    );
  }
  if (!preset) {
    return <div class="ke-state panel" aria-busy="true"><h2>Kit editor</h2><p>Loading presets...</p></div>;
  }

  const locked = preset.locked;
  const conflicts = findConflicts(preset);

  return (
    <div class="ke">
      <div class="ke-left">
        <Stage
          pieces={preset.pieces}
          locked={locked}
          mirrored={preset.mirrored}
          snap={snap}
          selectedId={selectedId}
          flashes={flashes}
          onSelect={(id) => { setSelectedId(id); if (learn && id !== learn.id) setLearn(null); }}
          onMove={(id, x, y) => commit((p) => movePiece(p, id, x, y, snap ? { snap: GRID_STEP } : undefined))}
          onResize={(id, s) => commit((p) => resizePiece(p, id, s))}
        />
        <div class="ke-toolbar" role="toolbar" aria-label="Stage tools">
          <button class={`ke-btn${locked ? " on" : ""}`} aria-pressed={locked} onClick={() => commit((p) => setLocked(p, !p.locked))}>
            {locked ? "Locked" : "Unlocked"}
          </button>
          <button class={`ke-btn${preset.mirrored ? " on" : ""}`} aria-pressed={preset.mirrored} onClick={() => commit((p) => setMirrored(p, !p.mirrored))}>
            Left-handed view
          </button>
          <button class={`ke-btn${snap ? " on" : ""}`} aria-pressed={snap} disabled={locked} onClick={() => setSnap(!snap)}>
            Snap
          </button>
          <span class={`ke-saved ${save}`} role="status" aria-live="polite">
            {save === "pending" ? "Saving..." : save === "saved" ? "Saved" : save === "error" ? "Save failed" : ""}
          </span>
          {save === "error" && <button class="ke-btn" onClick={() => void flush()}>Retry save</button>}
        </div>
        {notice && <div class="ke-notice" role="alert">{notice}</div>}
        <div class="ke-hint">
          {locked ? "Locked: tap a piece to test-flash it. Unlock to move, resize, add or remove. Left-handed view and Learn still work." : "Drag to move. Pinch, drag the amber handle, or use the slider to resize."}
        </div>
      </div>

      <div class="ke-panel">
        <details open class="ke-sec">
          <summary>Monitor</summary>
          <div class="ke-monitor" role="status" aria-live="off">
            {last ? (
              <>
                <b>Note {last.ev.note}</b> vel {last.ev.velocity} ch {last.ev.channel + 1} ({last.ev.source}) {"→ "}
                {last.learning ? <span class="muted">captured by Learn</span> : last.match ? <span class="ok">{label(last.match.piece, last.match.zone)}</span> : <span class="warn">unmapped</span>}
              </>
            ) : <span class="muted">Hit a pad, key or on-screen pad...</span>}
          </div>
        </details>

        <details class="ke-sec">
          <summary>Virtual pads</summary>
          <p class="muted ke-small">Simulate hits without the kit: tests the monitor and the flash{learn ? ", or answers the Learn that is listening" : ""}.</p>
          {!learn && <VirtualPads />}
          {learn && <p class="muted ke-small">Use the pads in the Listening box below.</p>}
        </details>

        <details open class="ke-sec">
          <summary>Selected piece</summary>
          {!selected ? (
            <p class="muted">Tap a piece on the stage.</p>
          ) : (
            <div class="ke-sel">
              <h3>{PIECE_NAMES[selected.id]}</h3>
              <label class="ke-slider">
                <span>Size {Math.round(selected.size * 100)}%</span>
                <input
                  type="range" min="0.05" max="0.5" step="0.005" value={selected.size} disabled={locked}
                  onInput={(e) => commit((p) => resizePiece(p, selected.id, Number((e.target as HTMLInputElement).value)))}
                />
              </label>
              <p class="ke-warnbox">Note numbers are UNVERIFIED General MIDI starter values. Use Learn on the real kit to confirm.</p>
              {zonesFor(selected.id).map((zone) => {
                const note = selected.midiNotes[zone];
                const active = learn?.id === selected.id && learn.zone === zone;
                return (
                  <div class={`ke-zone${active ? " listening" : ""}`} key={zone}>
                    <div class="ke-zone-name">
                      <span>{zone}</span>
                      <b>{note === undefined ? "unset" : note}</b>
                    </div>
                    {active ? (
                      <>
                        <span class="ke-listen" role="status">Listening... {learnLeft}s</span>
                        <button class="ke-btn" onClick={() => { setLearn(null); setLearnMsg(null); }}>Cancel</button>
                        <div class="ke-learnbox">
                          <p>Hit the real kit, press a keyboard key, or tap a pad below. The first hit is saved.</p>
                          <p class="ke-vp-title">Tap a pad to simulate a hit</p>
                          <VirtualPads />
                        </div>
                      </>
                    ) : (
                      <>
                        <button class="ke-btn accent" onClick={() => { setLearnMsg(null); setLearn({ id: selected.id, zone }); }}>Learn</button>
                        <button class="ke-btn" disabled={note === undefined} onClick={() => commit((p) => clearNote(p, selected.id, zone))}>Clear</button>
                      </>
                    )}
                  </div>
                );
              })}
              {learnMsg && <p class="ke-learnmsg" role="status">{learnMsg}</p>}
              {conflicts.length > 0 && (
                <div class="ke-conflicts" role="alert">
                  {conflicts.map((c) => (
                    <p key={c.note}>Note {c.note} is used by {c.where.map((w) => label(w.piece, w.zone)).join(" and ")}.</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </details>

        <details open class="ke-sec">
          <summary>Pieces</summary>
          <div class="ke-pieces" role="group" aria-label="Select piece">
            {preset.pieces.map((p) => (
              <button
                key={p.id} class={`ke-chip${p.id === selectedId ? " has" : ""}`} aria-pressed={p.id === selectedId}
                aria-label={`Select ${PIECE_NAMES[p.id]}`}
                onClick={() => { setSelectedId(p.id); if (learn && p.id !== learn.id) setLearn(null); }}
              >
                {PIECE_NAMES[p.id]}
              </button>
            ))}
          </div>
          <p class="muted ke-small">Select a piece here or on the stage, then use Learn under Selected piece. Add or remove below.</p>
          <div class="ke-pieces" role="group" aria-label="Add or remove pieces">
            {PIECE_ORDER.map((id) => {
              const has = preset.pieces.some((p) => p.id === id);
              const g = pieceGroup(id);
              const lim = PIECE_LIMITS[g];
              const canToggle = !locked && (has ? canRemove(preset, id) : canAdd(preset, id));
              return (
                <button
                  key={id}
                  class={`ke-chip${has ? " has" : ""}`}
                  disabled={!canToggle}
                  aria-pressed={has}
                  title={`${g}: ${countGroup(preset, g)}/${lim?.max ?? "?"}`}
                  onClick={() => {
                    if (has) commit((p) => removePiece(p, id));
                    else { commit((p) => addPiece(p, id)); setSelectedId(id); }
                  }}
                >
                  <i style={{ background: `var(--c-${id.startsWith("tom") ? id : id.startsWith("crash") ? "crash" : id === "hihat" ? "hat" : id})` }} />
                  {PIECE_NAMES[id]}
                </button>
              );
            })}
          </div>
          <p class="muted ke-small">
            {locked ? "Unlock to add or remove pieces. " : ""}
            Toms {countGroup(preset, "tom")}/{PIECE_LIMITS.tom.max}, crashes {countGroup(preset, "crash")}/{PIECE_LIMITS.crash.max}. Kick and snare are required.
          </p>
        </details>

        <details open class="ke-sec">
          <summary>Presets</summary>
          <label class="ke-field">
            <span>Active kit</span>
            <select value={preset.id} disabled={busyUi} onChange={(e) => void switchPreset((e.target as HTMLSelectElement).value)}>
              {list.map((p) => <option key={p.id} value={p.id}>{p.id === preset.id ? preset.name : p.name}</option>)}
            </select>
          </label>
          <label class="ke-field">
            <span>Name</span>
            <input
              type="text" value={nameDraft} maxLength={40}
              onInput={(e) => { const v = (e.target as HTMLInputElement).value; nameDraftRef.current = v; setNameDraft(v); }}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
          </label>
          <div class="ke-row">
            <button class="ke-btn" disabled={busyUi} onClick={newPreset}>New</button>
            <button class="ke-btn" disabled={busyUi} onClick={duplicate}>Duplicate</button>
            {confirmDel ? (
              <>
                <button class="ke-btn danger" disabled={busyUi} onClick={() => void remove()}>Confirm delete</button>
                <button class="ke-btn" onClick={() => setConfirmDel(false)}>Keep</button>
              </>
            ) : (
              <button class="ke-btn" disabled={busyUi || list.length <= 1} onClick={() => setConfirmDel(true)}>Delete</button>
            )}
          </div>
          {list.length <= 1 && <p class="muted ke-small">The last preset cannot be deleted.</p>}
        </details>
      </div>
    </div>
  );
}
