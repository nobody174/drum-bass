import type { KitPiece } from "../kit/types";
import { countInBeatNumber } from "../game/timeline";

/**
 * Canvas 2D falling-lanes renderer. It contains NO game logic: it is fed song time,
 * a read-only view of note times/lanes/states, and judgement events.
 */

export interface LaneNotes {
  /** Note times in seconds, sorted. */
  times: Float64Array;
  /** Lane index per note. */
  laneOf: Uint8Array;
  /** 0 pending, 1 hit, 2 missed (mutated by the judge, read here). */
  state: Uint8Array;
}

export type FlashKind = "perfect" | "good" | "ok" | "miss" | "stray";

export interface LanesOptions {
  lanes: readonly KitPiece[];
  notes: LaneNotes;
  /** Total song length in seconds for the progress bar (defaults to last note + 2s). */
  durationSec?: number;
  /** Seconds of look-ahead (note travel time from top to hit line). */
  lookaheadSec?: number;
  reducedMotion?: boolean;
  /** Count-in shown as beat numbers (beats..1); without it the count-in shows nothing. */
  countIn?: { beats: number; beatSec: number };
}

export interface LanesRenderer {
  /** Starts the single RAF loop. `getTime` returns the current song time in seconds. */
  start(getTime: () => number): void;
  stop(): void;
  judgement(lane: number, kind: FlashKind, deltaMs?: number): void;
  setCombo(combo: number): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

const MAX_SPARKS = 48;
const SHORT: Record<string, string> = {
  kick: "KICK", snare: "SNARE", hihat: "HAT", tom1: "T1", tom2: "T2", tom3: "T3", tom4: "T4",
  crash1: "CR1", crash2: "CR2", crash3: "CR3", ride: "RIDE", splash: "SPL", china: "CHN",
};
const KIND_COLOR: Record<FlashKind, string> = {
  perfect: "#ffe066", good: "#7dd87d", ok: "#6ab0ff", miss: "#ff4d4d", stray: "#8d8b94",
};
const KIND_TEXT: Record<FlashKind, string> = {
  perfect: "PERFECT", good: "GOOD", ok: "OK", miss: "MISS", stray: "",
};

export function createLanesRenderer(canvas: HTMLCanvasElement, opts: LanesOptions): LanesRenderer {
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const lanes = opts.lanes;
  const nLanes = lanes.length;
  const { times, laneOf, state } = opts.notes;
  const lookahead = opts.lookaheadSec ?? 1.6;
  const reduced = opts.reducedMotion ?? false;
  const duration = opts.durationSec ?? (times.length ? times[times.length - 1]! + 2 : 1);

  // Preallocated, reused every frame.
  const flash = new Float32Array(nLanes); // 0..1 decay
  const flashColor: string[] = new Array(nLanes).fill("#fff");
  const laneColor = lanes.map((l) => l.color);
  const laneLabel = lanes.map((l) => SHORT[l.id] ?? l.id.toUpperCase());
  const sx = new Float32Array(MAX_SPARKS);
  const sy = new Float32Array(MAX_SPARKS);
  const svx = new Float32Array(MAX_SPARKS);
  const svy = new Float32Array(MAX_SPARKS);
  const slife = new Float32Array(MAX_SPARKS);
  const scol: string[] = new Array(MAX_SPARKS).fill("#fff");
  let sparkCursor = 0;

  let w = 0;
  let h = 0;
  let dpr = 1;
  let laneW = 0;
  let x0 = 0;
  let hitY = 0;
  let pxPerSec = 0;
  let combo = 0;
  let paused = false;
  let judgeText = "";
  let judgeColor = "#fff";
  let judgeAge = 9;
  let comboPulse = 0;
  let raf = 0;
  let getTime: (() => number) | null = null;
  let last = 0;
  let destroyed = false;

  function layout(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    laneW = Math.min(150, w / Math.max(1, nLanes));
    x0 = (w - laneW * nLanes) / 2;
    hitY = h - Math.max(26, h * 0.1);
    pxPerSec = hitY / lookahead;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  function spark(x: number, y: number, color: string): void {
    if (reduced) return;
    for (let i = 0; i < 4; i++) {
      const k = sparkCursor++ % MAX_SPARKS;
      sx[k] = x;
      sy[k] = y;
      const a = -Math.PI * (0.1 + 0.8 * Math.random());
      const sp = 60 + Math.random() * 140;
      svx[k] = Math.cos(a) * sp;
      svy[k] = Math.sin(a) * sp;
      slife[k] = 1;
      scol[k] = color;
    }
  }

  function drawNote(kind: string, cx: number, cy: number, laneWidth: number): void {
    if (kind === "pedal") {
      const bw = laneWidth * 0.86;
      ctx.fillRect(cx - bw / 2, cy - 6, bw, 12);
    } else if (kind === "cymbal") {
      const r = Math.min(laneWidth * 0.36, 22);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
    } else {
      const r = Math.min(laneWidth * 0.32, 19);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now: number): void {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const t = getTime ? getTime() : 0;

    // Background
    ctx.fillStyle = "#0d0d0f";
    ctx.fillRect(0, 0, w, h);

    // Lanes
    for (let i = 0; i < nLanes; i++) {
      const lx = x0 + i * laneW;
      ctx.fillStyle = i % 2 ? "#141417" : "#101013";
      ctx.fillRect(lx, 0, laneW, h);
      const f = flash[i]!;
      if (f > 0.01) {
        ctx.globalAlpha = f * 0.45;
        ctx.fillStyle = flashColor[i]!;
        ctx.fillRect(lx, hitY - 90, laneW, 90 + (h - hitY));
        ctx.globalAlpha = 1;
        flash[i] = Math.max(0, f - dt * 3.5);
      }
    }
    ctx.strokeStyle = "#2a2a30";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= nLanes; i++) {
      const lx = Math.round(x0 + i * laneW) + 0.5;
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, h);
    }
    ctx.stroke();

    // Hit line
    ctx.fillStyle = "#e5232b";
    ctx.fillRect(x0, hitY - 2, laneW * nLanes, 4);
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x0, hitY - 14, laneW * nLanes, 12);
    ctx.globalAlpha = 1;

    // Visible notes only: binary search the first note whose tail is still on screen.
    const tailSec = (h - hitY + 20) / pxPerSec;
    let lo = 0;
    let hi = times.length;
    const from = t - tailSec;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    const until = t + lookahead + 0.1;
    for (let i = lo; i < times.length; i++) {
      const nt = times[i]!;
      if (nt > until) break;
      const st = state[i]!;
      if (st === 1) continue; // hit: gone
      const li = laneOf[i]!;
      const lane = lanes[li]!;
      const cy = hitY - (nt - t) * pxPerSec;
      const cx = x0 + li * laneW + laneW / 2;
      if (st === 2) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#777";
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = laneColor[li]!;
      }
      drawNote(lane.kind, cx, cy, laneW);
      if (st === 0 && lane.kind !== "pedal") {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Lane labels under the hit line
    ctx.font = `700 ${Math.max(10, Math.min(14, laneW * 0.16))}px Oswald, sans-serif`;
    for (let i = 0; i < nLanes; i++) {
      ctx.fillStyle = laneColor[i]!;
      ctx.fillText(laneLabel[i]!, x0 + i * laneW + laneW / 2, hitY + (h - hitY) / 2 + 2);
    }

    // Sparks
    for (let k = 0; k < MAX_SPARKS; k++) {
      const life = slife[k]!;
      if (life <= 0) continue;
      sx[k] = sx[k]! + svx[k]! * dt;
      sy[k] = sy[k]! + svy[k]! * dt;
      svy[k] = svy[k]! + 320 * dt;
      slife[k] = life - dt * 2.2;
      ctx.globalAlpha = Math.max(0, life);
      ctx.fillStyle = scol[k]!;
      ctx.fillRect(sx[k]! - 1.5, sy[k]! - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // Judgement text and combo
    if (judgeAge < 0.7 && judgeText) {
      const a = 1 - judgeAge / 0.7;
      ctx.globalAlpha = a;
      ctx.fillStyle = judgeColor;
      ctx.font = `700 ${Math.round(Math.min(34, h * 0.09))}px "Bebas Neue", Oswald, sans-serif`;
      ctx.fillText(judgeText, w / 2, hitY - Math.min(90, h * 0.3) - (reduced ? 0 : judgeAge * 18));
      ctx.globalAlpha = 1;
    }
    judgeAge += dt;
    if (combo >= 2) {
      const s = 1 + comboPulse * 0.25;
      ctx.fillStyle = "#ffb830";
      ctx.font = `700 ${Math.round(Math.min(44, h * 0.12) * s)}px "Bebas Neue", Oswald, sans-serif`;
      ctx.fillText(`${combo}`, w / 2, h * 0.2);
      ctx.fillStyle = "#8d8b94";
      ctx.font = `700 11px Oswald, sans-serif`;
      ctx.fillText("COMBO", w / 2, h * 0.2 + Math.min(30, h * 0.08));
    }
    comboPulse = Math.max(0, comboPulse - dt * 5);

    // Count-in
    if (t < 0) {
      ctx.fillStyle = "#f1efe9";
      ctx.font = `700 ${Math.round(Math.min(72, h * 0.22))}px "Bebas Neue", Oswald, sans-serif`;
      ctx.globalAlpha = 0.85;
      if (opts.countIn) ctx.fillText(String(countInBeatNumber(t, opts.countIn.beats, opts.countIn.beatSec)), w / 2, h * 0.42);
      ctx.globalAlpha = 1;
    }
    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(0, 0, w, h);
    }

    // Progress bar (top edge)
    const prog = Math.max(0, Math.min(1, t / duration));
    ctx.fillStyle = "#24242a";
    ctx.fillRect(0, 0, w, 4);
    ctx.fillStyle = "#ff7a1a";
    ctx.fillRect(0, 0, w * prog, 4);
  }

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layout()) : null;
  ro?.observe(canvas);
  layout();

  return {
    start(fn) {
      getTime = fn;
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
    judgement(lane, kind) {
      if (lane < 0 || lane >= nLanes) return;
      flash[lane] = 1;
      flashColor[lane] = KIND_COLOR[kind];
      const cx = x0 + lane * laneW + laneW / 2;
      if (kind === "perfect" || kind === "good") spark(cx, hitY, laneColor[lane]!);
      if (kind !== "stray") {
        judgeText = KIND_TEXT[kind];
        judgeColor = KIND_COLOR[kind];
        judgeAge = 0;
      }
    },
    setCombo(c) {
      if (c > combo && !reduced) comboPulse = 1;
      if (c > 0 && c % 25 === 0) spark(w / 2, h * 0.2, "#ffb830");
      combo = c;
    },
    setPaused(p) {
      paused = p;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      getTime = null;
    },
  };
}
