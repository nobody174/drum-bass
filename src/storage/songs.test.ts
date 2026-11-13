import { describe, expect, it, vi } from "vitest";
import type { ImportedSong } from "../chart/types";
import {
  bestFor, createSongStore, createSongIdbBackend, displayBest, requestPersistentStorageOnce, SongStorageError,
  type SongBackend, type SongRecord, type SongSummary,
} from "./songs";
import { backfillSummaries, summarizeRecord } from "./db";

function memBackend(opts: { failPut?: unknown } = {}) {
  const recs = new Map<string, SongRecord>();
  const sums = new Map<string, SongSummary>();
  const audio = new Map<string, Blob>();
  const reads = { fullRecords: 0 };
  const be: SongBackend & { recs: Map<string, SongRecord>; sums: Map<string, SongSummary>; audio: Map<string, Blob>; reads: typeof reads } = {
    recs,
    sums,
    audio,
    reads,
    async getAllSummaries() {
      // Same contract as the IDB backend: summaries only, repairing a song that has none.
      for (const [id, r] of recs) if (!sums.has(id)) sums.set(id, summarizeRecord(r));
      return [...sums.values()].map((x) => structuredClone(x));
    },
    async getRecord(id) {
      reads.fullRecords++;
      const r = recs.get(id);
      return r ? structuredClone(r) : null;
    },
    async putSong(rec, a) {
      if (opts.failPut) throw opts.failPut;
      for (const k of [...audio.keys()]) if (k.startsWith(rec.id + "/")) audio.delete(k);
      recs.set(rec.id, structuredClone(rec));
      sums.set(rec.id, summarizeRecord(structuredClone(rec)));
      for (const x of a) audio.set(`${rec.id}/${x.name}`, x.blob);
    },
    async getAudio(id) {
      return [...audio.entries()].filter(([k]) => k.startsWith(id + "/")).map(([k, blob]) => ({ name: k.slice(id.length + 1), blob }));
    },
    async patchRecord(id, fn) {
      const r = recs.get(id);
      if (!r) return false;
      const next = { ...r, ...fn(structuredClone(r)) };
      recs.set(id, next);
      sums.set(id, summarizeRecord(structuredClone(next)));
      return true;
    },
    async deleteSong(id) {
      recs.delete(id);
      sums.delete(id);
      for (const k of [...audio.keys()]) if (k.startsWith(id + "/")) audio.delete(k);
    },
  };
  return be;
}

const imported = (title = "Song", artist = "Band"): ImportedSong => ({
  meta: { title, artist, delayMs: 120 },
  format: "clonehero-mid",
  notesByDifficulty: { expert: [{ timeSec: 1, piece: "kick", velocity: 100 }], easy: [] },
  audio: [
    { name: "drums.ogg", role: "drums", blob: new Blob(["d"]) },
    { name: "song.ogg", role: "song", blob: new Blob(["s"]) },
  ],
  warnings: [],
});

