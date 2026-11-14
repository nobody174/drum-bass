import { describe, expect, it } from 'vitest';
import { createDefaultPreset, duplicatePreset, movePiece, renamePreset } from './model';
import { MIGRATION_META_KEY, NITRO_MAX_EXTRA_NAME, OLD_DEFAULT_PIECES, isOldDefaultKit } from './migrate';
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

describe('migration to the real Nitro Max kit', () => {
  const oldDefault = (): KitPreset => ({
    id: 'old-1',
    name: 'Alesis Nitro Max',
    pieces: structuredClone(OLD_DEFAULT_PIECES) as KitPreset['pieces'],
    locked: false,
    mirrored: false,
    updatedAt: 1,
  });

  it('recognises the frozen old default', () => {
    expect(isOldDefaultKit(oldDefault())).toBe(true);
    expect(isOldDefaultKit(createDefaultPreset())).toBe(false);
  });

  it('upgrades an unmodified old default in place and keeps it active', async () => {
    const b = memoryBackend();
    const old = oldDefault();
    b.kits.set(old.id, old);
    b.meta.set('activeKitId', old.id);
    const s = createKitStore(b);
    const active = await s.ensureDefault();
    expect(active.id).toBe('old-1');
    expect(active.name).toBe('Alesis Nitro Max');
    expect(active.template).toEqual({ id: 'nitro-max', version: 2 });
    expect(active.pieces.map((p) => p.id)).not.toContain('crash2');
    expect(active.pieces.find((p) => p.id === 'snare')!.midiNotes.rim).toBe(40);
    expect(await s.getActiveId()).toBe('old-1');
    expect((await s.listPresets()).length).toBe(1);
    expect(b.meta.get(MIGRATION_META_KEY)).toBe('2');
  });

  it('never touches a modified preset; adds the real kit as an extra one', async () => {
    const b = memoryBackend();
    const mod = movePiece(oldDefault(), 'snare', 0.35, 0.6);
    b.kits.set(mod.id, structuredClone(mod));
    const s = createKitStore(b);
    const active = await s.ensureDefault();
    expect(active.id).toBe('old-1');
    expect(await s.getPreset('old-1')).toEqual(mod);
    const names = (await s.listPresets()).map((p) => p.name);
    expect(names).toEqual(['Alesis Nitro Max', NITRO_MAX_EXTRA_NAME].sort((a, c) => a.localeCompare(c)));
    const extra = (await s.listPresets()).find((p) => p.name === NITRO_MAX_EXTRA_NAME)!;
    expect(extra.template?.version).toBe(2);
    expect(extra.pieces.length).toBe(8);
  });

  it('never touches renamed or already templated presets', async () => {
    const b = memoryBackend();
    const renamed = { ...oldDefault(), id: 'r', name: 'My kit' };
    const fresh = { ...createDefaultPreset(), id: 'n' };
    b.kits.set('r', structuredClone(renamed));
    b.kits.set('n', structuredClone(fresh));
    const s = createKitStore(b);
    expect((await s.migrate()).replacedIds).toEqual([]);
    expect(await s.getPreset('r')).toEqual(renamed);
    expect(await s.getPreset('n')).toEqual(fresh);
    expect((await s.listPresets()).length).toBe(2);
  });

  it('is idempotent: the second run is a no-op', async () => {
    const b = memoryBackend();
    const mod = movePiece(oldDefault(), 'snare', 0.35, 0.6);
    b.kits.set(mod.id, structuredClone(mod));
    const s = createKitStore(b);
    const first = await s.migrate();
    expect(first.skipped).toBe(false);
    expect(first.addedIds.length).toBe(1);
    const snapshot = JSON.stringify([...b.kits.values()]);
    const second = await s.migrate();
    expect(second).toEqual({ skipped: true, replacedIds: [], addedIds: [] });
    await s.ensureDefault();
    expect(JSON.stringify([...b.kits.values()])).toBe(snapshot);
    expect((await s.listPresets()).length).toBe(2);
  });

  it('a fresh install records the migration as done', async () => {
    const b = memoryBackend();
    await createKitStore(b).ensureDefault();
    expect(b.meta.get(MIGRATION_META_KEY)).toBe('2');
  });
});
