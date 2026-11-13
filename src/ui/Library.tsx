import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { importSongFiles } from "../chart/importSong";
import { displayBest, requestPersistentStorageOnce, songStore, type SongSummary } from "../storage/songs";
import "../styles/theme.css";
import "../styles/play.css";
import "../styles/library.css";

const DEMO_DIR = `${import.meta.env.BASE_URL}demo/demo-rock/`;
/** Optional manifest (["song.ini","notes.mid",...]); otherwise these common names are probed. */
const DEMO_GUESSES = ["song.ini", "notes.mid", "notes.chart", "song.ogg", "song.opus", "song.mp3", "drums.ogg", "drums.opus", "drums.mp3", "guitar.ogg", "bass.ogg", "rhythm.ogg", "vocals.ogg"];

/** True when the response is a real file (the dev server answers unknown paths with index.html). */
async function fetchAsset(name: string): Promise<File | null> {
  try {
    const r = await fetch(DEMO_DIR + name);
    if (!r.ok) return null;
    if ((r.headers.get("content-type") ?? "").includes("text/html")) return null;
    return new File([await r.blob()], name);
  } catch {
    return null;
  }
}

async function loadDemoFiles(): Promise<File[]> {
  let names = DEMO_GUESSES;
  try {
    const r = await fetch(DEMO_DIR + "files.json");
    if (r.ok && !(r.headers.get("content-type") ?? "").includes("text/html")) {
      const j = (await r.json()) as unknown;
      if (Array.isArray(j) && j.every((x) => typeof x === "string")) names = j as string[];
    }
  } catch { /* use guesses */ }
  const out = (await Promise.all(names.map(fetchAsset))).filter((f): f is File => !!f);
  return out;
}

async function demoExists(): Promise<boolean> {
  try {
    const r = await fetch(DEMO_DIR + "song.ini", { method: "GET" });
    return r.ok && !(r.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

/** Best of the highest difficulty played, e.g. "12,345 (expert)". Scores of different difficulties are not comparable. */
const bestLabel = (s: SongSummary) => {
  const b = displayBest(s);
  return b ? `${b.score.toLocaleString("en-US")}${b.difficulty ? ` (${b.difficulty})` : ""}` : null;
};

export default function Library() {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await songStore.listSongs();
      if (!alive.current) return;
      setSongs([...list].sort((a, b) => b.addedAt - a.addedAt));
      setLoadErr(null);
    } catch (e) {
      if (alive.current) setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    void demoExists().then((ok) => { if (alive.current) setDemo(ok); });
    return () => { alive.current = false; };
  }, [refresh]);

  const doImport = useCallback(async (files: File[]) => {
    if (!files.length || busy) return;
    setError(null);
    setWarnings([]);
    setInfo(null);
    try {
      setBusy(`Reading ${files.length} file${files.length === 1 ? "" : "s"}...`);
      const imported = await importSongFiles(files);
      if (!alive.current) return;
      setBusy("Saving to your library...");
      let replace = false;
      const dup = await songStore.findDuplicate(imported.meta.title, imported.meta.artist);
      if (dup) {
        replace = window.confirm(`"${dup.title}" is already in your library. Replace it?`);
        if (!replace) {
          setInfo("Import cancelled.");
          return;
        }
      }
      const saved = await songStore.saveImported(imported, { replaceDuplicate: replace });
      void requestPersistentStorageOnce(); // once per session, after a successful save; silent if unsupported
      setInfo(`Imported "${saved.title}"${saved.artist ? ` by ${saved.artist}` : ""}.`);
      setWarnings(imported.warnings);
      await refresh();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }, [busy, refresh]);

  const onPick = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ""; // allow picking the same selection again
    void doImport(files);
  };

  const importDemo = async () => {
    setBusy("Loading demo song...");
    const files = await loadDemoFiles();
    setBusy(null);
    if (!files.length) {
      setDemo(false);
      return;
    }
    await doImport(files);
  };

  const del = async (id: string) => {
    try {
      await songStore.deleteSong(id);
      setConfirmId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div class="lib">
      <div class="lib-head">
        <h1>Library</h1>
        <div class="lib-actions">
          <label class="btn accent" style={{ display: "inline-flex", alignItems: "center" }} aria-disabled={!!busy}>
            Import folder
            <input
              class="lib-hidden" type="file" multiple disabled={!!busy} onChange={onPick}
              ref={(el) => { el?.setAttribute("webkitdirectory", ""); }}
            />
          </label>
          <label class="btn accent" style={{ display: "inline-flex", alignItems: "center" }} aria-disabled={!!busy}>
            Import files / zip
            <input
              class="lib-hidden" type="file" multiple disabled={!!busy} onChange={onPick}
              accept=".zip,.mid,.midi,.chart,.ini,.ogg,.opus,.mp3,.wav,.m4a,audio/*"
            />
          </label>
          {demo && <button class="btn" disabled={!!busy} onClick={() => void importDemo()}>Import demo song</button>}
        </div>
      </div>

      {busy && <p class="lib-status" role="status">{busy}</p>}
      {error && <p class="lib-status err" role="alert">{error}</p>}
      {info && <p class="lib-status" role="status">{info}</p>}
      {warnings.length > 0 && (
        <div class="lib-status" role="status">
          Import warnings:
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {loadErr && (
        <p class="lib-status err" role="alert">
          Could not read the library: {loadErr} <button class="btn" onClick={() => void refresh()}>Retry</button>
        </p>
      )}

      {songs && songs.length === 0 && !loadErr && (
        <section class="panel lib-empty">
          <h2>No songs yet</h2>
          <p>Import a Clone Hero song folder (or its .zip), or a General MIDI drum file. Everything stays on this device.</p>
        </section>
      )}

      <div class="lib-list">
        {(songs ?? []).map((s) => (
          <section class="panel lib-song" key={s.id}>
            <button class="lib-main" onClick={() => { location.hash = `#/song/${encodeURIComponent(s.id)}`; }} aria-label={`Open ${s.title}`}>
              <span class="lib-title">{s.title}</span>
              <span class="lib-artist">{s.artist || "Unknown artist"}</span>
              <span class="lib-meta">
                {s.difficulties.map((d) => <span class="lib-chip" key={d}>{d}</span>)}
                {bestLabel(s) && <span class="lib-best">Best {bestLabel(s)}</span>}
              </span>
            </button>
            {confirmId === s.id ? (
              <>
                <button class="btn danger" onClick={() => void del(s.id)}>Delete</button>
                <button class="btn" onClick={() => setConfirmId(null)}>Keep</button>
              </>
            ) : (
              <button class="btn" aria-label={`Delete ${s.title}`} onClick={() => setConfirmId(s.id)}>Del</button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
