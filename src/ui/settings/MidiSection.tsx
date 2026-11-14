import { useWebMidi } from "../../midi";

const STATUS: Record<string, string> = {
  unsupported: "Web MIDI is not supported in this browser (use Chrome on Android or desktop).",
  idle: "Not connected yet.",
  requesting: "Waiting for permission...",
  denied: "MIDI permission was denied. Allow it in the browser site settings.",
  ready: "Ready.",
  error: "MIDI error.",
};

export default function MidiSection() {
  const m = useWebMidi();
  const live = m.inputs.filter((i) => i.state === "connected");
  const sel = m.inputs.find((i) => i.id === m.selectedId);
  const text =
    m.status === "ready"
      ? sel && sel.state === "connected"
        ? `Connected: ${sel.name}`
        : live.length
          ? `${live.length} input(s) available, none selected.`
          : "No MIDI input found. Plug in the kit."
      : (STATUS[m.status] ?? m.status);
  return (
    <div>
      <div class="set-row set-row-col">
        <span class="set-text">
          <span class="set-label">Input device</span>
          <span class="set-hint" role="status">{text}{m.error ? ` ${m.error}` : ""}</span>
        </span>
        {(m.status === "idle" || m.status === "denied" || m.status === "error") && (
          <button type="button" class="pedal" onClick={() => void m.connect()}>Connect MIDI</button>
        )}
        {m.status === "ready" && live.length > 1 && (
          <select class="set-select" aria-label="MIDI input device" value={m.selectedId ?? ""} onChange={(e) => m.select((e.currentTarget as HTMLSelectElement).value || null)}>
            {live.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}
      </div>
      <div class="set-links">
        <a class="btn" href="#/monitor">MIDI monitor</a>
        <a class="btn" href="#/kit">Kit editor (Learn wizard)</a>
      </div>
    </div>
  );
}
