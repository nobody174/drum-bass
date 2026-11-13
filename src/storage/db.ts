import { openDB, type IDBPDatabase } from 'idb';
import type { Difficulty } from '../chart/types';
import type { SongRecord, SongSummary } from './songs';

export const DB_NAME = 'drum-bass';
export const DB_VERSION = 3;
/** Stores created by the upgrade handler. Later milestones add their stores here (and bump the version). */
export const STORES: { name: string; keyPath?: string }[] = [
  { name: 'kits', keyPath: 'id' },
  { name: 'meta' },
  // v2 (M2): song records (metadata + charts) and, separately, audio blobs keyed "<songId>/<name>".
  { name: 'songs', keyPath: 'id' },
  { name: 'songAudio' },
  // v3: lightweight per-song summaries (no note arrays, no blobs) so the library never loads charts.
  { name: 'songMeta', keyPath: 'id' },
];

/** Library row for a stored record: everything except the notes and the audio blobs. */
export function summarizeRecord(r: SongRecord): SongSummary {
  const difficulties = (Object.keys(r.notesByDifficulty) as Difficulty[]).filter(
    (d) => (r.notesByDifficulty[d]?.length ?? 0) > 0,
  );
  const s: SongSummary = {
    id: r.id,
    title: r.title,
    artist: r.artist,
    meta: r.meta,
    format: r.format,
    difficulties,
    stems: r.stems,
    offsetMs: r.offsetMs,
    addedAt: r.addedAt,
  };
  if (r.bestScore !== undefined) s.bestScore = r.bestScore;
  if (r.bestByDifficulty !== undefined) s.bestByDifficulty = r.bestByDifficulty;
  return s;
}

/** Minimal store surface used by the migration (satisfied by idb stores). */
export interface MigrationStores {
  forEachSong(fn: (rec: SongRecord) => void | Promise<void>): Promise<void>;
  putSummary(s: SongSummary): Promise<unknown>;
}

/** v2 -> v3: builds a summary for every stored song. Songs, audio and kits are not modified. */
export async function backfillSummaries(st: MigrationStores): Promise<number> {
  let n = 0;
  await st.forEachSong(async (rec) => {
    await st.putSummary(summarizeRecord(rec));
    n++;
  });
  return n;
}

/** Opens the shared app database, creating any missing store. Touches indexedDB only when called. */
export function openAppDb(dbName: string = DB_NAME, onClose?: () => void): Promise<IDBPDatabase> {
  const opened: Promise<IDBPDatabase> = openDB(dbName, DB_VERSION, {
    // Another tab wants to upgrade/delete: release our connection and let the owner reopen later.
    blocking() {
      void opened.then((d) => d.close()).catch(() => {});
      onClose?.();
    },
    // The browser killed the connection (storage cleared, disk error, ...).
    terminated() {
      onClose?.();
    },
    upgrade(db, oldVersion, _newVersion, tx) {
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s.name)) {
          db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
        }
      }
      if (oldVersion < 3) {
        // Runs inside the versionchange transaction; one record is in memory at a time.
        const songs = tx.objectStore('songs');
        const meta = tx.objectStore('songMeta');
        void backfillSummaries({
          async forEachSong(fn) {
            let cur = await songs.openCursor();
            while (cur) {
              await fn(cur.value as SongRecord);
              cur = await cur.continue();
            }
          },
          putSummary: (s) => meta.put(s),
        });
      }
    },
  });
  return opened;
}
