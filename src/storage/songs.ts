import type { ChartFormat, Difficulty, ImportedSong, NoteEvent, SongMeta, StemRole } from "../chart/types";
import { openAppDb, summarizeRecord } from "./db";

export interface StoredSong {
  id: string;
  title: string;
  artist: string;
  meta: SongMeta;
  format: ChartFormat;
  notesByDifficulty: Partial<Record<Difficulty, NoteEvent[]>>;
  audio: { name: string; role: StemRole; blob: Blob }[];
  /** User alignment of chart vs audio (ms), on top of meta.delayMs. */
  offsetMs: number;
  addedAt: number;
  /** Legacy single best (no difficulty). Kept for old data; now also the max over bestByDifficulty. */
  bestScore?: number;
  /** Best score per difficulty (scores of different difficulties are not comparable). */
  bestByDifficulty?: Partial<Record<Difficulty, number>>;
  /** Set by getSong only (never persisted): stems listed in the record whose audio blob is missing. */
  missingAudio?: string[];
}

/** Library row: everything except the notes and the audio blobs. */
export interface SongSummary {
  id: string;
  title: string;
  artist: string;
  meta: SongMeta;
  format: ChartFormat;
  difficulties: Difficulty[];
  stems: { name: string; role: StemRole }[];
  offsetMs: number;
  addedAt: number;
  bestScore?: number;
  bestByDifficulty?: Partial<Record<Difficulty, number>>;
}

/** What is persisted in the 'songs' store (audio lives in 'songAudio'). */
export type SongRecord = Omit<StoredSong, "audio" | "missingAudio"> & { stems: { name: string; role: StemRole }[] };

export interface SongBackend {
  /** Lightweight summaries (no notes, no blobs). Repairs missing summaries of pre-v3 songs. */
  getAllSummaries(): Promise<SongSummary[]>;
  getRecord(id: string): Promise<SongRecord | null>;
  /** Writes the record, its summary and its audio blobs atomically (all or nothing), replacing any earlier audio of that id. */
  putSong(rec: SongRecord, audio: { name: string; blob: Blob }[]): Promise<void>;
  getAudio(id: string): Promise<{ name: string; blob: Blob }[]>;
  /**
   * Read-modify-write of an existing record (and its summary) in one transaction; `fn` returns the fields
   * to merge. False if the song does not exist.
   */
  patchRecord(
    id: string,
    fn: (cur: SongRecord) => Partial<Pick<SongRecord, "offsetMs" | "bestScore" | "bestByDifficulty">>,
  ): Promise<boolean>;
  deleteSong(id: string): Promise<void>;
}

