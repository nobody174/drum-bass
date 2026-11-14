import { describe, expect, it } from "vitest";
import { formatBytes, getStorageUsage, requestPersistentStorage } from "./usage";

describe("storage usage", () => {
  it("reads usage, quota and the persisted flag", async () => {
    const u = await getStorageUsage({ estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => true });
    expect(u).toEqual({ usage: 10, quota: 100, persisted: true });
  });
  it("is null when unsupported or failing", async () => {
    expect(await getStorageUsage(undefined)).toBeNull();
    expect(await getStorageUsage({})).toBeNull();
    expect(await getStorageUsage({ estimate: async () => { throw new Error("no"); } })).toBeNull();
  });
  it("tolerates a failing persisted() call", async () => {
    const u = await getStorageUsage({ estimate: async () => ({ usage: 1, quota: 2 }), persisted: async () => { throw new Error("no"); } });
    expect(u).toEqual({ usage: 1, quota: 2, persisted: null });
  });
  it("persist request: true, false, unsupported", async () => {
    expect(await requestPersistentStorage({ persist: async () => true })).toBe(true);
    expect(await requestPersistentStorage({ persist: async () => { throw new Error("x"); } })).toBe(false);
    expect(await requestPersistentStorage({})).toBeNull();
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
  });
});
