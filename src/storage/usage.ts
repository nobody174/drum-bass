/** Storage usage / persistence helpers (navigator.storage). Everything is best effort: unsupported = null. */

export interface StorageUsage {
  /** Bytes used by this origin (estimate), or null when the browser does not say. */
  usage: number | null;
  /** Bytes the browser lets this origin use (estimate), or null. */
  quota: number | null;
  /** True when the browser promised not to evict the data; null when it cannot tell. */
  persisted: boolean | null;
}

type StorageLike = Partial<Pick<StorageManager, "estimate" | "persisted" | "persist">>;

const defaultStorage = (): StorageLike | undefined => (typeof navigator !== "undefined" ? navigator.storage : undefined);

/** Returns null when the API is missing or fails: the UI then hides the usage line. */
export async function getStorageUsage(storage: StorageLike | undefined = defaultStorage()): Promise<StorageUsage | null> {
  if (!storage || typeof storage.estimate !== "function") return null;
  try {
    const est = await storage.estimate();
    const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    let persisted: boolean | null = null;
    try {
      if (typeof storage.persisted === "function") persisted = await storage.persisted();
    } catch {
      /* unknown */
    }
    const usage = fin(est.usage);
    const quota = fin(est.quota);
    if (usage === null && quota === null) return null;
    return { usage, quota, persisted };
  } catch {
    return null;
  }
}

/** True = granted, false = refused or failed, null = unsupported. */
export async function requestPersistentStorage(storage: StorageLike | undefined = defaultStorage()): Promise<boolean | null> {
  if (!storage || typeof storage.persist !== "function") return null;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