/** Readable storage failure; `kind === "quota"` when the device is out of space. */
export class SongStorageError extends Error {
  constructor(
    message: string,
    readonly kind: "quota" | "other",
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "SongStorageError";
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

function isQuota(e: unknown): boolean {
  const x = e as { name?: string; code?: number; message?: string } | null;
  return (
    x?.name === "QuotaExceededError" ||
    x?.code === 22 ||
    /quota|not enough (space|storage)|disk full/i.test(x?.message ?? "")
  );
}

function wrap(e: unknown, action: string): SongStorageError {
  if (e instanceof SongStorageError) return e;
  if (isQuota(e)) {
    return new SongStorageError(
      `Not enough storage space to ${action}. Delete some songs or free up space on the device and try again.`,
      "quota",
      { cause: e },
    );
  }
  const msg = (e as Error)?.message || String(e);
  return new SongStorageError(`Could not ${action}: ${msg}`, "other", { cause: e });
}

const audioKey = (id: string, name: string) => `${id}/${name}`;

/** IndexedDB backend. The DB is opened lazily on first call; a failed open is never cached. */
export function createSongIdbBackend(
  dbName = "drum-bass",
  open: (name: string, onClose: () => void) => ReturnType<typeof openAppDb> = openAppDb,
): SongBackend {
  let dbp: ReturnType<typeof openAppDb> | null = null;
  const db = () => {
    if (!dbp) {
      const p: ReturnType<typeof openAppDb> = open(dbName, () => {
        if (dbp === p) dbp = null;
      });
      dbp = p;
      p.catch(() => {
        if (dbp === p) dbp = null;
      });
    }
    return dbp;
  };
  const rangeFor = (id: string) => IDBKeyRange.bound(`${id}/`, `${id}/￿`);
  return {
    async getAllSummaries() {
      const d = await db();
      const summaries = (await d.getAll("songMeta")) as SongSummary[];
      // Repair: a song without a summary (e.g. the upgrade backfill was interrupted) is summarized now.
      const have = new Set(summaries.map((x) => x.id));
      const missing = ((await d.getAllKeys("songs")) as string[]).filter((k) => !have.has(k));
      for (const id of missing) {
        const rec = (await d.get("songs", id)) as SongRecord | undefined;
        if (!rec) continue;
        const sum = summarizeRecord(rec);
        await d.put("songMeta", sum);
        summaries.push(sum);
      }
      return summaries;
    },
    async getRecord(id) {
      return ((await (await db()).get("songs", id)) as SongRecord | undefined) ?? null;
    },
    async putSong(rec, audio) {
      const tx = (await db()).transaction(["songs", "songMeta", "songAudio"], "readwrite");
      const audioStore = tx.objectStore("songAudio");
      // Replace semantics: drop any older blobs of this id in the same transaction.
      const cleared = audioStore.delete(rangeFor(rec.id));
      await Promise.all([
        cleared,
        tx.objectStore("songs").put(rec),
        tx.objectStore("songMeta").put(summarizeRecord(rec)),
        ...audio.map((a) => audioStore.put({ songId: rec.id, name: a.name, blob: a.blob }, audioKey(rec.id, a.name))),
        tx.done,
      ]);
    },
    async getAudio(id) {
      const rows = (await (await db()).getAll("songAudio", rangeFor(id))) as { name: string; blob: Blob }[];
      return rows.map((r) => ({ name: r.name, blob: r.blob }));
    },
    async patchRecord(id, fn) {
      const tx = (await db()).transaction(["songs", "songMeta"], "readwrite");
      const cur = (await tx.objectStore("songs").get(id)) as SongRecord | undefined;
      if (!cur) {
        await tx.done;
        return false;
      }
      const next = { ...cur, ...fn(cur) };
      await Promise.all([tx.objectStore("songs").put(next), tx.objectStore("songMeta").put(summarizeRecord(next)), tx.done]);
      return true;
    },
    async deleteSong(id) {
      const tx = (await db()).transaction(["songs", "songMeta", "songAudio"], "readwrite");
      await Promise.all([tx.objectStore("songs").delete(id), tx.objectStore("songMeta").delete(id), tx.objectStore("songAudio").delete(rangeFor(id)), tx.done]);
    },
  };
}

export interface SongStore {
  /** Metadata only (no notes, no blobs), newest first. */
  listSongs(): Promise<SongSummary[]>;
  /** Full song including audio blobs, or null. */
  getSong(id: string): Promise<StoredSong | null>;
  /** Existing song with the same title + artist (case/space-insensitive), if any. */
  findDuplicate(title: string, artist: string): Promise<SongSummary | null>;
  /**
   * Saves an imported song. With `replaceDuplicate`, a song with the same title+artist is
   * overwritten in place (same id; its offsetMs and bestScore are kept).
   */
  saveImported(imported: ImportedSong, opts?: { replaceDuplicate?: boolean }): Promise<StoredSong>;
  deleteSong(id: string): Promise<void>;
  setOffset(id: string, ms: number): Promise<void>;
  /**
   * Records `score` as a best only if it beats the stored best for `difficulty` (raises, never lowers).
   * Without a difficulty only the legacy overall `bestScore` is touched.
   */
  setBestScore(id: string, score: number, difficulty?: Difficulty): Promise<void>;
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

type Bests = { bestScore?: number; bestByDifficulty?: Partial<Record<Difficulty, number>> };

/** Best score for one difficulty; the legacy single `bestScore` is the fallback for songs without per-difficulty data. */
export function bestFor(s: Bests, d: Difficulty): number {
  if (s.bestByDifficulty) return s.bestByDifficulty[d] ?? 0;
  return s.bestScore ?? 0;
}

const DIFF_ORDER: Difficulty[] = ["easy", "medium", "hard", "expert"];

/** Library label: the best score of the HIGHEST difficulty that has one (scores across difficulties are not comparable). */
export function displayBest(s: Bests): { score: number; difficulty?: Difficulty } | null {
  for (const d of [...DIFF_ORDER].reverse()) {
    const v = s.bestByDifficulty?.[d];
    if (v) return { score: v, difficulty: d };
  }
  return s.bestScore ? { score: s.bestScore } : null;
}

/** Makes stem names unique within one song (they form the storage key). */
function uniqueNames(audio: ImportedSong["audio"]): { name: string; role: StemRole; blob: Blob }[] {
  const seen = new Map<string, number>();
  return audio.map((a) => {
    const n = seen.get(a.name) ?? 0;
    seen.set(a.name, n + 1);
    return { name: n === 0 ? a.name : `${a.name} (${n + 1})`, role: a.role, blob: a.blob };
  });
}

export function createSongStore(backend: SongBackend): SongStore {
  const records = async () => (await backend.getAllSummaries()).sort((a, b) => b.addedAt - a.addedAt || a.id.localeCompare(b.id));
  const guard = async <T>(action: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw wrap(e, action);
    }
  };

  return {
    listSongs: () => guard("load the song library", async () => await records()),

    getSong: (id) =>
      guard("load the song", async () => {
        const rec = await backend.getRecord(id);
        if (!rec) return null;
        const blobs = new Map((await backend.getAudio(id)).map((a) => [a.name, a.blob]));
        const audio = rec.stems.flatMap((s) => {
          const blob = blobs.get(s.name);
          return blob ? [{ name: s.name, role: s.role, blob }] : [];
        });
        // Surfaced, not hidden: the UI tells the user which stems are gone.
        const missingAudio = rec.stems.filter((s) => !blobs.has(s.name)).map((s) => s.name);
        const { stems: _stems, ...rest } = rec;
        return missingAudio.length ? { ...rest, audio, missingAudio } : { ...rest, audio };
      }),

    findDuplicate: (title, artist) =>
      guard("check the library", async () => {
        return (await records()).find((x) => norm(x.title) === norm(title) && norm(x.artist) === norm(artist)) ?? null;
      }),

    saveImported: (imp, opts) =>
      guard(`save "${imp.meta.title}"`, async () => {
        const dup = opts?.replaceDuplicate
          ? (await records()).find((x) => norm(x.title) === norm(imp.meta.title) && norm(x.artist) === norm(imp.meta.artist))
          : undefined;
        const audio = uniqueNames(imp.audio);
        const rec: SongRecord = {
          id: dup?.id ?? newId(),
          title: imp.meta.title,
          artist: imp.meta.artist,
          meta: imp.meta,
          format: imp.format,
          notesByDifficulty: imp.notesByDifficulty,
          stems: audio.map((a) => ({ name: a.name, role: a.role })),
          offsetMs: dup?.offsetMs ?? 0,
          addedAt: dup?.addedAt ?? Date.now(),
        };
        if (dup?.bestScore !== undefined) rec.bestScore = dup.bestScore;
        if (dup?.bestByDifficulty !== undefined) rec.bestByDifficulty = dup.bestByDifficulty;
        await backend.putSong(rec, audio);
        const { stems: _s, ...rest } = rec;
        return { ...rest, audio };
      }),

    deleteSong: (id) => guard("delete the song", () => backend.deleteSong(id)),

    setOffset: (id, ms) =>
      guard("save the offset", async () => {
        if (!Number.isFinite(ms)) throw new Error("offset must be a finite number of milliseconds");
        await backend.patchRecord(id, () => ({ offsetMs: Math.round(ms) }));
      }),

    setBestScore: (id, score, difficulty) =>
      guard("save the score", async () => {
        if (!Number.isFinite(score)) throw new Error("score must be a finite number");
        await backend.patchRecord(id, (cur) => {
          if (!difficulty) return { bestScore: Math.max(cur.bestScore ?? 0, score) };
          const prev = cur.bestByDifficulty?.[difficulty] ?? 0;
          if (score <= prev) return {};
          return {
            bestByDifficulty: { ...cur.bestByDifficulty, [difficulty]: score },
            bestScore: Math.max(cur.bestScore ?? 0, score),
          };
        });
      }),
  };
}

let singleton: SongStore | null = null;
const lazy = (): SongStore => (singleton ??= createSongStore(createSongIdbBackend()));

/** Lazy singleton on IndexedDB: nothing is opened until a method is called. */
export const songStore: SongStore = {
  listSongs: () => lazy().listSongs(),
  getSong: (id) => lazy().getSong(id),
  findDuplicate: (t, a) => lazy().findDuplicate(t, a),
  saveImported: (i, o) => lazy().saveImported(i, o),
  deleteSong: (id) => lazy().deleteSong(id),
  setOffset: (id, ms) => lazy().setOffset(id, ms),
  setBestScore: (id, s, d) => lazy().setBestScore(id, s, d),
};

let persistAsked = false;
/**
 * Asks the browser once to make storage persistent (less likely to be evicted). Call after the first
 * successful import. Silent when unsupported or refused.
 */
export async function requestPersistentStorageOnce(
  storage: Pick<StorageManager, "persist"> | undefined = typeof navigator !== "undefined" ? navigator.storage : undefined,
): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    await storage?.persist?.();
  } catch {
    /* unsupported: nothing to surface */
  }
}
