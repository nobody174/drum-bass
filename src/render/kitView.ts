import type { KitPiece } from "../kit/types";
import { countInBeatNumber } from "../game/timeline";
import type { FlashKind, LaneNotes } from "./lanes";
import {
  DEFAULT_APPROACH_SEC, DEFAULT_RINGS_PER_PIECE, RING_GRACE_SEC, clampApproach, createRingSelection, fitStage, litAmount,
  pieceGeo, rankAlpha, ringAlpha, ringFraction, ringRadius, ringTravel, selectRings, windowEnd, windowStart, type PieceGeo,
} from "./kitGeometry";

/**
 * Canvas 2D "kit view" renderer (SPEC 6.2): the user's own kit preset with shrinking approach
 * rings. It contains NO game logic: it is fed song time, a read-only view of note times / lanes /
 * states and judgement events, exactly like the lanes renderer (src/render/lanes.ts).
 */

export interface KitViewOptions {
  /** Every piece of the saved preset (all are drawn; pieces without notes are dimmed). */
  pieces: readonly KitPiece[];
  /** Pieces that appear in the song; the lane index of a note refers to this array. */
  lanes: readonly KitPiece[];
  notes: LaneNotes;
  durationSec?: number;
  /** Seconds a ring is visible before its note (0.8..2.5, default 1.5). */
  approachSec?: number;
  /** Nearest pending rings drawn per piece in dense passages. */
  maxRingsPerPiece?: number;
  reducedMotion?: boolean;
  countIn?: { beats: number; beatSec: number };
}

