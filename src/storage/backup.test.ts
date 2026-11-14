import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { readBytes } from "../chart/bytes";
import { createDefaultPreset } from "../kit/model";
import { createKitStore, type KitBackend } from "../kit/store";
import type { KitPreset } from "../kit/types";
import { DEFAULT_SETTINGS } from "../settings/store";
import { DEFAULT_SOUND_SETTINGS } from "../audio";
import {
  applyBackup, backupFilename, BackupError, clearData, exportBackup, inspectBackup, planExport,
  type BackupDeps, type SettingsBundle, type SettingsPatch,
} from "./backup";
import { summarizeRecord } from "./db";
import type { SongBackend, SongRecord, SongSummary } from "./songs";

function memKits() {
  const kits = new Map<string, KitPreset>();
  const meta = new Map<string, string>();
  const calls = { put: 0, remove: 0 };
  const be: KitBackend & { kits: Map<string, KitPreset>; meta: Map<string, string>; calls: typeof calls } = {
    kits, meta, calls,
    async getAll() { return [...kits.values()].map((k) => structuredClone(k)); },
    async put(p) { calls.put++; kits.set(p.id, structuredClone(p)); },
    async remove(id) { calls.remove++; kits.delete(id); },
    async getMeta(k) { return meta.get(k) ?? null; },
    async setMeta(k, v) { if (v === null) meta.delete(k); else meta.set(k, v); },
  };
  return be;
}

function memSongs(opts: { failPutAfter?: number; failWith?: unknown } = {}) {
  const recs = new Map<string, SongRecord>();
  const audio = new Map<string, Blob>();
  const calls = { put: 0, del: 0 };
  const be: SongBackend & { recs: Map<string, SongRecord>; audio: Map<string, Blob>; calls: typeof calls } = {
    recs, audio, calls,
    async getAllSummaries(): Promise<SongSummary[]> { return [...recs.values()].map((r) => summarizeRecord(structuredClone(r))); },
    async getRecord(id) { const r = recs.get(id); return r ? structuredClone(r) : null; },
    async putSong(rec, a) {
      if (opts.failPutAfter !== undefined && calls.put >= opts.failPutAfter) throw opts.failWith;
      calls.put++;
      for (const k of [...audio.keys()]) if (k.startsWith(rec.id + "/")) audio.delete(k);
      recs.set(rec.id, structuredClone(rec));
      for (const x of a) audio.set(`${rec.id}/${x.name}`, x.blob);
    },
    async getAudio(id) { return [...audio].filter(([k]) => k.startsWith(id + "/")).map(([k, blob]) => ({ name: k.slice(id.length + 1), blob })); },
    async patchRecord() { return false; },
    async deleteSong(id) {
      calls.del++;
      recs.delete(id);
      for (const k of [...audio.keys()]) if (k.startsWith(id + "/")) audio.delete(k);
    },
  };
  return be;
}

function memSettings(initial?: Partial<SettingsBundle>) {
  let state: SettingsBundle = { app: { ...DEFAULT_SETTINGS }, sound: { ...DEFAULT_SOUND_SETTINGS }, display: "lanes", approach: 2.2, ...initial };
  const applied: SettingsPatch[] = [];
  return {
    applied,
    get state() { return state; },
    read: () => structuredClone(state),
    apply(p: SettingsPatch) { applied.push(p); state = { ...state, ...p, app: { ...state.app, ...p.app }, sound: { ...state.sound, ...p.sound } }; },
    reset() { state = { app: { ...DEFAULT_SETTINGS }, sound: { ...DEFAULT_SOUND_SETTINGS }, display: "lanes", approach: 2.2 }; },
  };
}

function makeDeps(init: { songs?: ReturnType<typeof memSongs>; settings?: ReturnType<typeof memSettings>; seedKit?: boolean } = {}) {
  const kits = memKits();
  const songs = init.songs ?? memSongs();
  const settings = init.settings ?? memSettings();
  const store = createKitStore(kits);
  const deps: BackupDeps = { kits, songs, settings, ensureDefaultKit: () => store.ensureDefault() };
  return { deps, kits, songs, settings, store };
}

