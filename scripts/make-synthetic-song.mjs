// Generates fixtures/synthetic/demo-rock/: an original, fully synthetic Clone Hero style song folder.
//   song.ini, notes.mid (PART DRUMS, Expert + Easy), drums.wav, song.wav, expected.json
// No dependencies. Run: node scripts/make-synthetic-song.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "synthetic", "demo-rock");
mkdirSync(OUT, { recursive: true });

const PPQ = 480;
const BAR = PPQ * 4;
const BARS = 32;
const TEMPO_CHANGE_BAR = 16;
const US_A = 500000; // 120 BPM
const US_B = 428571; // ~140 BPM
const SR = 8000;

// ---- tick -> seconds (independent of the app's tempo.ts on purpose) ----
const changeTick = TEMPO_CHANGE_BAR * BAR;
const secAtChange = (changeTick / PPQ) * (US_A / 1e6);
const sec = (tick) => (tick < changeTick ? (tick / PPQ) * (US_A / 1e6) : secAtChange + ((tick - changeTick) / PPQ) * (US_B / 1e6));

// ---- pattern ----
// MIDI note numbers (Rock Band layout): expert base 96, easy base 60. Tom markers 110/111/112.
const EXPERT = { kick: 96, red: 97, yellow: 98, blue: 99, green: 100, kick2x: 95 };
const EASY = { kick: 60, red: 61, yellow: 62 };
const gems = []; // { tick, midi, diff, piece }
const markers = []; // { tick, midi, len }
const extras = []; // non-gem events that parsers must ignore { tick, midi, len }

const add = (diff, tick, midi, piece) => gems.push({ tick, midi, diff, piece });

for (let b = 0; b < BARS; b++) {
  const t0 = b * BAR;
  const chorus = b >= 16;
  const fillBar = (b + 1) % 4 === 0;
  const crashBar = b % 4 === 0;

  // Expert
  for (let e = 0; e < 8; e++) {
    const off = e * (PPQ / 2);
    if (fillBar && off >= 3 * PPQ) continue; // fill replaces beat 4
    if (crashBar && off === 0) continue; // crash replaces the hat/ride on beat 1
    if (chorus) add("expert", t0 + off, EXPERT.blue, "ride");
    else add("expert", t0 + off, EXPERT.yellow, "hihat");
  }
  if (crashBar) add("expert", t0, EXPERT.green, "crash1");
  add("expert", t0, EXPERT.kick, "kick");
  add("expert", t0 + 2 * PPQ, EXPERT.kick, "kick");
  add("expert", t0 + 2 * PPQ + PPQ / 2, EXPERT.kick, "kick");
  add("expert", t0 + PPQ, EXPERT.red, "snare");
  add("expert", t0 + 3 * PPQ, EXPERT.red, "snare");
  if (b === 9) add("expert", t0 + 3 * PPQ + PPQ / 2, EXPERT.kick2x, "kick");
  if (fillBar) {
    const f = t0 + 3 * PPQ;
    // beat 4 replaced by: snare, yellow tom, blue tom, green tom (16ths). The snare at f is already added above.
    add("expert", f + 120, EXPERT.yellow, "tom1");
    add("expert", f + 240, EXPERT.blue, "tom2");
    add("expert", f + 360, EXPERT.green, "tom3");
    markers.push({ tick: f, midi: 110, len: PPQ }, { tick: f, midi: 111, len: PPQ }, { tick: f, midi: 112, len: PPQ });
    extras.push({ tick: f, midi: 120 + (b % 5), len: PPQ }); // fill phrase, must be ignored
  }

  // Easy: kick 1,3 / snare 2,4 / hat quarters
  // Tom markers are shared by all difficulties, so the easy yellow note on a fill beat is a tom.
  for (let q = 0; q < 4; q++) add("easy", t0 + q * PPQ, EASY.yellow, fillBar && q === 3 ? "tom1" : "hihat");
  add("easy", t0, EASY.kick, "kick");
  add("easy", t0 + 2 * PPQ, EASY.kick, "kick");
  add("easy", t0 + PPQ, EASY.red, "snare");
  add("easy", t0 + 3 * PPQ, EASY.red, "snare");
}
extras.push({ tick: 20 * BAR, midi: 103, len: 4 * BAR }); // solo marker
extras.push({ tick: 28 * BAR, midi: 116, len: 4 * BAR }); // energy phrase

