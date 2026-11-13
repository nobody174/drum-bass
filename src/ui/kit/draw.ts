import type { KitPiece } from "../../kit";
import { isCymbal, PIECE_NAMES, PIECE_SHORT } from "./zones";

export const FLASH_MS = 380;
const CYMBAL_FLAT = 0.55;

export interface Geo { cx: number; cy: number; rx: number; ry: number }

/** Pixel geometry of a piece on a stage of W x H css px. Mirroring is already baked into piece.x by the model. */
export function geo(p: KitPiece, W: number, H: number): Geo {
  const r = (p.size * H) / 2;
  return {
    cx: p.x * W,
    cy: p.y * H,
    rx: r,
    ry: isCymbal(p.id) ? r * CYMBAL_FLAT : r,
  };
}

/** Top-most piece under the point (later pieces draw on top). Small pieces get a minimum touch radius. */
export function hitTest(pieces: KitPiece[], px: number, py: number, W: number, H: number): KitPiece | null {
  const MIN = 22;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const g = geo(pieces[i], W, H);
    const rx = Math.max(g.rx, MIN), ry = Math.max(g.ry, MIN * 0.75);
    const dx = (px - g.cx) / rx, dy = (py - g.cy) / ry;
    if (dx * dx + dy * dy <= 1) return pieces[i];
  }
  return null;
}

export interface DrawOpts {
  W: number; H: number; dpr: number;
  pieces: KitPiece[];
  mirrored: boolean;
  locked: boolean;
  selectedId: string | null;
  snap: boolean;
  gridStep: number;
  flashes: Map<string, { t: number; vel: number }>;
  now: number;
  reduceMotion: boolean;
  css: (name: string, fallback: string) => string;
}

function shade(hex: string, amt: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Resolve "var(--x)" style colors against the document. */
function resolveColor(c: string, css: DrawOpts["css"]): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  return m ? css(m[1], "#888888") : c;
}

