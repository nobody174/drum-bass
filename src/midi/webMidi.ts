import { inputBus } from "./inputBus";
import { parseMidiMessage } from "./parse";

export type MidiStatus = "unsupported" | "idle" | "requesting" | "denied" | "ready" | "error";

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  /** "connected" | "disconnected" */
  state: string;
}

export interface WebMidiState {
  status: MidiStatus;
  inputs: MidiInputInfo[];
  selectedId: string | null;
  error: string | null;
}

const STORAGE_KEY = "drum-bass.midi.input";

function loadSelected(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function saveSelected(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

type Listener = (s: WebMidiState) => void;

class WebMidi {
  private access: MIDIAccess | null = null;
  private attached: MIDIInput | null = null;
  private listeners = new Set<Listener>();
  /** The user's remembered choice. Survives temporary fallbacks to other devices. */
  private preferredId: string | null = loadSelected();
  private state: WebMidiState = {
    status: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported",
    inputs: [],
    selectedId: loadSelected(),
    error: null,
  };

  getState(): WebMidiState {
    return this.state;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private set(patch: Partial<WebMidiState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Request MIDI access. Must be called from a user gesture (click/tap). */
  async connect(): Promise<void> {
    if (this.state.status === "unsupported" || this.state.status === "requesting") return;
    if (this.access) {
      this.refresh();
      return;
    }
    this.set({ status: "requesting", error: null });
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.access = access;
      access.onstatechange = () => this.refresh();
      this.refresh();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      const denied = name === "SecurityError" || name === "NotAllowedError";
      this.set({
        status: denied ? "denied" : "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Connect without a gesture if the browser already remembers a granted MIDI
   * permission (e.g. after a PWA relaunch). Silently does nothing otherwise.
   */
  async autoConnect(): Promise<void> {
    try {
      const p = await navigator.permissions.query({ name: "midi" as PermissionName });
      if (p.state === "granted") await this.connect();
    } catch {
      /* Permissions API or the "midi" name unsupported: wait for the Connect button. */
    }
  }

  /** Select an input by id (null = none). The choice is remembered. */
  select(id: string | null): void {
    this.preferredId = id;
    saveSelected(id);
    this.set({ selectedId: id });
    this.attach();
  }

  /** Detach listeners and drop MIDI access (used by tests / teardown). */
  dispose(): void {
    this.detach();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.set({ status: this.state.status === "unsupported" ? "unsupported" : "idle", inputs: [] });
  }

  private refresh(): void {
    if (!this.access) return;
    const inputs: MidiInputInfo[] = [];
    this.access.inputs.forEach((i) =>
      inputs.push({
        id: i.id,
        name: i.name ?? "Unknown",
        manufacturer: i.manufacturer ?? "",
        state: i.state,
      }),
    );
    // Prefer the remembered device whenever it is connected. Otherwise fall back
    // to the first connected input temporarily (not persisted), so the remembered
    // device takes over again as soon as it is plugged in.
    const pref = this.preferredId;
    let selectedId: string | null = pref;
    if (!pref || !inputs.some((i) => i.id === pref && i.state === "connected")) {
      selectedId = inputs.find((i) => i.state === "connected")?.id ?? pref;
    }
    this.state = { ...this.state, status: "ready", inputs, selectedId, error: null };
    this.attach();
    for (const l of this.listeners) l(this.state);
  }

  private detach(): void {
    if (this.attached) {
      this.attached.onmidimessage = null;
      this.attached = null;
    }
  }

  private attach(): void {
    this.detach();
    if (!this.access || !this.state.selectedId) return;
    let found: MIDIInput | null = null;
    this.access.inputs.forEach((i) => {
      if (i.id === this.state.selectedId && i.state === "connected") found = i;
    });
    if (!found) return;
    const input: MIDIInput = found;
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      const parsed = parseMidiMessage(ev.data, ev.timeStamp || performance.now());
      if (!parsed) return;
      if (parsed.kind === "note") inputBus.emit(parsed.event);
      else inputBus.emitCc(parsed.event);
    };
    this.attached = input;
  }
}

export const webMidi = new WebMidi();