/** Same surface as LanesRenderer so Play can swap them live. */
export interface PlayRenderer {
  start(getTime: () => number): void;
  stop(): void;
  judgement(lane: number, kind: FlashKind, deltaMs?: number): void;
  setCombo(combo: number): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

const SHORT: Record<string, string> = {
  kick: "KICK", snare: "SNR", hihat: "HAT", tom1: "T1", tom2: "T2", tom3: "T3", tom4: "T4",
  crash1: "C1", crash2: "C2", crash3: "C3", ride: "RIDE", splash: "SPL", china: "CHN",
};
const KINDS: FlashKind[] = ["perfect", "good", "ok", "miss", "stray"];
const KIND_COLOR = ["#ffe066", "#7dd87d", "#6ab0ff", "#ff4d4d", "#8d8b94"];
const KIND_TEXT = ["PERFECT", "GOOD", "OK", "MISS", ""];
const FLASH_SEC = 0.32;
const TEXT_SEC = 0.75;

function shade(hex: string, amt: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function resolveColor(c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  if (!m) return c;
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim() || "#888888";
  } catch {
    return "#888888";
  }
}

function ellipsePath(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  c.beginPath();
  c.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
}

function roundRectPath(c: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number): void {
  const x = cx - hw;
  const y = cy - hh;
  const w = hw * 2;
  const h = hh * 2;
  const r = Math.min(w, h) * 0.2;
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function shapePath(c: CanvasRenderingContext2D, pedal: boolean, cx: number, cy: number, rx: number, ry: number): void {
  if (pedal) roundRectPath(c, cx, cy, rx, ry);
  else ellipsePath(c, cx, cy, rx, ry);
}

/** Static piece art (same look as the kit editor stage); drawn once per layout into an offscreen layer. */
function paintPiece(c: CanvasRenderingContext2D, p: KitPiece, g: PieceGeo, color: string, dim: boolean): void {
  c.save();
  c.globalAlpha = dim ? 0.38 : 1;
  const { cx, cy, rx, ry } = g;
  const body = c.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, Math.min(rx, ry) * 0.1, cx, cy, Math.max(rx, ry));
  body.addColorStop(0, shade(color, 0.25));
  body.addColorStop(1, shade(color, -0.45));
  c.fillStyle = body;
  if (p.kind === "pedal") {
    roundRectPath(c, cx, cy, rx, ry);
    c.fill();
    c.strokeStyle = shade(color, 0.5);
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
    c.moveTo(cx - rx * 0.36, cy + ry * 0.13);
    c.lineTo(cx, cy - ry * 0.13);
    c.lineTo(cx + rx * 0.36, cy + ry * 0.13);
    c.stroke();
  } else if (p.id === "hihat") {
    for (const dy of [ry * 0.35, -ry * 0.2]) {
      c.fillStyle = body;
      ellipsePath(c, cx, cy + dy, rx, ry);
      c.fill();
      c.strokeStyle = shade(color, 0.55);
      c.lineWidth = 2;
      c.stroke();
    }
  } else if (p.kind === "cymbal") {
    ellipsePath(c, cx, cy, rx, ry);
    c.fill();
    c.strokeStyle = shade(color, 0.55);
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = shade(color, -0.3);
    ellipsePath(c, cx, cy, rx * 0.16, ry * 0.2);
    c.fill();
  } else {
    ellipsePath(c, cx, cy, rx, ry);
    c.fill();
    c.strokeStyle = "#d8d6d0";
    c.lineWidth = Math.max(3, rx * 0.09);
    c.stroke();
    c.strokeStyle = shade(color, 0.35);
    c.lineWidth = 1.5;
    ellipsePath(c, cx, cy, rx * 0.72, ry * 0.72);
    c.stroke();
  }
  // Label
  const small = rx * 2 < 64;
  const text = SHORT[p.id] ?? p.id.toUpperCase();
  c.font = `700 ${Math.max(9, Math.min(15, rx * 0.4))}px Oswald, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineWidth = 3;
  c.strokeStyle = "rgba(0,0,0,.75)";
  c.fillStyle = "#fff";
  const ly = cy + (p.id === "hihat" ? ry * 0.35 : 0);
  void small;
  c.strokeText(text, cx, ly);
  c.fillText(text, cx, ly);
  c.restore();
}

export function createKitViewRenderer(canvas: HTMLCanvasElement, opts: KitViewOptions): PlayRenderer {
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const { lanes, pieces } = opts;
  const nLanes = lanes.length;
  const { times, laneOf, state } = opts.notes;
  const approach = clampApproach(opts.approachSec ?? DEFAULT_APPROACH_SEC);
  const maxPer = Math.max(1, opts.maxRingsPerPiece ?? DEFAULT_RINGS_PER_PIECE);
  const reduced = opts.reducedMotion ?? false;
  const duration = opts.durationSec ?? (times.length ? times[times.length - 1]! + 2 : 1);

  const laneColor = lanes.map((l) => resolveColor(l.color));
  const lanePedal = lanes.map((l) => l.kind === "pedal");
  const laneGeo: PieceGeo[] = lanes.map(() => ({ cx: 0, cy: 0, rx: 1, ry: 1 }));
  const laneTravel = new Float32Array(nLanes);
  const lit = new Float32Array(nLanes);
  const flash = new Float32Array(nLanes);
  const flashKind = new Uint8Array(nLanes);
  const textAge = new Float32Array(nLanes).fill(9);
  const textKind = new Uint8Array(nLanes);
  const sel = createRingSelection(nLanes, maxPer);
  const layer = document.createElement("canvas");
  const lctx = layer.getContext("2d")!;

  let w = 0;
  let h = 0;
  let dpr = 1;
  let combo = 0;
  let comboPulse = 0;
  let paused = false;
  let raf = 0;
  let getTime: (() => number) | null = null;
  let last = 0;
  let destroyed = false;
  let stage = { x: 0, y: 0, w: 1, h: 1 };

  function layout(): void {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    layer.width = canvas.width;
    layer.height = canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    stage = fitStage(w, h);
    for (let i = 0; i < nLanes; i++) {
      laneGeo[i] = pieceGeo(lanes[i]!, stage);
      laneTravel[i] = ringTravel(laneGeo[i]!.rx);
    }
    paintStatic();
  }

  /** Floor + all pieces (dimmed when the song never uses them). Built once per layout, blitted per frame. */
  function paintStatic(): void {
    const c = lctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#0d0d0f";
    c.fillRect(0, 0, w, h);
    const bg = c.createRadialGradient(w / 2, stage.y + stage.h * 0.55, stage.h * 0.1, w / 2, stage.y + stage.h * 0.55, Math.max(w, stage.w) * 0.6);
    bg.addColorStop(0, "#24242a");
    bg.addColorStop(1, "#0d0d0f");
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const used = new Set(lanes.map((l) => l.id));
    // Unused pieces first so used ones draw on top.
    for (const pass of [false, true]) {
      for (const p of pieces) {
        if (used.has(p.id) !== pass) continue;
        paintPiece(c, p, pieceGeo(p, stage), resolveColor(p.color), !pass);
      }
    }
  }

  function frame(now: number): void {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const t = getTime ? getTime() : 0;

    ctx.globalAlpha = 1;
    ctx.drawImage(layer, 0, 0, w, h);

    // Active window: binary search, then nearest-N per piece.
    const from = windowStart(times, t);
    const to = windowEnd(times, t, approach);
    selectRings(laneOf, state, from, to, maxPer, sel);
    lit.fill(0);

    ctx.lineCap = "round";
    for (let s = 0; s < sel.count; s++) {
      const i = sel.idx[s]!;
      const li = laneOf[i]!;
      const g = laneGeo[li]!;
      const nt = times[i]!;
      if (state[i] === 2) {
        const a = 1 - (t - nt) / RING_GRACE_SEC;
        if (a <= 0) continue;
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = "#8d8b94";
        ctx.lineWidth = 2;
        shapePath(ctx, lanePedal[li]!, g.cx, g.cy, g.rx, g.ry);
        ctx.stroke();
        continue;
      }
      const rank = sel.rank[s]!;
      const frac = ringFraction(t, nt, approach);
      const k = ringRadius(t, nt, approach, g.rx, laneTravel[li]!) / g.rx;
      if (rank === 0) {
        const l = litAmount(t, nt);
        if (l > lit[li]!) lit[li] = l;
      }
      ctx.globalAlpha = ringAlpha(frac) * rankAlpha(rank);
      ctx.strokeStyle = laneColor[li]!;
      ctx.lineWidth = 2.5 + 3.5 * (1 - frac) * (rank === 0 ? 1 : 0.6);
      shapePath(ctx, lanePedal[li]!, g.cx, g.cy, g.rx * k, g.ry * k);
      ctx.stroke();
      if (frac < 0.06 && rank === 0) {
        // Crossing the edge: crisp white line so the hit moment is obvious.
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Lit pieces and hit flashes (shape fills, no gradients).
    for (let li = 0; li < nLanes; li++) {
      const g = laneGeo[li]!;
      const l = lit[li]!;
      const f = flash[li]!;
      if (l > 0.01) {
        ctx.globalAlpha = l * 0.4;
        ctx.fillStyle = laneColor[li]!;
        shapePath(ctx, lanePedal[li]!, g.cx, g.cy, g.rx, g.ry);
        ctx.fill();
        ctx.globalAlpha = 0.35 + 0.65 * l;
        ctx.strokeStyle = laneColor[li]!;
        ctx.lineWidth = 3 + 4 * l;
        ctx.stroke();
      }
      if (f > 0.01) {
        const col = KIND_COLOR[flashKind[li]!]!;
        ctx.globalAlpha = f * 0.55;
        ctx.fillStyle = col;
        shapePath(ctx, lanePedal[li]!, g.cx, g.cy, g.rx, g.ry);
        ctx.fill();
        if (!reduced) {
          const grow = 1 + (1 - f) * 0.45;
          ctx.globalAlpha = f * 0.8;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3;
          shapePath(ctx, lanePedal[li]!, g.cx, g.cy, g.rx * grow, g.ry * grow);
          ctx.stroke();
        }
        flash[li] = Math.max(0, f - dt / FLASH_SEC);
      }
    }
    ctx.globalAlpha = 1;

    // Judgement text near each piece.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(Math.max(14, Math.min(26, stage.h * 0.075)))}px "Bebas Neue", Oswald, sans-serif`;
    for (let li = 0; li < nLanes; li++) {
      const age = textAge[li]!;
      if (age >= TEXT_SEC) continue;
      const g = laneGeo[li]!;
      const txt = KIND_TEXT[textKind[li]!]!;
      if (txt) {
        const y = Math.max(stage.y + 12, g.cy - g.ry - 12 - (reduced ? 0 : age * 22));
        ctx.globalAlpha = 1 - age / TEXT_SEC;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,.8)";
        ctx.strokeText(txt, g.cx, y);
        ctx.fillStyle = KIND_COLOR[textKind[li]!]!;
        ctx.fillText(txt, g.cx, y);
      }
      textAge[li] = age + dt;
    }
    ctx.globalAlpha = 1;