const rec = (id: string, title: string, stems: { name: string; role: SongRecord["stems"][number]["role"] }[], extra: Partial<SongRecord> = {}): SongRecord => ({
  id, title, artist: "Band", meta: { title, artist: "Band", delayMs: 40, tempoMap: [{ timeSec: 0, bpm: 120 }], startBpm: 120 },
  format: "clonehero-mid",
  notesByDifficulty: { expert: [{ timeSec: 1.5, piece: "kick", velocity: 100 }, { timeSec: 2, piece: "snare", velocity: 90, source: "red" }], easy: [] },
  stems, offsetMs: 12, addedAt: 1000, bestScore: 500, bestByDifficulty: { expert: 500 }, ...extra,
});

async function seedSong(songs: ReturnType<typeof memSongs>, id: string, title: string, bytes: Record<string, number[]>) {
  const stems = Object.keys(bytes).map((name) => ({ name, role: name.startsWith("drums") ? ("drums" as const) : ("song" as const) }));
  await songs.putSong(rec(id, title, stems), Object.entries(bytes).map(([name, b]) => ({ name, blob: new Blob([new Uint8Array(b)]) })));
}

async function manifest(extra: Record<string, unknown> = {}) {
  return strToU8(JSON.stringify({ format: "drum-bass-backup", app: "drum-bass", schemaVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", counts: {}, ...extra }));
}
const kitsJson = (kits: unknown[]) => strToU8(JSON.stringify({ kits }));
async function craft(files: Record<string, Uint8Array>) {
  return new Blob([zipSync(files, { level: 0 }) as BlobPart]);
}
const noWrites = (d: ReturnType<typeof makeDeps>) => d.kits.calls.put === 0 && d.kits.calls.remove === 0 && d.songs.calls.put === 0 && d.songs.calls.del === 0 && d.settings.applied.length === 0;

describe("export", () => {
  it("light export has kits and settings only, with a dated filename", async () => {
    const a = makeDeps();
    await a.store.ensureDefault();
    await seedSong(a.songs, "s1", "One", { "drums.ogg": [1, 2, 3] });
    const r = await exportBackup("light", a.deps, { now: new Date(2026, 10, 14) });
    expect(r.filename).toBe("drum-bass-kits-settings-2026-11-14.zip");
    expect(backupFilename("everything", new Date(2026, 0, 5))).toBe("drum-bass-everything-2026-01-05.zip");
    const files = unzipSync(await readBytes(r.blob));
    expect(Object.keys(files).sort()).toEqual(["kits.json", "manifest.json", "settings.json"]);
    const man = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    expect(man).toMatchObject({ app: "drum-bass", schemaVersion: 1, includesSongs: false, counts: { kits: 1, songs: 0 } });
  });

  it("everything export stores audio uncompressed, byte for byte", async () => {
    const a = makeDeps();
    await a.store.ensureDefault();
    const big = Array.from({ length: 3000 }, (_, i) => i % 251);
    await seedSong(a.songs, "s1", "One", { "drums.ogg": big, "song.mp3": [9, 9] });
    const r = await exportBackup("everything", a.deps);
    expect(r.counts).toEqual({ kits: 1, songs: 1, audioFiles: 2 });
    const infos: Record<string, number> = {};
    const files = unzipSync(await readBytes(r.blob), { filter: (i) => { infos[i.name] = i.compression; return true; } });
    expect(Object.keys(files)).toContain("songs/s1/song.json");
    expect(infos["songs/s1/audio/0.ogg"]).toBe(0);
    expect(infos["songs/s1/audio/1.mp3"]).toBe(0);
    expect([...files["songs/s1/audio/0.ogg"]!]).toEqual(big);
  });

  it("refuses above the size cap with a readable message and builds nothing", async () => {
    const a = makeDeps();
    await seedSong(a.songs, "s1", "One", { "drums.ogg": new Array(5000).fill(7) });
    await expect(exportBackup("everything", a.deps, { limits: { maxBytes: 1000, maxEntries: 100 } })).rejects.toMatchObject({ kind: "too-large" });
    const plan = await planExport(a.deps, { maxBytes: 1000, maxEntries: 100 });
    expect(plan).toMatchObject({ songs: 1, audioFiles: 1, audioBytes: 5000, tooLarge: true });
  });

  it("warns about a stem whose audio is missing", async () => {
    const a = makeDeps();
    await a.songs.putSong(rec("s1", "One", [{ name: "drums.ogg", role: "drums" }]), []);
    const r = await exportBackup("everything", a.deps);
    expect(r.warnings.join(" ")).toMatch(/missing/);
    const p = await inspectBackup(r.blob);
    expect(p.songs[0]!.record.stems).toEqual([]);
  });
});

describe("round trip", () => {
  it("kits + settings + songs survive export -> inspect -> import (replace) into an empty device", async () => {
    const src = makeDeps({ settings: memSettings({ display: "kit", approach: 1.6, app: { ...DEFAULT_SETTINGS, inputLatencyMs: 23, timingPreset: "strict" } }) });
    await src.store.ensureDefault();
    const extra = { ...createDefaultPreset(), id: "kit-extra", name: "Practice", locked: true };
    await src.store.savePreset(extra);
    await seedSong(src.songs, "song-a", "Alpha", { "drums.ogg": [1, 2, 3, 4], "song.ogg": [5, 6] });
    await seedSong(src.songs, "song-b", "Beta", { "song.mp3": [7] });
    const zip = (await exportBackup("everything", src.deps)).blob;

    const dst = makeDeps();
    const prepared = await inspectBackup(zip);
    expect(noWrites(dst)).toBe(true);
    const sum = await applyBackup(prepared, { mode: "replace", applySettings: true, applyLatency: true }, dst.deps);
    expect(sum.error).toBeUndefined();
    expect(sum).toMatchObject({ kitsAdded: 2, songsAdded: 2, settingsApplied: true });

    const gotKits = [...dst.kits.kits.values()].sort((a, b) => a.name.localeCompare(b.name));
    const srcKits = (await src.kits.getAll()).sort((a, b) => a.name.localeCompare(b.name));
    expect(gotKits).toEqual(srcKits);
    expect(dst.kits.kits.get("kit-extra")!.locked).toBe(true);
    expect(dst.settings.state).toMatchObject({ display: "kit", approach: 1.6, app: { inputLatencyMs: 23, timingPreset: "strict" } });
    expect(dst.songs.recs.get("song-a")).toEqual(src.songs.recs.get("song-a"));
    expect([...(await readBytes(dst.songs.audio.get("song-a/drums.ogg")!))]).toEqual([1, 2, 3, 4]);
    expect([...(await readBytes(dst.songs.audio.get("song-b/song.mp3")!))]).toEqual([7]);
  });

  it("add mode: collisions get new ids and unique names; nothing existing is overwritten", async () => {
    const src = makeDeps();
    const k = { ...createDefaultPreset(), id: "same-id", name: "Rock kit" };
    await src.kits.put(k);
    await seedSong(src.songs, "dup-id", "Imported", { "drums.ogg": [1] });
    await seedSong(src.songs, "other", "Same Title", { "drums.ogg": [2] });
    const zip = (await exportBackup("everything", src.deps)).blob;

    const dst = makeDeps();
    const mine = { ...createDefaultPreset(), id: "same-id", name: "Rock kit", mirrored: true };
    await dst.kits.put(mine);
    await seedSong(dst.songs, "dup-id", "Totally different", { "drums.ogg": [99] });
    await seedSong(dst.songs, "x", "Same Title", { "drums.ogg": [3] });

    const sum = await applyBackup(await inspectBackup(zip), { mode: "add", applySettings: false }, dst.deps);
    expect(sum).toMatchObject({ kitsAdded: 1, songsAdded: 1, songsSkipped: 1, settingsApplied: false });
    expect(dst.kits.kits.get("same-id")).toEqual(mine);
    const names = [...dst.kits.kits.values()].map((x) => x.name).sort();
    expect(names).toEqual(["Rock kit", "Rock kit 2"]);
    expect(dst.songs.recs.get("dup-id")!.title).toBe("Totally different");
    expect([...(await readBytes(dst.songs.audio.get("dup-id/drums.ogg")!))]).toEqual([99]);
    expect(dst.songs.recs.size).toBe(3);
    expect(dst.settings.applied).toEqual([]);
  });

  it("importing the same backup twice in add mode adds nothing the second time", async () => {
    const a = makeDeps();
    await a.store.ensureDefault();
    await seedSong(a.songs, "s1", "One", { "drums.ogg": [1] });
    const zip = (await exportBackup("everything", a.deps)).blob;
    const sum = await applyBackup(await inspectBackup(zip), { mode: "add", applySettings: false }, a.deps);
    expect(sum).toMatchObject({ kitsAdded: 0, kitsSkipped: 1, songsAdded: 0, songsSkipped: 1 });
  });

  it("add mode dedupes by canonical form: key order, piece order, id and updatedAt do not matter", async () => {
    const src = makeDeps();
    const k = { ...createDefaultPreset(), id: "kid", name: "Canon", updatedAt: 111 };
    await src.kits.put(k);
    const zip = (await exportBackup("light", src.deps)).blob;
    const dst = makeDeps();
    const rebuilt = JSON.parse(JSON.stringify({ ...k, id: "other-id", updatedAt: 999, pieces: [...k.pieces].reverse().map((p) => Object.fromEntries(Object.entries(p).reverse())) }));
    await dst.kits.put(rebuilt);
    const sum = await applyBackup(await inspectBackup(zip), { mode: "add", applySettings: false }, dst.deps);
    expect(sum).toMatchObject({ kitsAdded: 0, kitsSkipped: 1 });
    const again = await applyBackup(await inspectBackup(zip), { mode: "add", applySettings: false }, dst.deps);
    expect(again.kitsAdded).toBe(0);
  });

  it("latency is only restored when asked, in replace and add mode; other settings follow applySettings", async () => {
    const src = makeDeps({ settings: memSettings({ app: { ...DEFAULT_SETTINGS, inputLatencyMs: 80, outputLatencyMs: 40, timingPreset: "strict" } }) });
    const zip = (await exportBackup("light", src.deps)).blob;
    const run = async (mode: "add" | "replace", applySettings: boolean, applyLatency?: boolean) => {
      const dst = makeDeps();
      const sum = await applyBackup(await inspectBackup(zip), { mode, applySettings, applyLatency }, dst.deps);
      return { sum, app: dst.settings.state.app };
    };
    let r = await run("replace", true);
    expect(r.app).toMatchObject({ inputLatencyMs: 0, outputLatencyMs: 0, timingPreset: "strict" });
    r = await run("replace", true, true);
    expect(r.app).toMatchObject({ inputLatencyMs: 80, outputLatencyMs: 40, timingPreset: "strict" });
    r = await run("add", false, true);
    expect(r.sum.settingsApplied).toBe(false);
    expect(r.app).toMatchObject({ inputLatencyMs: 0, timingPreset: "normal" });
    r = await run("add", true);
    expect(r.app).toMatchObject({ inputLatencyMs: 0, timingPreset: "strict" });
    r = await run("add", true, true);
    expect(r.app).toMatchObject({ inputLatencyMs: 80 });
  });

  it("refuses a concurrent import or clear while one is running", async () => {
    const src = makeDeps();
    await src.store.ensureDefault();
    const zip = (await exportBackup("light", src.deps)).blob;
    const dst = makeDeps();
    const prepared = await inspectBackup(zip);
    const first = applyBackup(prepared, { mode: "replace", applySettings: false }, dst.deps);
    const second = await applyBackup(prepared, { mode: "replace", applySettings: false }, dst.deps);
    expect(second.error).toMatch(/still running/);
    await expect(clearData("kits", dst.deps)).rejects.toThrow(/still running/);
    expect((await first).error).toBeUndefined();
    await expect(clearData("kits", dst.deps)).resolves.toBeDefined();
  });

  it("an oversized import is refused with a readable message", async () => {
    const big = new Blob([new Uint8Array(17 * 1024 ** 2)]);
    await expect(inspectBackup(big, { maxBytes: 10 })).rejects.toThrow(/Kits and settings only/);
  });

  it("replace only touches the data types present in the zip", async () => {
    const src = makeDeps();
    await src.store.ensureDefault();
    const light = (await exportBackup("light", src.deps)).blob;
    const dst = makeDeps();
    await dst.store.ensureDefault();
    await dst.kits.put({ ...createDefaultPreset(), id: "old", name: "Old" });
    await seedSong(dst.songs, "keep", "Keep me", { "drums.ogg": [1] });
    const sum = await applyBackup(await inspectBackup(light), { mode: "replace", applySettings: true }, dst.deps);
    expect(sum.kitsRemoved).toBe(2);
    expect(dst.songs.recs.has("keep")).toBe(true);
    expect(dst.kits.kits.has("old")).toBe(false);
    expect(dst.kits.kits.size).toBe(1);
  });

  it("a quota failure stops readably, keeps what exists and deletes nothing in replace mode", async () => {
    const src = makeDeps();
    await seedSong(src.songs, "a", "A", { "d.ogg": [1] });
    await seedSong(src.songs, "b", "B", { "d.ogg": [2] });
    const zip = (await exportBackup("everything", src.deps)).blob;
    const dst = makeDeps({ songs: memSongs({ failPutAfter: 1, failWith: Object.assign(new Error("x"), { name: "QuotaExceededError" }) }) });
    await seedSong(dst.songs, "old", "Old", { "d.ogg": [9] });
    dst.songs.calls.put = 0;
    const sum = await applyBackup(await inspectBackup(zip), { mode: "replace", applySettings: true }, dst.deps);
    expect(sum.error).toMatch(/Not enough storage space/);
    expect(dst.songs.recs.has("old")).toBe(true);
    expect(sum.songsRemoved).toBe(0);
    expect(sum.settingsApplied).toBe(false);
  });
});

describe("kit invariants on import", () => {
  const piece = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: "drum", x: 0.5, y: 0.5, size: 0.2, color: "#ff0000", midiNotes: { head: 38 }, ...over });
  const kit = (pieces: unknown[], over: Record<string, unknown> = {}) => ({ id: "k1", name: "Imported", pieces, locked: false, mirrored: false, updatedAt: 5, ...over });

  it("drops unknown pieces, clamps sizes and positions, keeps canonical order", async () => {
    const zip = await craft({
      "manifest.json": await manifest(),
      "kits.json": kitsJson([kit([piece("snare", { x: 5 / 3, y: -0.5, size: 0.9 }), piece("kick", { size: 0.001 }), piece("banjo")])]),
    });
    const p = await inspectBackup(zip);
    const k = p.kits[0]!;
    expect(k.pieces.map((x) => x.id)).toEqual(["kick", "snare"]);
    const snare = k.pieces[1]!;
    expect(snare.size).toBe(0.5);
    expect(snare.x).toBeLessThanOrEqual(1 - 0.25 / (16 / 9) + 1e-9);
    expect(snare.y).toBeCloseTo(0.25, 6);
    expect(k.pieces[0]!.size).toBe(0.05);
    expect(k.updatedAt).toBe(5);
    expect(p.warnings.join(" ")).toMatch(/banjo/);
  });

  it("skips a kit without kick or snare and rejects a zip where nothing is usable", async () => {
    const zip = await craft({ "manifest.json": await manifest(), "kits.json": kitsJson([kit([piece("kick")])]) });
    await expect(inspectBackup(zip)).rejects.toBeInstanceOf(BackupError);
  });

  it("rejects bad types, note ranges, colors and forbidden zone names", async () => {
    for (const over of [{ size: "big" }, { color: "red" }, { midiNotes: { head: 200 } }, { midiNotes: { head: 1.5 } }, { kind: "banjo" }, { x: NaN }, { midiNotes: { constructor: 1 } }]) {
      const zip = await craft({ "manifest.json": await manifest(), "kits.json": kitsJson([kit([piece("kick"), piece("snare", over)])]) });
      await expect(inspectBackup(zip), JSON.stringify(over)).rejects.toBeInstanceOf(BackupError);
    }
  });
});

describe("malicious zips are rejected without writes", () => {
  const good = async () => ({ "manifest.json": await manifest(), "kits.json": kitsJson([]) });

  it("path traversal and absolute names", async () => {
    for (const name of ["../evil.json", "songs/../../x.json", "/etc/passwd", "C:/x.txt", "songs\\a\\song.json"]) {
      const d = makeDeps();
      const zip = await craft({ ...(await good()), [name]: strToU8("x") });
      await expect(inspectBackup(zip), name).rejects.toThrow(/unsafe/);
      expect(noWrites(d)).toBe(true);
    }
  });

  it("too many entries", async () => {
    const files: Record<string, Uint8Array> = await good();
    for (let i = 0; i < 12; i++) files[`junk${i}.txt`] = strToU8("x");
    await expect(inspectBackup(await craft(files), { maxEntries: 10 })).rejects.toThrow(/too many entries/);
  });

  it("declared unpacked size over the cap is refused before inflating", async () => {
    const files = { ...(await good()), "songs/a/song.json": strToU8("{}"), "songs/a/audio/0.ogg": new Uint8Array(5000) };
    await expect(inspectBackup(await craft(files), { maxBytes: 4000 })).rejects.toMatchObject({ kind: "too-large" });
    // a file over the cap is refused on its size alone
    const big = new Blob([new Uint8Array(17 * 1024 ** 2)]);
    await expect(inspectBackup(big, { maxBytes: 1000 })).rejects.toMatchObject({ kind: "too-large" });
  });

  it("an oversized data file is refused by its declared size (bomb-like)", async () => {
    const huge = new Uint8Array(9 * 1024 ** 2).fill(32); // 9 MB of spaces: compresses to almost nothing
    const zip = new Blob([zipSync({ ...(await good()), "kits.json": huge }, { level: 9 }) as BlobPart]);
    await expect(inspectBackup(zip)).rejects.toThrow(/too large/);
  });

  it("bad JSON and bad schemas", async () => {
    const d = makeDeps();
    await expect(inspectBackup(await craft({ "manifest.json": strToU8("{nope") }))).rejects.toThrow(/not valid JSON/);
    await expect(inspectBackup(await craft({ "kits.json": kitsJson([]) }))).rejects.toThrow(/not a Drum Bass backup/);
    await expect(inspectBackup(await craft({ "manifest.json": await manifest({ app: "other" }) }))).rejects.toThrow(/not a Drum Bass backup/);
    await expect(inspectBackup(await craft({ "manifest.json": await manifest({ schemaVersion: 99 }) }))).rejects.toThrow(/newer version/);
    await expect(inspectBackup(await craft({ ...(await good()), "settings.json": strToU8(JSON.stringify({ app: { inputLatencyMs: 99999 } })) }))).rejects.toThrow(/between/);
    await expect(inspectBackup(await craft({ ...(await good()), "settings.json": strToU8(JSON.stringify({ app: { timingPreset: "wild" } })) }))).rejects.toThrow(/one of/);
    await expect(inspectBackup(new Blob([new Uint8Array([1, 2, 3, 4, 5])]))).rejects.toThrow(/not a readable zip/);
    const badSong = { ...(await good()), "songs/a/song.json": strToU8(JSON.stringify({ ...rec("a", "A", []), notesByDifficulty: { expert: [{ timeSec: "soon", piece: "kick", velocity: 1 }] } })) };
    await expect(inspectBackup(await craft(badSong))).rejects.toThrow(/timeSec/);
    const badSong2 = { ...(await good()), "songs/a/song.json": strToU8(JSON.stringify({ ...rec("a", "A", []), title: "x".repeat(500) })) };
    await expect(inspectBackup(await craft(badSong2))).rejects.toThrow(/too long/);
    const badPiece = { ...(await good()), "songs/a/song.json": strToU8(JSON.stringify({ ...rec("a", "A", []), notesByDifficulty: { expert: [{ timeSec: 1, piece: "banjo", velocity: 1 }] } })) };
    await expect(inspectBackup(await craft(badPiece))).rejects.toThrow(/piece/);
    expect(noWrites(d)).toBe(true);
  });

  it("unknown files are ignored with a warning, never inflated or written", async () => {
    const p = await inspectBackup(await craft({ ...(await good()), "evil.exe": strToU8("MZ"), "songs/a/audio/0.exe": strToU8("x") }));
    expect(p.warnings.join(" ")).toMatch(/2 unrecognized/);
    expect(p.songs).toEqual([]);
  });

  it("hostile ids get replaced instead of becoming storage keys", async () => {
    const r = { ...rec("a/b", "A", []) };
    const p = await inspectBackup(await craft({ ...(await good()), "songs/a/song.json": strToU8(JSON.stringify(r)) }));
    expect(p.songs[0]!.idReplaced).toBe(true);
    expect(p.songs[0]!.record.id).not.toBe("a/b");
  });
});

describe("clear data", () => {
  it("clears kits and recreates the default preset", async () => {
    const d = makeDeps();
    await d.store.ensureDefault();
    await d.kits.put({ ...createDefaultPreset(), id: "x", name: "X" });
    await seedSong(d.songs, "s", "S", { "d.ogg": [1] });
    const r = await clearData("kits", d.deps);
    expect(r.kitsRemoved).toBe(2);
    expect(d.kits.kits.size).toBe(1);
    expect([...d.kits.kits.values()][0]!.name).toBe("Alesis Nitro Max");
    expect(d.songs.recs.size).toBe(1);
    expect(await d.store.getActiveId()).toBe([...d.kits.kits.keys()][0]);
  });

  it("next load recreates the default even if the immediate recreation is skipped", async () => {
    const d = makeDeps();
    await d.store.ensureDefault();
    d.deps.ensureDefaultKit = async () => {};
    await clearData("kits", d.deps);
    expect(d.kits.kits.size).toBe(0);
    const again = await d.store.ensureDefault();
    expect(again.name).toBe("Alesis Nitro Max");
    expect(d.kits.kits.size).toBe(1);
  });

  it("clears songs (records and audio) only", async () => {
    const d = makeDeps();
    await d.store.ensureDefault();
    await seedSong(d.songs, "s", "S", { "d.ogg": [1] });
    const r = await clearData("songs", d.deps);
    expect(r.songsRemoved).toBe(1);
    expect(d.songs.recs.size).toBe(0);
    expect(d.songs.audio.size).toBe(0);
    expect(d.kits.kits.size).toBe(1);
  });

  it("clears settings only", async () => {
    const d = makeDeps({ settings: memSettings({ display: "kit" }) });
    await d.store.ensureDefault();
    const r = await clearData("settings", d.deps);
    expect(r.settingsReset).toBe(true);
    expect(d.settings.state.display).toBe("lanes");
    expect(d.kits.kits.size).toBe(1);
  });

  it("everything clears all three and still ends with a default kit", async () => {
    const d = makeDeps({ settings: memSettings({ display: "kit" }) });
    await d.store.ensureDefault();
    await seedSong(d.songs, "s", "S", { "d.ogg": [1] });
    await clearData("everything", d.deps);
    expect(d.songs.recs.size).toBe(0);
    expect(d.settings.state.display).toBe("lanes");
    expect(d.kits.kits.size).toBe(1);
  });

  it("reports a storage failure readably", async () => {
    const d = makeDeps();
    d.deps.songs = { ...d.songs, async getAllSummaries() { throw new Error("db closed"); } };
    await expect(clearData("songs", d.deps)).rejects.toThrow(/Could not clear the data: db closed/);
  });
});