describe("song store", () => {
  it("round-trips a song with its audio", async () => {
    const store = createSongStore(memBackend());
    const saved = await store.saveImported(imported());
    expect(saved.offsetMs).toBe(0);
    const got = await store.getSong(saved.id);
    expect(got?.title).toBe("Song");
    expect(got?.meta.delayMs).toBe(120);
    expect(got?.audio.map((a) => [a.name, a.role])).toEqual([
      ["drums.ogg", "drums"],
      ["song.ogg", "song"],
    ]);
    expect(got?.audio[0]!.blob).toBeInstanceOf(Blob);
    expect(got?.notesByDifficulty.expert).toHaveLength(1);
    expect(await store.getSong("nope")).toBeNull();
  });

  it("lists metadata only, newest first, listing only non-empty difficulties", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const a = await store.saveImported(imported("A"));
    be.recs.get(a.id)!.addedAt = 1; be.sums.get(a.id)!.addedAt = 1;
    await store.saveImported(imported("B"));
    const list = await store.listSongs();
    expect(list.map((s) => s.title)).toEqual(["B", "A"]);
    expect(list[0]!.difficulties).toEqual(["expert"]);
    expect(list[0]).not.toHaveProperty("notesByDifficulty");
    expect(list[0]).not.toHaveProperty("audio");
    expect(list[0]!.stems).toHaveLength(2);
  });

  it("dedupes stem names inside one song", async () => {
    const store = createSongStore(memBackend());
    const imp = imported();
    imp.audio.push({ name: "song.ogg", role: "guitar", blob: new Blob(["g"]) });
    const saved = await store.saveImported(imp);
    expect(saved.audio.map((a) => a.name)).toEqual(["drums.ogg", "song.ogg", "song.ogg (2)"]);
    expect((await store.getSong(saved.id))!.audio).toHaveLength(3);
  });

  it("setOffset / setBestScore / delete", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const s = await store.saveImported(imported());
    await store.setOffset(s.id, -42.4);
    await store.setBestScore(s.id, 9000);
    const got = await store.getSong(s.id);
    expect(got?.offsetMs).toBe(-42);
    expect(got?.bestScore).toBe(9000);
    await store.deleteSong(s.id);
    expect(await store.getSong(s.id)).toBeNull();
    expect(be.audio.size).toBe(0);
    await expect(store.setOffset(s.id, NaN)).rejects.toThrow(/finite/);
  });

  it("finds duplicates; replaceDuplicate overwrites in place keeping offset and score", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const first = await store.saveImported(imported(" Song ", "BAND"));
    await store.setOffset(first.id, 30);
    await store.setBestScore(first.id, 5);
    expect((await store.findDuplicate("song", "band"))?.id).toBe(first.id);
    const second = await store.saveImported(imported("Song", "Band"));
    expect(second.id).not.toBe(first.id); // default: no replace
    be.recs.get(second.id)!.addedAt = 0; be.sums.get(second.id)!.addedAt = 0; // make `first` the unique newest match... both match; replace picks the newest
    const imp = imported("song", "band");
    imp.audio = [{ name: "new.ogg", role: "full", blob: new Blob(["n"]) }];
    const third = await store.saveImported(imp, { replaceDuplicate: true });
    expect(third.id).toBe(first.id);
    const kept = await store.getSong(third.id);
    expect(kept?.audio.map((a) => a.name)).toEqual(["new.ogg"]);
    expect(kept?.offsetMs).toBe(30);
    expect(kept?.bestScore).toBe(5);
  });

  it("surfaces quota errors as readable errors", async () => {
    const q = new DOMException("full", "QuotaExceededError");
    const store = createSongStore(memBackend({ failPut: q }));
    const err = await store.saveImported(imported("Big")).catch((e) => e);
    expect(err).toBeInstanceOf(SongStorageError);
    expect(err.kind).toBe("quota");
    expect(err.message).toMatch(/Not enough storage space/);
  });

  it("wraps other failures with context", async () => {
    const store = createSongStore(memBackend({ failPut: new Error("boom") }));
    const err = await store.saveImported(imported("X")).catch((e) => e);
    expect(err.kind).toBe("other");
    expect(err.message).toContain('save "X"');
    expect(err.message).toContain("boom");
  });
});

