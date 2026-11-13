import { describe, expect, it } from 'vitest';
import { createDefaultPreset, duplicatePreset, renamePreset } from './model';
import { createIdbBackend, createKitStore, kitStore, type KitBackend } from './store';
import type { KitPreset } from './types';

/** In-memory backend; clones on the way in/out like IndexedDB's structured clone. */
function memoryBackend(): KitBackend & { kits: Map<string, KitPreset>; meta: Map<string, string> } {
  const kits = new Map<string, KitPreset>();
  const meta = new Map<string, string>();
  return {
    kits,
    meta,
    async getAll() { return [...kits.values()].map((k) => structuredClone(k)); },
    async put(p) { kits.set(p.id, structuredClone(p)); },
    async remove(id) { kits.delete(id); },
    async getMeta(k) { return meta.get(k) ?? null; },
    async setMeta(k, v) { if (v === null) meta.delete(k); else meta.set(k, v); },
  };
}

describe('kit store', () => {
  it('does not touch indexedDB at import time (singleton exists)', () => {
    expect(kitStore).toBeDefined();
    expect(typeof kitStore.ensureDefault).toBe('function');
  });

  it('ensureDefault creates and activates the default preset when empty', async () => {
    const b = memoryBackend();
    const s = createKitStore(b);
    expect(await s.getActiveId()).toBeNull();
    const p = await s.ensureDefault();
    expect(p.name).toBe('Alesis Nitro Max');
    expect(await s.getActiveId()).toBe(p.id);
    expect((await s.listPresets()).length).toBe(1);
  });

  it('ensureDefault is idempotent, also when called concurrently', async () => {
    const s = createKitStore(memoryBackend());
    const [a, b] = await Promise.all([s.ensureDefault(), s.ensureDefault()]);
    const c = await s.ensureDefault();
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    expect((await s.listPresets()).length).toBe(1);
  });

  it('save / get round-trips and updates', async () => {
    const s = createKitStore(memoryBackend());
    const p = await s.ensureDefault();
    const renamed = renamePreset(p, 'Renamed');
    await s.savePreset(renamed);
    expect((await s.getPreset(p.id))?.name).toBe('Renamed');
    expect((await s.listPresets()).length).toBe(1);
    expect(await s.getPreset('missing')).toBeNull();
  });

  it('lists sorted by name', async () => {
    const s = createKitStore(memoryBackend());
    const p = await s.ensureDefault();
    await s.savePreset(duplicatePreset(p, 'Aaa'));
    await s.savePreset(duplicatePreset(p, 'Zzz'));
    expect((await s.listPresets()).map((x) => x.name)).toEqual(['Aaa', 'Alesis Nitro Max', 'Zzz']);
  });

  it('refuses to delete the last remaining preset', async () => {
    const s = createKitStore(memoryBackend());
    const p = await s.ensureDefault();
    expect(await s.deletePreset(p.id)).toBe(false);
    expect((await s.listPresets()).length).toBe(1);
  });

  it('deletes a non-last preset; unknown id is refused', async () => {
    const s = createKitStore(memoryBackend());
    const p = await s.ensureDefault();
    const c = duplicatePreset(p, 'Other');
    await s.savePreset(c);
    expect(await s.deletePreset('nope')).toBe(false);
    expect(await s.deletePreset(c.id)).toBe(true);
    expect((await s.listPresets()).map((x) => x.id)).toEqual([p.id]);
  });

  it('falls back to another preset when the active one is deleted', async () => {
    const s = createKitStore(memoryBackend());
    const p = await s.ensureDefault();
    const c = duplicatePreset(p, 'Other');
    await s.savePreset(c);
    await s.setActiveId(c.id);
    expect(await s.getActiveId()).toBe(c.id);
    await s.deletePreset(c.id);
    expect(await s.getActiveId()).toBe(p.id);
    expect((await s.ensureDefault()).id).toBe(p.id);
  });

  it('falls back when the stored active id points to a missing preset', async () => {
    const b = memoryBackend();
    const s = createKitStore(b);
    const p = await s.ensureDefault();
    b.meta.set('activeKitId', 'ghost');
    expect(await s.getActiveId()).toBe(p.id);
  });

  it('ensureDefault does not add a default when presets already exist', async () => {
    const b = memoryBackend();
    const existing = { ...createDefaultPreset(), name: 'Mine' };
    b.kits.set(existing.id, existing);
    const s = createKitStore(b);
    const p = await s.ensureDefault();
    expect(p.id).toBe(existing.id);
    expect((await s.listPresets()).length).toBe(1);
  });
});

describe('idb backend open caching', () => {
  const fakeDb = (): any => ({ getAll: async () => [], });
  it('does not cache a rejected open; the next call retries', async () => {
    let calls = 0;
    const b = createIdbBackend('t', () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(fakeDb())));
    await expect(b.getAll()).rejects.toThrow('boom');
    await expect(b.getAll()).resolves.toEqual([]);
    expect(calls).toBe(2);
  });
  it('reopens after the connection is closed/terminated', async () => {
    let calls = 0;
    let close: () => void = () => {};
    const b = createIdbBackend('t', (_n, onClose) => { calls++; close = onClose; return Promise.resolve(fakeDb()); });
    await b.getAll(); await b.getAll();
    expect(calls).toBe(1);
    close();
    await b.getAll();
    expect(calls).toBe(2);
  });
});