// ---- SMF writer ----
const varlen = (n) => {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const str = (s) => [...Buffer.from(s, "latin1")];
const metaText = (type, s) => [0xff, type, ...varlen(s.length), ...str(s)];

function trackBytes(events) {
  // events: { tick, order, bytes }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...varlen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(...varlen(0), 0xff, 0x2f, 0x00);
  return [...str("MTrk"), ...u32(body.length), ...body];
}

const tempoTrack = trackBytes([
  { tick: 0, order: 0, bytes: metaText(0x03, "tempo") },
  { tick: 0, order: 1, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  { tick: 0, order: 2, bytes: [0xff, 0x51, 0x03, (US_A >> 16) & 255, (US_A >> 8) & 255, US_A & 255] },
  { tick: changeTick, order: 2, bytes: [0xff, 0x51, 0x03, (US_B >> 16) & 255, (US_B >> 8) & 255, US_B & 255] },
]);

const drumEvents = [{ tick: 0, order: 0, bytes: metaText(0x03, "PART DRUMS") }];
const noteOnOff = (tick, midi, len, vel = 100) => {
  drumEvents.push({ tick, order: 2, bytes: [0x99, midi, vel] });
  drumEvents.push({ tick: tick + len, order: 1, bytes: [0x89, midi, 0] }); // note-off sorts before note-on at same tick
};
for (const g of gems) noteOnOff(g.tick, g.midi, 60);
for (const m of [...markers, ...extras]) noteOnOff(m.tick, m.midi, m.len);
const drumTrack = trackBytes(drumEvents);

const smf = Uint8Array.from([
  ...str("MThd"), ...u32(6), ...u16(1), ...u16(2), ...u16(PPQ),
  ...tempoTrack,
  ...drumTrack,
]);
writeFileSync(join(OUT, "notes.mid"), smf);

// ---- song.ini ----
writeFileSync(
  join(OUT, "song.ini"),
  [
    "[song]",
    "name = Synthetic Demo Rock",
    "artist = drum-bass test fixtures",
    "album = Synthetic",
    "year = 2026",
    "charter = generator",
    "delay = 0",
    `song_length = ${Math.round(sec(BARS * BAR) * 1000)}`,
    "pro_drums = True",
    "",
  ].join("\r\n"),
);

// ---- audio ----
const totalSec = sec(BARS * BAR) + 0.5;
const N = Math.ceil(totalSec * SR);
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function renderDrums() {
  const buf = new Float32Array(N);
  const hit = (t, len, fn) => {
    const s0 = Math.floor(t * SR);
    for (let i = 0; i < len * SR && s0 + i < N; i++) buf[s0 + i] += fn(i / SR);
  };
  for (const g of gems.filter((x) => x.diff === "expert")) {
    const t = sec(g.tick);
    switch (g.piece) {
      case "kick": {
        let ph = 0;
        hit(t, 0.22, (x) => {
          ph += (2 * Math.PI * (45 + 90 * Math.exp(-x * 30))) / SR;
          return 0.9 * Math.sin(ph) * Math.exp(-x * 14);
        });
        break;
      }
      case "snare":
        hit(t, 0.18, (x) => 0.5 * rnd() * Math.exp(-x * 22) + 0.4 * Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 30));
        break;
      case "hihat":
        hit(t, 0.05, (x) => 0.25 * rnd() * Math.exp(-x * 90));
        break;
      case "ride":
        hit(t, 0.25, (x) => 0.18 * (rnd() * 0.6 + Math.sin(2 * Math.PI * 2400 * x) * 0.4) * Math.exp(-x * 14));
        break;
      case "crash1":
        hit(t, 0.9, (x) => 0.3 * rnd() * Math.exp(-x * 4));
        break;
      default: {
        const f = { tom1: 200, tom2: 150, tom3: 110 }[g.piece] ?? 150;
        hit(t, 0.25, (x) => 0.7 * Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 12));
      }
    }
  }
  return buf;
}

function renderSong() {
  const buf = new Float32Array(N);
  const roots = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1, original progression, 1 bar each
  for (let b = 0; b < BARS; b++) {
    const root = roots[b % 4];
    for (let q = 0; q < 4; q++) {
      const t = sec(b * BAR + q * PPQ);
      const dur = sec(b * BAR + (q + 1) * PPQ) - t;
      const s0 = Math.floor(t * SR);
      for (let i = 0; i < dur * SR && s0 + i < N; i++) {
        const x = i / SR;
        const env = Math.exp(-x * 5) * Math.min(1, x * 200);
        const bass = Math.sin(2 * Math.PI * root * x) + 0.4 * Math.sin(2 * Math.PI * root * 2 * x);
        const chord = [1, 1.25, 1.5].reduce((a, r) => a + Math.sin(2 * Math.PI * root * 4 * r * (s0 + i) / SR), 0) / 3;
        buf[s0 + i] += 0.35 * env * bass + 0.08 * chord;
      }
    }
  }
  return buf;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.8 / peak : 1;
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * g * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
writeFileSync(join(OUT, "drums.wav"), wav(renderDrums()));
writeFileSync(join(OUT, "song.wav"), wav(renderSong()));

// ---- expected.json: ground truth for the importer test ----
const expected = { ppq: PPQ, bars: BARS, tempoChangeTick: changeTick, usPerQuarter: [US_A, US_B], difficulties: {} };
for (const diff of ["expert", "easy"]) {
  expected.difficulties[diff] = gems
    .filter((g) => g.diff === diff)
    .map((g) => ({ tick: g.tick, timeSec: sec(g.tick), piece: g.piece }))
    .sort((a, b) => a.tick - b.tick || a.piece.localeCompare(b.piece));
}
writeFileSync(join(OUT, "expected.json"), JSON.stringify(expected));
console.log(`Wrote demo-rock to ${OUT}: ${gems.length} gems, ${(smf.length)} byte MIDI, ${N} samples/stem.`);
