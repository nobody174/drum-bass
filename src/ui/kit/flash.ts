import type { PieceId } from "../../kit";

/** Tiny shared store of "recently hit" pieces; the stage redraws on trigger. */
export class FlashStore {
  readonly map = new Map<PieceId, { t: number; vel: number }>();
  private subs = new Set<() => void>();

  trigger(id: PieceId, vel = 100): void {
    this.map.set(id, { t: performance.now(), vel });
    for (const s of this.subs) s();
  }
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
