import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'drum-bass';
export const DB_VERSION = 1;
/** Stores created by the upgrade handler. Later milestones add their stores here (and bump the version). */
export const STORES: { name: string; keyPath?: string }[] = [
  { name: 'kits', keyPath: 'id' },
  { name: 'meta' },
];

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
    upgrade(db) {
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s.name)) {
          db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined);
        }
      }
    },
  });
  return opened;
}
