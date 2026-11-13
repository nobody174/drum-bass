import { useEffect, useState } from "preact/hooks";
import { webMidi, type WebMidiState } from "./webMidi";

/** Subscribe a component to the Web MIDI state. */
export function useWebMidi(): WebMidiState & {
  connect: () => Promise<void>;
  select: (id: string | null) => void;
} {
  const [state, setState] = useState<WebMidiState>(webMidi.getState());
  useEffect(() => {
    setState(webMidi.getState());
    return webMidi.subscribe(setState);
  }, []);
  return { ...state, connect: () => webMidi.connect(), select: (id) => webMidi.select(id) };
}
