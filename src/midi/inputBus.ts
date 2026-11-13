import type { CcEvent, DrumInputEvent, InputListener } from "./types";

type CcListener = (e: CcEvent) => void;

/** Tiny pub/sub that every input source writes to and every consumer reads from. */
class InputBus {
  private listeners = new Set<InputListener>();
  private ccListeners = new Set<CcListener>();

  subscribe(l: InputListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  subscribeCc(l: CcListener): () => void {
    this.ccListeners.add(l);
    return () => this.ccListeners.delete(l);
  }
  emit(e: DrumInputEvent): void {
    for (const l of this.listeners) l(e);
  }
  emitCc(e: CcEvent): void {
    for (const l of this.ccListeners) l(e);
  }
}

export const inputBus = new InputBus();
