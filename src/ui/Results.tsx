import { useEffect, useState } from "preact/hooks";
import type { KitPiece } from "../kit/types";
import type { JudgeSummary } from "../game/judge";
import type { Difficulty } from "../chart/types";
import { songStore } from "../storage/songs";
import { pieceName } from "./play/params";
import "../styles/play.css";

interface Props {
  summary: JudgeSummary;
  songId: string;
  /** Previous best for THIS difficulty. */
  prevBest: number;
  difficulty: Difficulty;
  /** False for click-only practice: nothing is recorded. */
  ranked: boolean;
  lanes: readonly KitPiece[];
  onRetry: () => void;
  onBack: () => void;
}

const tendency = (ms: number) => (Math.abs(ms) < 8 ? "on time" : ms < 0 ? `${Math.round(-ms)} ms early` : `${Math.round(ms)} ms late`);

export default function Results({ summary: s, songId, prevBest, difficulty, ranked, lanes, onRetry, onBack }: Props) {
  const [saved, setSaved] = useState<"new" | "none" | "error">("none");

  useEffect(() => {
    if (!ranked || s.score <= prevBest) return;
    let alive = true;
    songStore.setBestScore(songId, s.score, difficulty).then(
      () => { if (alive) setSaved("new"); },
      () => { if (alive) setSaved("error"); },
    );
    return () => { alive = false; };
  }, [s.score, prevBest, songId, difficulty, ranked]);

  const maxBin = Math.max(1, ...s.histogram.bins);
  const color = (id: string) => lanes.find((l) => l.id === id)?.color ?? "#ff7a1a";
  const half = s.histogram.bins.length / 2;

  return (
    <div class="rs">
      <section class="panel">
        <div class="rs-grade">
          <div class="rs-letter" aria-label={`Grade ${s.grade}`}>{s.grade}</div>
          <div>
            <div class="rs-acc">{s.accuracy.toFixed(1)}%</div>
            <div>Score {s.score.toLocaleString("en-US")} - Max combo {s.maxCombo}</div>
            {saved === "new" && <div class="rs-new">New best!</div>}
            {saved === "error" && <div class="rs-new" role="alert">Could not save best score</div>}
            {saved === "none" && prevBest > 0 && <div class="pp-note">Best on {difficulty} {prevBest.toLocaleString("en-US")}</div>}
            {!ranked && <div class="pp-note">Click-only practice: score not recorded.</div>}
          </div>
        </div>
        <div class="rs-counts">
          <div><b style={{ color: "#ffe066" }}>{s.perfect}</b><span>Perfect</span></div>
          <div><b style={{ color: "#7dd87d" }}>{s.good}</b><span>Good</span></div>
          <div><b style={{ color: "#6ab0ff" }}>{s.ok}</b><span>OK</span></div>
          <div><b style={{ color: "#ff4d4d" }}>{s.miss}</b><span>Miss</span></div>
        </div>
        <p class="pp-note" style={{ marginTop: 8 }}>
          {s.stray} stray hit{s.stray === 1 ? "" : "s"} (not penalised). Overall you play {tendency(s.meanDeltaMs)}.
        </p>
      </section>

      <section class="panel">
        <h3>Timing (early to late)</h3>
        <div class="rs-hist" role="img" aria-label="Timing histogram">
          {s.histogram.bins.map((b, i) => (
            <i key={i} class={i === half - 1 || i === half ? "mid" : ""} style={{ height: `${(b / maxBin) * 100}%` }} title={`${b}`} />
          ))}
        </div>
        <div class="rs-axis"><span>{s.histogram.min} ms</span><span>0</span><span>+{s.histogram.max} ms</span></div>
        <h3 style={{ marginTop: 10 }}>Per piece</h3>
        {s.perPiece.map((p) => (
          <div class="rs-piece" key={p.piece}>
            <span>{pieceName(p.piece)}</span>
            <span class="rs-bar"><i style={{ width: `${p.accuracy}%`, background: color(p.piece) }} /></span>
            <span>{Math.round(p.accuracy)}%</span>
            <span class="muted">{tendency(p.meanDeltaMs)}</span>
          </div>
        ))}
      </section>

      <div class="rs-actions">
        <button class="btn accent" onClick={onRetry}>Retry</button>
        <button class="btn" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