describe("idb backend", () => {
  it("does not open at creation and does not cache a rejected open", async () => {
    const open = vi.fn();
    open.mockRejectedValueOnce(new Error("blocked"));
    open.mockResolvedValueOnce({ getAll: async () => [], getAllKeys: async () => [] });
    const be = createSongIdbBackend("x", open as never);
    expect(open).not.toHaveBeenCalled();
    await expect(be.getAllSummaries()).rejects.toThrow("blocked");
    await expect(be.getAllSummaries()).resolves.toEqual([]);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("summaries, best scores, missing audio", () => {
  it("lists and finds duplicates from summaries without loading full records", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    await store.saveImported(imported("A"));
    await store.saveImported(imported("B"));
    const list = await store.listSongs();
    expect(list).toHaveLength(2);
    expect((await store.findDuplicate("a", "band"))?.title).toBe("A");
    expect(be.reads.fullRecords).toBe(0);
    expect(JSON.stringify(list)).not.toContain("timeSec");
  });

  it("keeps summaries in sync on patch and delete", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const s = await store.saveImported(imported());
    await store.setOffset(s.id, 15);
    await store.setBestScore(s.id, 700, "hard");
    expect(be.sums.get(s.id)).toMatchObject({ offsetMs: 15, bestScore: 700, bestByDifficulty: { hard: 700 } });
    await store.deleteSong(s.id);
    expect(be.sums.size).toBe(0);
    expect(be.recs.size).toBe(0);
  });

  it("migration: a v2 song stored without a summary is backfilled, nothing else touched", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const s = await store.saveImported(imported("Old"));
    be.sums.clear(); // as if written by schema v2
    const before = structuredClone(be.recs.get(s.id)!);
    const written: SongSummary[] = [];
    const n = await backfillSummaries({
      forEachSong: async (fn) => {
        for (const r of be.recs.values()) await fn(r);
      },
      putSummary: async (x) => {
        written.push(x);
        be.sums.set(x.id, x);
      },
    });
    expect(n).toBe(1);
    expect(written[0]).toMatchObject({ id: s.id, title: "Old", difficulties: ["expert"] });
    expect(written[0]).not.toHaveProperty("notesByDifficulty");
    expect(be.recs.get(s.id)).toEqual(before);
    expect((await store.listSongs()).map((x) => x.title)).toEqual(["Old"]);
  });

  it("repairs a missing summary lazily (interrupted migration)", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const s = await store.saveImported(imported("Lazy"));
    be.sums.delete(s.id);
    expect((await store.listSongs()).map((x) => x.title)).toEqual(["Lazy"]);
  });

  it("stores best scores per difficulty, only raising them", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const s = await store.saveImported(imported());
    await store.setBestScore(s.id, 500, "easy");
    await store.setBestScore(s.id, 300, "easy"); // lower: ignored
    await store.setBestScore(s.id, 900, "expert");
    const got = (await store.getSong(s.id))!;
    expect(got.bestByDifficulty).toEqual({ easy: 500, expert: 900 });
    expect(got.bestScore).toBe(900);
    expect(bestFor(got, "easy")).toBe(500);
    expect(bestFor(got, "medium")).toBe(0);
    expect(displayBest(got)).toEqual({ score: 900, difficulty: "expert" });
  });

  it("legacy songs: bestScore is the fallback until per-difficulty data exists", () => {
    const legacy = { bestScore: 1234 };
    expect(bestFor(legacy, "hard")).toBe(1234);
    expect(displayBest(legacy)).toEqual({ score: 1234 });
    expect(displayBest({})).toBeNull();
  });

  it("replaceDuplicate keeps bestByDifficulty", async () => {
    const store = createSongStore(memBackend());
    const a = await store.saveImported(imported());
    await store.setBestScore(a.id, 42, "medium");
    const b = await store.saveImported(imported(), { replaceDuplicate: true });
    expect(b.id).toBe(a.id);
    expect(b.bestByDifficulty).toEqual({ medium: 42 });
  });

  it("getSong reports stems whose blob is missing", async () => {
    const be = memBackend();
    const store = createSongStore(be);
    const s = await store.saveImported(imported());
    be.audio.delete(`${s.id}/song.ogg`);
    const got = (await store.getSong(s.id))!;
    expect(got.audio.map((a) => a.name)).toEqual(["drums.ogg"]);
    expect(got.missingAudio).toEqual(["song.ogg"]);
    const ok = (await store.getSong((await store.saveImported(imported("Other"))).id))!;
    expect(ok.missingAudio).toBeUndefined();
  });
});

describe("requestPersistentStorageOnce", () => {
  it("asks once, swallows errors and tolerates missing support", async () => {
    // Module-level flag: only the first call in this process reaches storage.
    const persist = vi.fn().mockRejectedValue(new Error("nope"));
    await requestPersistentStorageOnce({ persist });
    await requestPersistentStorageOnce({ persist });
    expect(persist).toHaveBeenCalledTimes(1);
    await expect(requestPersistentStorageOnce(undefined)).resolves.toBeUndefined();
  });
});
