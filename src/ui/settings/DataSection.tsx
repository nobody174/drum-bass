import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import "../../styles/data.css";
import {
  applyBackup, clearData, defaultBackupDeps, exportBackup, hasKits, hasLatency, hasSettings, hasSongs, inspectBackup, planExport, MAX_BACKUP_BYTES, WARN_BACKUP_BYTES,
  type ClearTarget, type ExportMode, type ExportPlan, type ImportMode, type ImportSummary, type PreparedBackup,
} from "../../storage/backup";
import { formatBytes, getStorageUsage, requestPersistentStorage, type StorageUsage } from "../../storage/usage";

const CONFIRM_WORD = "DELETE";

type Prog = { phase: string; done: number; total: number } | null;

function ProgressBar({ p }: { p: Prog }) {
  if (!p) return null;
  return (
    <div class="data-progress" role="status" aria-live="polite">
      <progress max={Math.max(1, p.total)} value={p.done} />
      <span>{p.phase}</span>
    </div>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const CLEAR_ITEMS: { target: ClearTarget; label: string; what: string }[] = [
  { target: "kits", label: "Clear kits", what: "all saved kits. A fresh default Nitro Max kit is created again." },
  { target: "songs", label: "Clear songs", what: "all songs, their charts, scores and audio." },
  { target: "settings", label: "Clear settings", what: "all settings, including latency calibration. They go back to defaults." },
  { target: "everything", label: "Clear everything", what: "all kits, songs and settings on this device." },
];

export default function DataSection() {
  const deps = useRef(defaultBackupDeps()).current;
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [persistMsg, setPersistMsg] = useState("");
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [busy, setBusy] = useState<"" | "export" | "import" | "clear">("");
  const [prog, setProg] = useState<Prog>(null);

  // export
  const [mode, setMode] = useState<ExportMode>("light");
  const [exp, setExp] = useState<{ url: string; filename: string; size: number; warnings: string[] } | null>(null);
  const [expErr, setExpErr] = useState("");

  // import
  const fileInput = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const [fileName, setFileName] = useState("");
  const [impMode, setImpMode] = useState<ImportMode>("add");
  const [withSettings, setWithSettings] = useState(false);
  const [withLatency, setWithLatency] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [impErr, setImpErr] = useState("");

  // clear
  const [pending, setPending] = useState<ClearTarget | null>(null);
  const [typed, setTyped] = useState("");
  const [clearMsg, setClearMsg] = useState("");
  const [clearErr, setClearErr] = useState("");

  const refresh = useCallback(async () => {
    setUsage(await getStorageUsage());
    try {
      setPlan(await planExport(deps));
    } catch {
      setPlan(null);
    }
  }, [deps]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The download URL is revoked when a new export replaces it, or 60 s after the screen goes away
  // (a slow download may still be reading it right after the user navigates).
  const urlRef = useRef<string | null>(null);
  useEffect(() => () => {
    const u = urlRef.current;
    if (u) setTimeout(() => URL.revokeObjectURL(u), 60_000);
  }, []);

  const onProgress = (p: Prog) => setProg(p);

  async function doExport() {
    setBusy("export");
    setExpErr("");
    setExp(null);
    setProg({ phase: "Preparing", done: 0, total: 1 });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    try {
      const r = await exportBackup(mode, deps, { onProgress });
      const url = URL.createObjectURL(r.blob);
      urlRef.current = url;
      setExp({ url, filename: r.filename, size: r.blob.size, warnings: r.warnings });
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setExpErr(msg(e));
    } finally {
      setBusy("");
      setProg(null);
    }
  }

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    setImpErr("");
    setSummary(null);
    setPrepared(null);
    setConfirmReplace(false);
    setFileName(f.name);
    setFileSize(f.size);
    setBusy("import");
    setProg({ phase: "Checking the file", done: 0, total: 1 });
    try {
      const p = await inspectBackup(f);
      setPrepared(p);
      setImpMode("add");
      setWithSettings(false);
      setWithLatency(false);
    } catch (err) {
      setImpErr(msg(err));
    } finally {
      setBusy("");
      setProg(null);
    }
  }

  async function doImport() {
    if (!prepared) return;
    setBusy("import");
    setImpErr("");
    setProg({ phase: "Importing", done: 0, total: 1 });
    try {
      const s = await applyBackup(prepared, { mode: impMode, applySettings: impMode === "replace" || withSettings, applyLatency: withLatency, onProgress }, deps);
      setSummary(s);
      if (s.error) setImpErr(s.error);
      setPrepared(null);
      setConfirmReplace(false);
    } catch (err) {
      setImpErr(msg(err));
    } finally {
      setBusy("");
      setProg(null);
      void refresh();
    }
  }

  async function doClear() {
    if (!pending || typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    const target = pending;
    setBusy("clear");
    setClearErr("");
    setClearMsg("");
    setProg({ phase: "Deleting", done: 0, total: 1 });
    try {
      const r = await clearData(target, deps, onProgress);
      const parts = [
        target === "kits" || target === "everything" ? `${r.kitsRemoved} kit${r.kitsRemoved === 1 ? "" : "s"}` : "",
        target === "songs" || target === "everything" ? `${r.songsRemoved} song${r.songsRemoved === 1 ? "" : "s"}` : "",
        r.settingsReset ? "settings reset" : "",
      ].filter(Boolean);
      setClearMsg(`Done: ${parts.join(", ")}.`);
      setPending(null);
      setTyped("");
    } catch (e) {
      setClearErr(msg(e));
    } finally {
      setBusy("");
      setProg(null);
      void refresh();
    }
  }

  async function askPersist() {
    const ok = await requestPersistentStorage();
    setPersistMsg(ok === null ? "This browser cannot do that." : ok ? "Storage is now persistent." : "The browser declined (installing the app helps).");
    setUsage(await getStorageUsage());
  }

  const disabled = busy !== "";
  const planLine = plan
    ? `${plan.kits} kit${plan.kits === 1 ? "" : "s"}, ${plan.songs} song${plan.songs === 1 ? "" : "s"} (${formatBytes(plan.audioBytes)} of audio)`
    : "";
  const limitMb = Math.round(MAX_BACKUP_BYTES / 1024 ** 2);
  const warnMb = Math.round(WARN_BACKUP_BYTES / 1024 ** 2);

  return (
    <div class="data-section">
      <p class="data-note" role="note">
        Your kits, songs and settings are stored <strong>only on this device</strong>. Nothing is uploaded. An export file is the only backup:
        clearing the browser data or uninstalling the app deletes everything.
      </p>
      {usage && (
        <div class="data-usage">
          <span>
            Storage used: <strong>{usage.usage !== null ? formatBytes(usage.usage) : "?"}</strong>
            {usage.quota !== null && <> of about {formatBytes(usage.quota)}</>}
            {usage.persisted !== null && <> · {usage.persisted ? "persistent" : "not persistent"}</>}
          </span>
          {usage.persisted === false && (
            <button type="button" class="data-btn" onClick={askPersist}>Request persistent storage</button>
          )}
          {persistMsg && <span class="data-muted" role="status">{persistMsg}</span>}
        </div>
      )}

      <div class="data-blocks">
        <section class="data-block" aria-labelledby="data-exp">
          <h3 id="data-exp">Export</h3>
          <div class="data-choices" role="radiogroup" aria-label="What to export">
            <label class="data-choice">
              <input type="radio" name="exp-mode" checked={mode === "light"} onChange={() => setMode("light")} disabled={disabled} />
              <span><strong>Kits and settings only</strong><small>Small file, quick. Songs are not included.</small></span>
            </label>
            <label class="data-choice">
              <input type="radio" name="exp-mode" checked={mode === "everything"} onChange={() => setMode("everything")} disabled={disabled} />
              <span>
                <strong>Everything incl. songs and audio</strong>
                <small>{planLine ? `${planLine}. ` : ""}Large file; needs free space and memory on a phone. Limit {limitMb} MB of audio.</small>
              </span>
            </label>
          </div>
          {mode === "everything" && plan?.tooLarge && (
            <p class="data-err" role="alert">Your audio is {formatBytes(plan.audioBytes)}, over the {limitMb} MB limit. Export kits and settings only, or delete some songs first.</p>
          )}
          {mode === "everything" && plan && !plan.tooLarge && plan.audioBytes >= WARN_BACKUP_BYTES && (
            <p class="data-warn" role="note">This backup will be large ({formatBytes(plan.audioBytes)}). Importing it later needs that much free memory, and phones with little memory may fail. Use "Kits and settings only" for routine backups.</p>
          )}
          <button type="button" class="pedal data-go" onClick={doExport} disabled={disabled || (mode === "everything" && !!plan?.tooLarge)}>
            {busy === "export" ? "Exporting..." : "Export zip"}
          </button>
          {busy === "export" && <ProgressBar p={prog} />}
          {expErr && <p class="data-err" role="alert">{expErr}</p>}
          {exp && (
            <div class="data-ok" role="status">
              <p>Created {exp.filename} ({formatBytes(exp.size)}). If the download did not start, <a href={exp.url} download={exp.filename}>tap here to save it</a>.</p>
              {exp.warnings.map((w, i) => <p key={i} class="data-warn">{w}</p>)}
            </div>
          )}
        </section>

        <section class="data-block" aria-labelledby="data-imp">
          <h3 id="data-imp">Import</h3>
          <p class="data-muted">Pick a backup zip made by this app. It is fully checked before anything is saved. Files over {limitMb} MB cannot be imported (the whole file must fit in memory); export "Kits and settings only" or split your songs instead.</p>
          <input ref={fileInput} type="file" accept=".zip,application/zip" class="data-file" onChange={onPick} disabled={disabled} aria-label="Backup zip file" />
          <button type="button" class="pedal data-go" onClick={() => fileInput.current?.click()} disabled={disabled}>
            {busy === "import" && !prepared ? "Working..." : "Choose backup file"}
          </button>
          {busy === "import" && <ProgressBar p={prog} />}
          {impErr && <p class="data-err" role="alert">{impErr}</p>}
          {prepared && (
            <div class="data-prep">
              <p>
                <strong>{fileName}</strong> contains: {hasKits(prepared) ? `${prepared.kits.length} kit${prepared.kits.length === 1 ? "" : "s"}` : "no kits"},{" "}
                {hasSongs(prepared) ? `${prepared.songs.length} song${prepared.songs.length === 1 ? "" : "s"} (${formatBytes(prepared.audioBytes)})` : "no songs"},{" "}
                {hasSettings(prepared) ? "settings" : "no settings"}.
              </p>
              {fileSize >= WARN_BACKUP_BYTES && (
                <p class="data-warn" role="note">This file is {formatBytes(fileSize)} (over {warnMb} MB). Importing it needs that much free memory; on a phone with little memory it may fail.</p>
              )}
              {prepared.warnings.slice(0, 6).map((w, i) => <p key={i} class="data-warn">{w}</p>)}
              <div class="data-choices" role="radiogroup" aria-label="How to import">
                <label class="data-choice">
                  <input type="radio" name="imp-mode" checked={impMode === "add"} onChange={() => { setImpMode("add"); setConfirmReplace(false); }} disabled={disabled} />
                  <span><strong>Add (keep existing)</strong><small>Nothing is overwritten. Clashes get a new name or id; items already here are skipped.</small></span>
                </label>
                <label class="data-choice">
                  <input type="radio" name="imp-mode" checked={impMode === "replace"} onChange={() => { setImpMode("replace"); setConfirmReplace(false); }} disabled={disabled} />
                  <span><strong>Replace</strong><small>Replaces what you have for the types in this file ({[hasKits(prepared) && "kits", hasSongs(prepared) && "songs", hasSettings(prepared) && "settings"].filter(Boolean).join(", ") || "nothing"}).</small></span>
                </label>
              </div>
              {impMode === "add" && hasSettings(prepared) && (
                <label class="data-choice">
                  <input type="checkbox" checked={withSettings} onChange={(e) => setWithSettings((e.currentTarget as HTMLInputElement).checked)} disabled={disabled} />
                  <span><strong>Also apply the settings in the file</strong><small>Overwrites your current settings (not latency calibration, see below).</small></span>
                </label>
              )}
              {hasSettings(prepared) && hasLatency(prepared) && (impMode === "replace" || withSettings) && (
                <label class="data-choice">
                  <input type="checkbox" checked={withLatency} onChange={(e) => setWithLatency((e.currentTarget as HTMLInputElement).checked)} disabled={disabled} />
                  <span><strong>Also restore latency calibration from this backup (device-specific)</strong><small>Off by default: calibration depends on the phone, headphones and drum kit, so keep yours unless this is the same setup.</small></span>
                </label>
              )}
              {impMode === "add" || confirmReplace ? (
                <div class="data-row">
                  {impMode === "replace" && <p class="data-err">This deletes your current {[hasKits(prepared) && "kits", hasSongs(prepared) && "songs", hasSettings(prepared) && "settings"].filter(Boolean).join(", ")} and uses the file's instead.</p>}
                  <button type="button" class={impMode === "replace" ? "data-btn data-danger" : "pedal data-go"} onClick={doImport} disabled={disabled}>
                    {impMode === "replace" ? "Yes, replace my data" : "Import"}
                  </button>
                  {impMode === "replace" && <button type="button" class="data-btn" onClick={() => setConfirmReplace(false)} disabled={disabled}>Cancel</button>}
                </div>
              ) : (
                <button type="button" class="data-btn data-danger" onClick={() => setConfirmReplace(true)} disabled={disabled}>Replace my data...</button>
              )}
            </div>
          )}
          {summary && (
            <div class="data-ok" role="status">
              <p>
                Import {summary.error ? "stopped" : "finished"}: {summary.kitsAdded} kit{summary.kitsAdded === 1 ? "" : "s"} added, {summary.songsAdded} song{summary.songsAdded === 1 ? "" : "s"} added
                {summary.kitsSkipped + summary.songsSkipped > 0 && `, ${summary.kitsSkipped + summary.songsSkipped} skipped (already here)`}
                {summary.kitsRemoved + summary.songsRemoved > 0 && `, ${summary.kitsRemoved + summary.songsRemoved} old removed`}
                {summary.settingsApplied ? ", settings applied" : ""}.
              </p>
              {summary.warnings.slice(0, 8).map((w, i) => <p key={i} class="data-warn">{w}</p>)}
              {summary.warnings.length > 8 && <p class="data-muted">and {summary.warnings.length - 8} more notes.</p>}
              <p class="data-muted">Reload the page if the kit or library screens do not show the new data.</p>
            </div>
          )}
        </section>

        <section class="data-block data-clear" aria-labelledby="data-clr">
          <h3 id="data-clr">Clear data</h3>
          <p class="data-muted">Permanent. Export a backup first if you might want it back.</p>
          <div class="data-clear-btns">
            {CLEAR_ITEMS.map((c) => (
              <button key={c.target} type="button" class="data-btn data-danger" disabled={disabled} aria-pressed={pending === c.target}
                onClick={() => { setPending(pending === c.target ? null : c.target); setTyped(""); setClearMsg(""); setClearErr(""); }}>
                {c.label}
              </button>
            ))}
          </div>
          {pending && (
            <div class="data-confirm" role="group" aria-label="Confirm delete">
              <p class="data-err">This permanently deletes {CLEAR_ITEMS.find((c) => c.target === pending)!.what}</p>
              <label class="data-type">
                <span>Type {CONFIRM_WORD} to confirm</span>
                <input type="text" value={typed} autocomplete="off" autocapitalize="characters" spellcheck={false}
                  onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} disabled={disabled} />
              </label>
              <div class="data-row">
                <button type="button" class="data-btn data-danger" onClick={doClear} disabled={disabled || typed.trim().toUpperCase() !== CONFIRM_WORD}>
                  {busy === "clear" ? "Deleting..." : "Delete now"}
                </button>
                <button type="button" class="data-btn" onClick={() => { setPending(null); setTyped(""); }} disabled={disabled}>Cancel</button>
              </div>
            </div>
          )}
          {busy === "clear" && <ProgressBar p={prog} />}
          {clearErr && <p class="data-err" role="alert">{clearErr}</p>}
          {clearMsg && <p class="data-ok" role="status">{clearMsg} Reload the page to refresh other screens.</p>}
        </section>
      </div>
    </div>
  );
}