/** Returns true while any flash is still animating (caller keeps the RAF loop alive). */
export function drawStage(ctx: CanvasRenderingContext2D, o: DrawOpts): boolean {
  const { W, H } = o;
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Floor
  const bg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.1, W / 2, H * 0.55, W * 0.7);
  bg.addColorStop(0, o.css("--panel-2", "#24242a"));
  bg.addColorStop(1, o.css("--bg", "#0d0d0f"));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (o.snap) {
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = o.gridStep; x < 1; x += o.gridStep) { ctx.moveTo(x * W, 0); ctx.lineTo(x * W, H); }
    for (let y = o.gridStep; y < 1; y += o.gridStep) { ctx.moveTo(0, y * H); ctx.lineTo(W, y * H); }
    ctx.stroke();
  }

  // Drummer's seat marker
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.font = `600 ${Math.max(9, H * 0.04)}px ${o.css("--font-sub", "sans-serif")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("▼  DRUMMER'S SEAT  ▼", W / 2, H - 6);

  let animating = false;
  for (const p of o.pieces) {
    const g = geo(p, W, H);
    const base = resolveColor(p.color, o.css);
    const f = o.flashes.get(p.id);
    let k = 0;
    if (f) {
      const age = o.now - f.t;
      const dur = o.reduceMotion ? 140 : FLASH_MS;
      if (age < dur) { k = 1 - age / dur; animating = true; }
    }
    const scale = o.reduceMotion ? 1 : 1 + 0.07 * k;
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.scale(scale, scale);
    if (k > 0) { ctx.shadowColor = base; ctx.shadowBlur = 26 * k; }
    drawPiece(ctx, p, g.rx, g.ry, base, k);
    ctx.restore();
    drawLabel(ctx, p, g, o);
  }

  const sel = o.pieces.find((p) => p.id === o.selectedId);
  if (sel) drawSelection(ctx, geo(sel, W, H), o);
  return animating;
}

function drawPiece(ctx: CanvasRenderingContext2D, p: KitPiece, rx: number, ry: number, base: string, k: number) {
  const lit = k > 0 ? 0.35 * k : 0;
  const body = ctx.createRadialGradient(-rx * 0.3, -ry * 0.3, Math.min(rx, ry) * 0.1, 0, 0, Math.max(rx, ry));
  body.addColorStop(0, shade(base, 0.25 + lit));
  body.addColorStop(1, shade(base, -0.45 + lit));
  ctx.fillStyle = body;

  if (p.kind === "pedal") {
    // Pedal: rounded footplate with a chevron.
    const w = rx * 1.4, h = ry * 1.8;
    roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.2);
    ctx.fill();
    ctx.strokeStyle = shade(base, 0.5); ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w * 0.25, h * 0.12); ctx.lineTo(0, -h * 0.12); ctx.lineTo(w * 0.25, h * 0.12); ctx.stroke();
    return;
  }

  if (p.id === "hihat") {
    // Two stacked cymbals.
    for (const dy of [ry * 0.35, -ry * 0.2]) {
      ctx.save(); ctx.translate(0, dy);
      ctx.fillStyle = body;
      ellipse(ctx, rx, ry); ctx.fill();
      ctx.strokeStyle = shade(base, 0.55); ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    sheen(ctx, rx, ry, -ry * 0.2);
    return;
  }

  if (isCymbal(p.id)) {
    ellipse(ctx, rx, ry); ctx.fill();
    ctx.strokeStyle = shade(base, 0.55); ctx.lineWidth = 2; ctx.stroke();
    sheen(ctx, rx, ry, 0);
    ctx.fillStyle = shade(base, -0.3); // bell
    ellipse(ctx, rx * 0.16, ry * 0.2); ctx.fill();
    return;
  }

  // Drum: filled circle with a rim and head ring.
  ellipse(ctx, rx, ry); ctx.fill();
  ctx.strokeStyle = "#d8d6d0"; ctx.lineWidth = Math.max(3, rx * 0.09); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = shade(base, 0.35); ctx.lineWidth = 1.5;
  ellipse(ctx, rx * 0.72, ry * 0.72); ctx.stroke();
  if (p.id === "kick") {
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ellipse(ctx, rx * 0.22, ry * 0.22); ctx.fill();
  }
}

function sheen(ctx: CanvasRenderingContext2D, rx: number, ry: number, dy: number) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = Math.max(1.5, ry * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(0, dy, rx * 0.78, ry * 0.7, 0, Math.PI * 1.08, Math.PI * 1.45);
  ctx.stroke();
  ctx.restore();
}

function ellipse(ctx: CanvasRenderingContext2D, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLabel(ctx: CanvasRenderingContext2D, p: KitPiece, g: Geo, o: DrawOpts) {
  const small = g.rx * 2 < 64;
  const text = (small ? PIECE_SHORT[p.id] : PIECE_NAMES[p.id]).toUpperCase();
  const fs = Math.max(9, Math.min(16, g.rx * 0.4));
  ctx.font = `700 ${fs}px ${o.css("--font-sub", "sans-serif")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,.75)";
  ctx.fillStyle = "#fff";
  const y = g.cy + (p.id === "hihat" ? g.ry * 0.35 : 0);
  ctx.strokeText(text, g.cx, y);
  ctx.fillText(text, g.cx, y);
}

/** Position of the resize handle (right edge of the selected piece, outside the selection ring). */
export function handlePos(g: Geo): { x: number; y: number } {
  return { x: g.cx + g.rx + 6, y: g.cy };
}

function drawSelection(ctx: CanvasRenderingContext2D, g: Geo, o: DrawOpts) {
  const amber = o.css("--amber", "#ffb830");
  ctx.save();
  ctx.strokeStyle = amber;
  ctx.lineWidth = 2.5;
  ctx.setLineDash(o.locked ? [] : [6, 4]);
  ctx.beginPath();
  ctx.ellipse(g.cx, g.cy, g.rx + 6, g.ry + 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!o.locked) {
    const h = handlePos(g);
    ctx.fillStyle = amber;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Move handles (visual hint: drag anywhere on the piece).
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0]] as const) {
      ctx.beginPath();
      ctx.arc(g.cx + dx * (g.rx + 6), g.cy + dy * (g.ry + 6), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
