import { openAppDb } from '../storage/db';
import { createDefaultPreset } from './model';
import type { KitPreset } from './types';

export interface KitBackend {
  getAll(): Promise<KitPreset[]>;
  put(p: KitPreset): Promise<void>;
  remove(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, v: string | null): Promise<void>;
}

/** IndexedDB backend. The DB is opened lazily on first call, never at import time. */
export function createIdbBackend(
  dbName = 'drum-bass',
  open: (name: string, onClose: () => void) => ReturnType<typeof openAppDb> = openAppDb,
): KitBackend {
  let dbp: ReturnType<typeof openAppDb> | null = null;
  const db = () => {
    if (!dbp) {
      const p: ReturnType<typeof openAppDb> = open(dbName, () => { if (dbp === p) dbp = null; });
      dbp = p;
      // Never cache a failed open: the next call (e.g. the UI's Retry) tries again.
      p.catch(() => { if (dbp === p) dbp = null; });
    }
    return dbp;
  };
  return {
    async getAll() {
      return (await db()).getAll('kits');
    },
    async put(p) {
      await (await db()).put('kits', p);
    },
    async remove(id) {
      await (await db()).delete('kits', id);
    },
    async getMeta(key) {
      return ((await (await db()).get('meta', key)) as string | undefined) ?? null;
    },
    async setMeta(key, v) {
      const d = await db();
      if (v === null) await d.delete('meta', key);
      else await d.put('meta', v, key);
    },
  };
}

const ACTIVE_KEY = 'activeKitId';

export interface KitStore {
  /** Sorted by name (stable order for the UI). */
  listPresets(): Promise<KitPreset[]>;
  getPreset(id: string): Promise<KitPreset | null>;
  savePreset(p: KitPreset): Promise<void>;
  /** Returns false (and does nothing) when it is the last remaining preset or does not exist. */
  deletePreset(id: string): Promise<boolean>;
  /** Active preset id, falling back to the first preset when the stored one is gone; null if empty. */
  getActiveId(): Promise<string | null>;
  setActiveId(id: string): Promise<void>;
  /** Creates + activates the default Nitro Max preset when empty. Returns the active preset. */
  ensureDefault(): Promise<KitPreset>;
}

export function createKitStore(backend: KitBackend): KitStore {
  const list = async () => {
    const all = await backend.getAll();
    return [...all].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  };

  const getActiveId = async (): Promise<string | null> => {
    const all = await list();
    if (all.length === 0) return null;
    const stored = await backend.getMeta(ACTIVE_KEY);
    if (stored && all.some((p) => p.id === stored)) return stored;
    const fallback = all[0]!.id;
    await backend.setMeta(ACTIVE_KEY, fallback);
    return fallback;
  };

  let ensuring: Promise<KitPreset> | null = null;
  const ensureOnce = async (): Promise<KitPreset> => {
    let all = await list();
    if (all.length === 0) {
      const d = createDefaultPreset();
      await backend.put(d);
      await backend.setMeta(ACTIVE_KEY, d.id);
      all = [d];
    }
    const id = (await getActiveId())!;
    return all.find((p) => p.id === id) ?? all[0]!;
  };

  return {
    listPresets: list,
    async getPreset(id) {
      return (await backend.getAll()).find((p) => p.id === id) ?? null;
    },
    savePreset: (p) => backend.put(p),
    async deletePreset(id) {
      const all = await backend.getAll();
      if (all.length <= 1 || !all.some((p) => p.id === id)) return false;
      await backend.remove(id);
      if ((await backend.getMeta(ACTIVE_KEY)) === id) await backend.setMeta(ACTIVE_KEY, null);
      return true;
    },
    getActiveId,
    setActiveId: (id) => backend.setMeta(ACTIVE_KEY, id),
    ensureDefault() {
      // Serialize concurrent calls so the default is only created once.
      const run = (ensuring ?? Promise.resolve()).catch(() => {}).then(ensureOnce);
      ensuring = run;
      return run;
    },
  };
}

/** Singleton on the IndexedDB backend. Nothing touches indexedDB until a method is called. */
export const kitStore: KitStore = createKitStore(createIdbBackend());
