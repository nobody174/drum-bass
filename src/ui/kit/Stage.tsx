import { useEffect, useRef } from "preact/hooks";
import { STAGE_ASPECT } from "../../kit";
import type { KitPiece, PieceId } from "../../kit";
import { drawStage, geo, handlePos, hitTest } from "./draw";
import type { FlashStore } from "./flash";

export const GRID_STEP = 0.05;
/** Pointer travel (CSS px) before a press becomes a drag; taps never move or dirty a piece. */
const DRAG_THRESHOLD = 5;

export interface StageProps {
  pieces: KitPiece[];
  locked: boolean;
  mirrored: boolean;
  snap: boolean;
  selectedId: PieceId | null;
  flashes: FlashStore;
  onSelect(id: PieceId | null): void;
  onMove(id: PieceId, x: number, y: number): void;
  onResize(id: PieceId, size: number): void;
}

type Mode =
  | { kind: "drag"; pointerId: number; id: PieceId; offX: number; offY: number; sx: number; sy: number; moved: boolean }
  | { kind: "handle"; pointerId: number; id: PieceId; sx: number; sy: number; moved: boolean }
  | { kind: "pinch"; id: PieceId; startDist: number; startSize: number }
  | { kind: "none" };

/**
 * Canvas stage. Canvas 2D (not SVG) because the same renderer style is used on the Play screen and
 * flash animations redraw the whole scene per frame anyway. Redraws are on demand (props change,
 * resize, flash animating), never a free-running loop.
 */
export function Stage(props: StageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const rafRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});

  // Redraw whenever visible state changes.
  useEffect(() => {
    drawRef.current();
  }, [props.pieces, props.locked, props.mirrored, props.snap, props.selectedId]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const rootStyle = getComputedStyle(document.documentElement);
    const cssCache = new Map<string, string>();
    const css = (n: string, fb: string) => {
      let v = cssCache.get(n);
      if (v === undefined) { v = rootStyle.getPropertyValue(n).trim() || fb; cssCache.set(n, v); }
      return v;
    };
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");

    const render = () => {
      rafRef.current = 0;
      const s = sizeRef.current;
      if (s.w < 2) return;
      const p = propsRef.current;
      const animating = drawStage(ctx, {
        W: s.w, H: s.h, dpr: s.dpr, pieces: p.pieces, mirrored: p.mirrored, locked: p.locked,
        selectedId: p.selectedId, snap: p.snap, gridStep: GRID_STEP, flashes: p.flashes.map,
        now: performance.now(), reduceMotion: rm.matches, css,
      });
      if (animating) schedule();
    };
    const schedule = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(render); };
    drawRef.current = schedule;

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      let w = r.width, h = r.width / STAGE_ASPECT;
      if (h > r.height && r.height > 0) { h = r.height; w = h * STAGE_ASPECT; }
      w = Math.floor(w); h = Math.floor(h);
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w, h, dpr };
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      schedule();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    window.addEventListener("resize", fit);
    fit();
    const unsubFlash = propsRef.current.flashes.subscribe(schedule);

    // ---- Pointer handling ----
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: Mode = { kind: "none" };

    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      // Mouse: primary button only. Touch and pen always start (their button is 0 on contact anyway).
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const pr = propsRef.current;
      const pt = local(e);
      pointers.set(e.pointerId, pt);
      const { w, h } = sizeRef.current;

      if (pointers.size === 2 && !pr.locked && pr.selectedId) {
        // Pinch-to-resize the selected piece; cancels any single-finger drag.
        const [a, b] = [...pointers.values()];
        const sel = pr.pieces.find((p) => p.id === pr.selectedId);
        if (sel) {
          mode = { kind: "pinch", id: sel.id, startDist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), startSize: sel.size };
          e.preventDefault();
          return;
        }
      }
      if (pointers.size > 1 || mode.kind !== "none") return; // one active gesture at a time

      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();

      // Resize handle of the selected piece.
      const sel = pr.selectedId ? pr.pieces.find((p) => p.id === pr.selectedId) : undefined;
      if (sel && !pr.locked) {
        const hp = handlePos(geo(sel, w, h));
        if (Math.hypot(pt.x - hp.x, pt.y - hp.y) <= 24) {
          mode = { kind: "handle", pointerId: e.pointerId, id: sel.id, sx: pt.x, sy: pt.y, moved: false };
          return;
        }
      }

      const hit = hitTest(pr.pieces, pt.x, pt.y, w, h);
      if (!hit) { pr.onSelect(null); return; }
      pr.onSelect(hit.id);
      if (pr.locked) {
        pr.flashes.trigger(hit.id, 100); // test flash only
        return;
      }
      const g = geo(hit, w, h);
      mode = { kind: "drag", pointerId: e.pointerId, id: hit.id, offX: pt.x - g.cx, offY: pt.y - g.cy, sx: pt.x, sy: pt.y, moved: false };
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const pt = local(e);
      pointers.set(e.pointerId, pt);
      const pr = propsRef.current;
      const { w, h } = sizeRef.current;
      if ((mode.kind === "drag" || mode.kind === "handle") && e.pointerId === mode.pointerId && !mode.moved) {
        if (Math.hypot(pt.x - mode.sx, pt.y - mode.sy) < DRAG_THRESHOLD) return;
        mode.moved = true;
      }
      if (mode.kind === "drag" && e.pointerId === mode.pointerId) {
        pr.onMove(mode.id, (pt.x - mode.offX) / w, (pt.y - mode.offY) / h);
      } else if (mode.kind === "handle" && e.pointerId === mode.pointerId) {
        const hid = mode.id;
        const sel = pr.pieces.find((p) => p.id === hid);
        if (sel) {
          const cx = sel.x * w;
          pr.onResize(hid, (2 * Math.abs(pt.x - cx)) / h);
        }
      } else if (mode.kind === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        pr.onResize(mode.id, mode.startSize * (d / mode.startDist));
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (mode.kind === "pinch") {
        if (pointers.size === 0) mode = { kind: "none" };
      } else if ("pointerId" in mode && mode.pointerId === e.pointerId) {
        mode = { kind: "none" };
      }
      if (pointers.size === 0) mode = { kind: "none" };
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("lostpointercapture", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      window.removeEventListener("resize", fit);
      ro.disconnect();
      unsubFlash();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      drawRef.current = () => {};
    };
  }, []);

  return (
    <div class="ke-stage-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} class="ke-canvas" role="img" aria-label="Drum kit stage" />
    </div>
  );
}
