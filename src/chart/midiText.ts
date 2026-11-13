/**
 * Minimal Standard MIDI File reader for per-track text events, which @tonejs/midi only exposes for
 * the first track. Used for Rock Band style `[mix 3 drums0d]` events on PART DRUMS.
 * Defensive: any malformed data just ends the scan and returns what was read.
 */
export interface TrackText {
  trackName: string;
  events: { tick: number; text: string }[];
}

export function readTrackTexts(bytes: Uint8Array): TrackText[] {
  const out: TrackText[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  const latin = (o: number, n: number) => new TextDecoder("latin1").decode(bytes.subarray(o, o + n));
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    const id = ascii(pos, 4);
    const len = dv.getUint32(pos + 4);
    const start = pos + 8;
    const end = Math.min(bytes.length, start + len);
    pos = start + len;
    if (id !== "MTrk") continue;
    const track: TrackText = { trackName: "", events: [] };
    let p = start;
    let tick = 0;
    let status = 0;
    const vlq = (): number => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const b = bytes[p++]!;
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    try {
      while (p < end) {
        tick += vlq();
        let s = bytes[p]!;
        if (s & 0x80) {
          p++;
          if (s < 0xf0) status = s;
        } else {
          s = status; // running status: data byte follows
        }
        if (s === 0xff) {
          const type = bytes[p++]!;
          const n = vlq();
          if (type === 0x01 || type === 0x03) {
            const text = latin(p, n);
            if (type === 0x03) track.trackName = text;
            else track.events.push({ tick, text });
          }
          p += n;
        } else if (s === 0xf0 || s === 0xf7) {
          p += vlq();
        } else {
          const hi = s & 0xf0;
          p += hi === 0xc0 || hi === 0xd0 ? 1 : 2;
        }
      }
    } catch {
      /* ignore malformed remainder */
    }
    out.push(track);
  }
  return out;
}
