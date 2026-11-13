import type { ImportedAudio } from "../../chart/types";

/**
 * A silent 8-bit mono WAV so a song without audio can still use the transport (clock + click).
 * 4 kHz keeps it small (about 4 KB per second).
 */
export function silentStem(seconds: number): ImportedAudio {
  const rate = 4000;
  const n = Math.max(1, Math.ceil(seconds * rate));
  const buf = new Uint8Array(44 + n).fill(128);
  const dv = new DataView(buf.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) buf[o + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); dv.setUint32(4, 36 + n, true); tag(8, "WAVE"); tag(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  tag(36, "data"); dv.setUint32(40, n, true);
  return { name: "silence.wav", role: "other", blob: new Blob([buf], { type: "audio/wav" }) };
}
