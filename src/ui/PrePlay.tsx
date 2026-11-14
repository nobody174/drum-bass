import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { remapToKit } from "../chart/remap";
import type { Difficulty } from "../chart/types";
import { kitStore, type KitPreset } from "../kit";
import { songStore, type StoredSong } from "../storage/songs";
import {
  COUNT_INS, DIFFICULTIES, MIXES, defaultDifficulty, defaultMix, mixAvailability, playHref, remapLine, loadApproach, loadDisplayMode, saveApproach, saveDisplayMode, type PlayParams,
} from "./play/params";
import { MAX_APPROACH_SEC, MIN_APPROACH_SEC } from "../render/kitGeometry";
import "../styles/play.css";

export default function PrePlay({ songId }: { songId: string }) {
  const [song, setSong] = useState<StoredSong | null>(null);
  const [preset, setPreset] = useState<KitPreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<PlayParams | null>(null);
  const [offset, setOffset] = useState(0);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const timer = useRef(0);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, p] = await Promise.all([songStore.getSong(songId), kitStore.ensureDefault()]);
        if (!alive) return;
        if (!s) {
          setError("This song is not in your library any more.");
          return;
        }
        const present = DIFFICULTIES.filter((d) => (s.notesByDifficulty[d]?.length ?? 0) > 0);
        const roles = s.audio.map((a) => a.role);
        setSong(s);
        setPreset(p);
        setOffset(s.offsetMs);
        setParams({ difficulty: defaultDifficulty(present), mix: defaultMix(roles), countIn: 4, display: loadDisplayMode(), approach: loadApproach() });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
      if (pending.current !== null) void songStore.setOffset(songId, pending.current).catch(() => {});
    };
  }, [songId]);

  const present = useMemo<Difficulty[]>(
    () => (song ? DIFFICULTIES.filter((d) => (song.notesByDifficulty[d]?.length ?? 0) > 0) : []),
    [song],
  );
  const avail = useMemo(() => mixAvailability(song?.audio.map((a) => a.role) ?? []), [song]);
  const remap = useMemo(() => {
    if (!song || !preset || !params) return null;
    return remapToKit(song.notesByDifficulty[params.difficulty] ?? [], preset);
  }, [song, preset, params?.difficulty]);

  const saveOffset = (ms: number) => {
    setOffset(ms);
    pending.current = ms;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      pending.current = null;
      songStore.setOffset(songId, ms).then(() => setSaveErr(null), (e) => setSaveErr(e instanceof Error ? e.message : String(e)));
    }, 300);
  };

  if (error) {
    return (
      <div class="pp">
        <p class="pp-notice" role="alert">{error}</p>
        <a class="btn" href="#/library">Back to library</a>
      </div>
    );
  }
  if (!song || !params || !preset) return <p class="muted" style={{ padding: 12 }}>Loading...</p>;

  const set = (patch: Partial<PlayParams>) => {
    if (patch.display) saveDisplayMode(patch.display);
    if (patch.approach !== undefined) saveApproach(patch.approach);
    setParams({ ...params, ...patch });
  };
  const noteCount = remap?.notes.length ?? 0;

  return (
    <div class="pp">
      <div class="pp-head">
        <a class="btn" href="#/library" aria-label="Back to library">Back</a>
        <h1>{song.title}</h1>
        <button class="pedal pp-start" disabled={noteCount === 0} onClick={() => { location.hash = playHref(songId, params); }}>
          Start
        </button>
      </div>
      <p class="pp-sub">{song.artist || "Unknown artist"} - kit: <b>{preset.name}</b> - {noteCount} notes</p>

      <div class="pp-grid">
        <section class="panel pp-field">
          <span class="lbl">Difficulty</span>
          <div class="seg" role="group" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button key={d} disabled={!present.includes(d)} aria-pressed={params.difficulty === d} onClick={() => set({ difficulty: d })}>{d}</button>
            ))}
          </div>
          <span class="lbl">Audio</span>
          <div class="seg" role="group" aria-label="Audio mix">
            {MIXES.map((m) => (
              <button key={m.id} disabled={!avail[m.id]} aria-pressed={params.mix === m.id} onClick={() => set({ mix: m.id })}>{m.label}</button>
            ))}
          </div>
          <span class="lbl">Display</span>
          <div class="seg" role="group" aria-label="Display mode">
            <button aria-pressed={params.display === "lanes"} onClick={() => set({ display: "lanes" })}>Lanes</button>
            <button aria-pressed={params.display === "kit"} onClick={() => set({ display: "kit" })}>Kit view</button>
          </div>
          <span class="lbl">Count-in beats</span>
          <div class="seg" role="group" aria-label="Count-in beats">
            {COUNT_INS.map((c) => (
              <button key={c} aria-pressed={params.countIn === c} onClick={() => set({ countIn: c })}>{c === 0 ? "None" : c}</button>
            ))}
          </div>
        </section>

        <section class="panel pp-field">
          <label for="pp-offset">Audio offset (ms)</label>
          <div class="pp-range">
            <input id="pp-offset" type="range" min={-300} max={300} step={5} value={offset}
              onInput={(e) => saveOffset(Number((e.target as HTMLInputElement).value))} />
            <output>{offset > 0 ? "+" : ""}{offset} ms</output>
          </div>
          {params.display === "kit" && (
            <>
              <label for="pp-approach">Kit view: ring approach time</label>
              <div class="pp-range">
                <input id="pp-approach" type="range" min={MIN_APPROACH_SEC} max={MAX_APPROACH_SEC} step={0.1} value={params.approach}
                  onInput={(e) => set({ approach: Number((e.target as HTMLInputElement).value) })} />
                <output>{params.approach.toFixed(1)} s</output>
              </div>
            </>
          )}
          <p class="pp-note">If the chart feels early or late against the music, nudge this. Saved per song.</p>
          {saveErr && <p class="pp-notice" role="alert">Could not save offset: {saveErr}</p>}
          {remap && remap.remapped.length > 0 && (
            <div class="pp-notice" role="status">
              Kit remap:
              <ul>{remap.remapped.map((r, i) => <li key={i}>{remapLine(r)}</li>)}</ul>
            </div>
          )}
          {remap && remap.remapped.length === 0 && <p class="pp-note">Every chart piece exists on your kit.</p>}
        </section>
      </div>

      {song.missingAudio && song.missingAudio.length > 0 && (
        <p class="pp-notice" role="alert">
          Missing audio in storage: {song.missingAudio.join(", ")}. {song.audio.length ? "The song will play without those stems." : "Re-import the song to restore its audio."}
        </p>
      )}
      {song.audio.length === 0 && <p class="pp-notice">No audio is stored for this song: you will play to a metronome click that follows the chart's tempo.</p>}
      {params.mix === "clickonly" && song.audio.length > 0 && (
        <p class="pp-note">Click only: no music, just a metronome that follows the chart's tempo (accent on beat 1).</p>
      )}
      <p class="pp-note">On the next screen, tap once more to unlock audio (browsers require a tap).</p>
    </div>
  );
}