    // Combo (top left, clear of the stage on wide screens)
    if (combo >= 2) {
      const s = 1 + comboPulse * 0.25;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffb830";
      ctx.font = `700 ${Math.round(Math.min(40, h * 0.11) * s)}px "Bebas Neue", Oswald, sans-serif`;
      ctx.fillText(`${combo}`, 12, 30);
      ctx.fillStyle = "#8d8b94";
      ctx.font = "700 11px Oswald, sans-serif";
      ctx.fillText("COMBO", 12, 30 + Math.min(26, h * 0.075));
      ctx.textAlign = "center";
    }
    comboPulse = Math.max(0, comboPulse - dt * 5);

    if (t < 0 && opts.countIn) {
      ctx.fillStyle = "#f1efe9";
      ctx.font = `700 ${Math.round(Math.min(72, h * 0.22))}px "Bebas Neue", Oswald, sans-serif`;
      ctx.globalAlpha = 0.85;
      ctx.fillText(String(countInBeatNumber(t, opts.countIn.beats, opts.countIn.beatSec)), w / 2, stage.y + stage.h * 0.45);
      ctx.globalAlpha = 1;
    }
    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(0, 0, w, h);
    }

    const prog = Math.max(0, Math.min(1, t / duration));
    ctx.fillStyle = "#24242a";
    ctx.fillRect(0, 0, w, 4);
    ctx.fillStyle = "#ff7a1a";
    ctx.fillRect(0, 0, w * prog, 4);
  }

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => layout()) : null;
  ro?.observe(canvas);
  layout();
  // Web fonts load lazily: repaint the labels once they are available.
  void document.fonts?.ready.then(() => {
    if (!destroyed) layout();
  });

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
      const k = KINDS.indexOf(kind);
      flash[lane] = 1;
      flashKind[lane] = k;
      if (kind !== "stray") {
        textKind[lane] = k;
        textAge[lane] = 0;
      }
    },
    setCombo(c) {
      if (c > combo && !reduced) comboPulse = 1;
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
