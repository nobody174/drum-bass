/**
 * Data export / import / clear (M4, SPEC section 8 "Data").
 *
 * Zip layout (schemaVersion 1):
 *   manifest.json                      app id, schemaVersion, createdAt, counts
 *   kits.json                          { kits: KitPreset[] }
 *   settings.json                      { app, sound, display?, approach? }
 *   songs/<dir>/song.json              a SongRecord (notes + metadata)
 *   songs/<dir>/audio/<index>.<ext>    stem i of song.json's `stems`, bytes exactly as stored
 *
 * Export builds the zip incrementally (fflate Zip streaming API): audio is read in 1 MB slices, pushed
 * through ZipPassThrough (stored, never recompressed) and flushed into Blob parts, so peak memory stays
 * around one slice plus the not-yet-flushed tail instead of the whole archive twice.
 *
 * Import treats the zip as UNTRUSTED. `inspectBackup` does ALL validation and writes nothing; only
 * `applyBackup` writes. Rules (same spirit as chart/importSong.ts): entry cap, declared sizes checked from
 * the central directory BEFORE inflating, unsafe names reject the whole zip, a fixed name grammar, strict
 * JSON schema checks that rebuild every object from known fields, and no eval anywhere.
 */
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from "fflate";
import { readBytes } from "../chart/bytes";
import type { ChartFormat, Difficulty, NoteEvent, StemRole } from "../chart/types";
import type { TempoPoint } from "../chart/tempo";
import { MAX_SIZE, MIN_SIZE, movePiece, PIECE_LIMITS, PIECE_ORDER, pieceGroup, resizePiece, uniqueName } from "../kit/model";
import { createIdbBackend, kitStore, type KitBackend } from "../kit/store";
import type { KitPiece, KitPreset, PieceId, PieceKind } from "../kit/types";
import { DEFAULT_SOUND_SETTINGS, getSoundSettings, updateSoundSettings, type SoundSettings } from "../audio";
import { MAX_APPROACH_SEC, MIN_APPROACH_SEC } from "../render/kitGeometry";
import { DEFAULT_SETTINGS, settingsStore, type AppSettings } from "../settings/store";
import { APPROACH_KEY, DISPLAY_KEY, loadApproach, loadDisplayMode, saveApproach, saveDisplayMode, type DisplayMode } from "../ui/play/params";
import { createSongIdbBackend, type SongBackend, type SongRecord } from "./songs";

export const BACKUP_APP_ID = "drum-bass";
export const BACKUP_FORMAT = "drum-bass-backup";
export const BACKUP_SCHEMA_VERSION = 1;

/**
 * Largest "everything" export (audio bytes + overhead) and largest zip / declared unpacked size we accept.
 * Import reads the whole zip into memory (unzipSync), so this is kept phone-safe; export uses the same cap so
 * a backup this app writes can always be read back.
 */
export const MAX_BACKUP_BYTES = 200 * 1024 ** 2;
/** From this size the UI warns that a phone with little memory may fail to import. */
export const WARN_BACKUP_BYTES = 100 * 1024 ** 2;
export const MAX_ENTRIES = 5000;
export const MAX_SONGS = 2000;
export const MAX_KITS = 500;
const MAX_TOTAL_JSON_BYTES = 128 * 1024 ** 2;
const JSON_CAPS = { manifest: 64 * 1024, settings: 64 * 1024, kits: 8 * 1024 ** 2, song: 32 * 1024 ** 2 };
const SLICE = 1024 * 1024;
const FLUSH_BYTES = 8 * 1024 ** 2;
const ACTIVE_KIT_META_KEY = "activeKitId"; // same literal as kit/store.ts (private there)

export interface BackupLimits {
  maxBytes: number;
  maxEntries: number;
}
export const DEFAULT_BACKUP_LIMITS: BackupLimits = { maxBytes: MAX_BACKUP_BYTES, maxEntries: MAX_ENTRIES };

/** Readable failure. `invalid` = the file is not a usable backup, `too-large`, `quota` = device full. */
export class BackupError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid" | "too-large" | "quota" | "other" = "invalid",
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "BackupError";
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

function isQuota(e: unknown): boolean {
  const x = e as { name?: string; code?: number; message?: string; kind?: string } | null;
  return (
    x?.kind === "quota" ||
    x?.name === "QuotaExceededError" ||
    x?.code === 22 ||
    /quota|not enough (space|storage)|disk full/i.test(x?.message ?? "")
  );
}

function readable(e: unknown, action: string): BackupError {
  if (e instanceof BackupError) return e;
  if (isQuota(e)) {
    return new BackupError(
      `Not enough storage space to ${action}. Free up space on the device (or delete songs) and try again. Nothing already saved was removed.`,
      "quota",
      { cause: e },
    );
  }
  return new BackupError(`Could not ${action}: ${(e as Error)?.message || String(e)}`, "other", { cause: e });
}

// ---- dependencies ---------------------------------------------------------

export interface SettingsBundle {
  app: AppSettings;
  sound: SoundSettings;
  display: DisplayMode;
  approach: number;
}
/** What settings import may carry: every part optional. */
export type SettingsPatch = Partial<{ app: Partial<AppSettings>; sound: Partial<SoundSettings>; display: DisplayMode; approach: number }>;

export interface SettingsIO {
  read(): SettingsBundle;
  apply(p: SettingsPatch): void;
  /** Back to defaults (also removes the display/approach keys). */
  reset(): void;
}

export interface BackupDeps {
  kits: KitBackend;
  /** Recreates the default preset when there is none (kitStore.ensureDefault). */
  ensureDefaultKit(): Promise<unknown>;
  songs: SongBackend;
  settings: SettingsIO;
}

export const defaultSettingsIO: SettingsIO = {
  read: () => ({
    app: { ...settingsStore.get() },
    sound: { ...getSoundSettings() },
    display: loadDisplayMode(),
    approach: loadApproach(),
  }),
  apply(p) {
    if (p.app) settingsStore.set(p.app);
    if (p.sound) updateSoundSettings(p.sound);
    if (p.display) saveDisplayMode(p.display);
    if (p.approach !== undefined) saveApproach(p.approach);
  },
  reset() {
    settingsStore.set({ ...DEFAULT_SETTINGS });
    updateSoundSettings({ ...DEFAULT_SOUND_SETTINGS });
    try {
      localStorage.removeItem(DISPLAY_KEY);
      localStorage.removeItem(APPROACH_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

let depsSingleton: BackupDeps | null = null;
/**
 * The app's real stores. Own lazy IndexedDB connections (nothing opens at import time); the database
 * itself is never deleted, only records, so other open connections are not blocked.
 */
export function defaultBackupDeps(): BackupDeps {
  return (depsSingleton ??= {
    kits: createIdbBackend(),
    ensureDefaultKit: () => kitStore.ensureDefault(),
    songs: createSongIdbBackend(),
    settings: defaultSettingsIO,
  });
}

export type Progress = (p: { phase: string; done: number; total: number }) => void;

// ---- small helpers --------------------------------------------------------

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const AUDIO_EXT = new Set(["ogg", "opus", "mp3", "wav", "m4a", "aac", "flac", "bin"]);
const MIME: Record<string, string> = {
  ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
};
const MIME_EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac",
};

function audioExt(stemName: string, blobType: string): string {
  const i = stemName.lastIndexOf(".");
  const e = i >= 0 ? stemName.slice(i + 1).toLowerCase() : "";
  if (AUDIO_EXT.has(e) && e !== "bin") return e;
  return MIME_EXT[blobType] ?? "bin";
}

const SAFE_DIR = /^[A-Za-z0-9._-]{1,100}$/;
const SAFE_SONG_ID = SAFE_DIR;
const onlyDots = (s: string) => /^\.+$/.test(s);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function isUnsafeName(name: string): boolean {
  if (CONTROL.test(name) || name.includes("\\")) return true;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return true;
  return name.split("/").some((seg) => seg === "..");
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export function backupFilename(mode: ExportMode, now: Date = new Date()): string {
  const d = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return `drum-bass-${mode === "everything" ? "everything" : "kits-settings"}-${d}.zip`;
}

// ---- export ---------------------------------------------------------------

export type ExportMode = "light" | "everything";

export interface ExportPlan {
  kits: number;
  songs: number;
  audioFiles: number;
  audioBytes: number;
  /** Everything-mode would exceed MAX_BACKUP_BYTES. */
  tooLarge: boolean;
}

/** Cheap sizing pass for the UI (reads blob handles, not blob contents). */
export async function planExport(deps: BackupDeps = defaultBackupDeps(), limits: BackupLimits = DEFAULT_BACKUP_LIMITS): Promise<ExportPlan> {
  try {
    const kits = (await deps.kits.getAll()).length;
    const sums = await deps.songs.getAllSummaries();
    let audioFiles = 0;
    let audioBytes = 0;
    for (const s of sums) {
      for (const a of await deps.songs.getAudio(s.id)) {
        audioFiles++;
        audioBytes += a.blob.size;
      }
    }
    return { kits, songs: sums.length, audioFiles, audioBytes, tooLarge: audioBytes > limits.maxBytes };
  } catch (e) {
    throw readable(e, "read your data");
  }
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  counts: { kits: number; songs: number; audioFiles: number };
  warnings: string[];
}

export interface ExportOptions {
  onProgress?: Progress;
  now?: Date;
  limits?: BackupLimits;
}

/** Collects zip output into Blob parts so the bytes can leave JS memory while the zip is still being built. */
function createSink() {
  const parts: BlobPart[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let total = 0;
  const flush = () => {
    if (pending.length) parts.push(new Blob(pending as BlobPart[]));
    pending = [];
    pendingBytes = 0;
  };
  return {
    add(chunk: Uint8Array) {
      if (!chunk.length) return;
      pending.push(chunk);
      pendingBytes += chunk.length;
      total += chunk.length;
      if (pendingBytes >= FLUSH_BYTES) flush();
    },
    get total() {
      return total;
    },
    finish(type: string): Blob {
      flush();
      return new Blob(parts, { type });
    },
  };
}

const tooLargeMessage = (bytes: number, limit: number) =>
  `The audio is ${(bytes / 1024 ** 2).toFixed(0)} MB, more than the ${Math.round(limit / 1024 ** 2)} MB limit for one backup file. ` +
  `Export "Kits and settings only", or delete some songs first.`;

export async function exportBackup(
  mode: ExportMode,
  deps: BackupDeps = defaultBackupDeps(),
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const limits = opts.limits ?? DEFAULT_BACKUP_LIMITS;
  const now = opts.now ?? new Date();
  const progress = opts.onProgress ?? (() => {});
  const warnings: string[] = [];
  try {
    const kits = [...(await deps.kits.getAll())].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const sums = mode === "everything" ? await deps.songs.getAllSummaries() : [];
    if (sums.length > MAX_SONGS) throw new BackupError(`Too many songs for one backup (limit ${MAX_SONGS}).`, "too-large");

    // Plan first: refuse before building anything.
    let audioTotal = 0;
    for (const s of sums) for (const a of await deps.songs.getAudio(s.id)) audioTotal += a.blob.size;
    if (audioTotal > limits.maxBytes) throw new BackupError(tooLargeMessage(audioTotal, limits.maxBytes), "too-large");

    let zipError: unknown = null;
    let done: (() => void) | null = null;
    const finished = new Promise<void>((res) => (done = res));
    const sink = createSink();
    const zip = new Zip((err, chunk, final) => {
      if (err) zipError = err;
      else sink.add(chunk);
      if (final || err) done?.();
    });
    const addJson = (name: string, value: unknown) => {
      const f = new ZipDeflate(name, { level: 6 });
      zip.add(f);
      f.push(strToU8(JSON.stringify(value)), true);
    };

    const dirs = new Set<string>();
    const counts = { kits: kits.length, songs: 0, audioFiles: 0 };
    const songParts: { dir: string; rec: SongRecord }[] = [];
    for (const s of sums) {
      const rec = await deps.songs.getRecord(s.id);
      if (!rec) {
        warnings.push(`Song "${s.title}" disappeared while exporting and was skipped.`);
        continue;
      }
      let dir = SAFE_SONG_ID.test(rec.id) && !onlyDots(rec.id) ? rec.id : `s${songParts.length + 1}`;
      while (dirs.has(dir)) dir = `${dir}_${songParts.length + 1}`;
      dirs.add(dir);
      songParts.push({ dir, rec });
    }

    // manifest first so a truncated file is still recognizable.
    addJson("manifest.json", {
      format: BACKUP_FORMAT,
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: now.toISOString(),
      includesSongs: mode === "everything",
      counts: { kits: kits.length, songs: songParts.length },
    });
    addJson("kits.json", { kits });
    addJson("settings.json", deps.settings.read());

    let n = 0;
    for (const { dir, rec } of songParts) {
      progress({ phase: `Packing "${rec.title}"`, done: n, total: songParts.length });
      addJson(`songs/${dir}/song.json`, rec);
      const blobs = new Map((await deps.songs.getAudio(rec.id)).map((a) => [a.name, a.blob]));
      for (let i = 0; i < rec.stems.length; i++) {
        const stem = rec.stems[i]!;
        const blob = blobs.get(stem.name);
        if (!blob) {
          warnings.push(`"${rec.title}": audio "${stem.name}" is missing on this device and was not included.`);
          continue;
        }
        const f = new ZipPassThrough(`songs/${dir}/audio/${i}.${audioExt(stem.name, blob.type)}`);
        zip.add(f);
        if (blob.size === 0) f.push(new Uint8Array(0), true);
        for (let off = 0; off < blob.size; off += SLICE) {
          const end = Math.min(off + SLICE, blob.size);
          f.push(await readBytes(blob.slice(off, end)), end >= blob.size);
          if (sink.total > limits.maxBytes + 64 * 1024 ** 2) {
            throw new BackupError(tooLargeMessage(sink.total, limits.maxBytes), "too-large");
          }
        }
        counts.audioFiles++;
      }
      counts.songs++;
      n++;
      progress({ phase: `Packed "${rec.title}"`, done: n, total: songParts.length });
    }
    zip.end();
    await finished;
    if (zipError) throw zipError;
    const blob = sink.finish("application/zip");
    return { blob, filename: backupFilename(mode, now), counts, warnings };
  } catch (e) {
    throw readable(e, "create the backup");
  }
}

// ---- strict validation helpers -------------------------------------------

const bad = (where: string, msg: string): never => {
  throw new BackupError(`${where}: ${msg}`, "invalid");
};
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function vObj(v: unknown, where: string): Record<string, unknown> {
  return isObj(v) ? v : bad(where, "must be an object");
}
function vArr(v: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(v)) return bad(where, "must be a list");
  if (v.length > max) return bad(where, `too many entries (limit ${max})`);
  return v;
}
function vStr(v: unknown, where: string, max: number, min = 0): string {
  if (typeof v !== "string") return bad(where, "must be text");
  if (v.length > max) return bad(where, `too long (limit ${max} characters)`);
  if (v.length < min) return bad(where, "must not be empty");
  if (CONTROL.test(v)) return bad(where, "contains control characters");
  return v;
}
function vNum(v: unknown, where: string, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return bad(where, "must be a number");
  if (v < lo || v > hi) return bad(where, `must be between ${lo} and ${hi}`);
  return v;
}
function vInt(v: unknown, where: string, lo: number, hi: number): number {
  const n = vNum(v, where, lo, hi);
  return Number.isInteger(n) ? n : bad(where, "must be a whole number");
}
function vBool(v: unknown, where: string): boolean {
  return typeof v === "boolean" ? v : bad(where, "must be true or false");
}
function vEnum<T extends string>(v: unknown, where: string, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(where, `must be one of ${allowed.join(", ")}`);
}

function parseJson(bytes: Uint8Array, where: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes).replace(/^﻿/, "")) as unknown;
  } catch {
    return bad(where, "is not valid JSON");
  }
}

// ---- kits -----------------------------------------------------------------

const PIECE_KINDS: readonly PieceKind[] = ["drum", "cymbal", "pedal"];

function validatePreset(raw: unknown, idx: number, warnings: string[]): KitPreset | null {
  const where = `kits.json kit ${idx + 1}`;
  const o = vObj(raw, where);
  const id = vStr(o.id, `${where} id`, 100, 1);
  const name = vStr(o.name, `${where} name`, 80, 1).trim();
  if (!name) bad(`${where} name`, "must not be empty");
  const rawPieces = vArr(o.pieces, `${where} pieces`, 64);
  const seen = new Set<string>();
  const pieces: KitPiece[] = [];
  for (const [i, rp] of rawPieces.entries()) {
    const pw = `${where} piece ${i + 1}`;
    const p = vObj(rp, pw);
    const pid = vStr(p.id, `${pw} id`, 32, 1);
    if (!(PIECE_ORDER as readonly string[]).includes(pid)) {
      warnings.push(`Kit "${name}": unknown piece "${pid}" was dropped.`);
      continue;
    }
    if (seen.has(pid)) {
      warnings.push(`Kit "${name}": duplicate piece "${pid}" was dropped.`);
      continue;
    }
    seen.add(pid);
    const notesRaw = vObj(p.midiNotes, `${pw} midiNotes`);
    const keys = Object.keys(notesRaw);
    if (keys.length > 16) bad(`${pw} midiNotes`, "too many zones (limit 16)");
    const midiNotes: Record<string, number> = {};
    for (const k of keys) {
      if (k.length < 1 || k.length > 32 || CONTROL.test(k) || FORBIDDEN_KEYS.has(k)) bad(`${pw} midiNotes`, `invalid zone name ${JSON.stringify(k)}`);
      midiNotes[k] = vInt(notesRaw[k], `${pw} note ${k}`, 0, 127);
    }
    const color = vStr(p.color, `${pw} color`, 9, 4);
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) bad(`${pw} color`, "must be a hex color like #ff7a1a");
    pieces.push({
      id: pid as PieceId,
      kind: vEnum(p.kind, `${pw} kind`, PIECE_KINDS),
      x: vNum(p.x, `${pw} x`, -1, 2),
      y: vNum(p.y, `${pw} y`, -1, 2),
      size: vNum(p.size, `${pw} size`, 0, 1),
      color,
      midiNotes,
    });
  }
  const locked = vBool(o.locked, `${where} locked`);
  const mirrored = vBool(o.mirrored, `${where} mirrored`);
  const updatedAt = vNum(o.updatedAt, `${where} updatedAt`, 0, 8.64e15);
  let template: KitPreset["template"];
  if (o.template !== undefined) {
    const t = vObj(o.template, `${where} template`);
    if (t.id !== "nitro-max") bad(`${where} template`, "unknown template");
    template = { id: "nitro-max", version: vInt(t.version, `${where} template version`, 0, 1000) };
  }
  for (const g of Object.keys(PIECE_LIMITS)) {
    const lim = PIECE_LIMITS[g]!;
    const c = pieces.filter((p) => pieceGroup(p.id) === g).length;
    if (c < lim.min) {
      warnings.push(`Kit "${name}" has no ${g} (every kit needs one) and was skipped.`);
      return null;
    }
  }
  pieces.sort((a, b) => PIECE_ORDER.indexOf(a.id) - PIECE_ORDER.indexOf(b.id));
  // Clamp sizes/positions through the model (it no-ops while locked, so build unlocked and restore).
  let preset: KitPreset = { id, name, pieces, locked: false, mirrored, updatedAt };
  for (const p of pieces) {
    preset = resizePiece(preset, p.id, Math.min(MAX_SIZE, Math.max(MIN_SIZE, p.size)));
    preset = movePiece(preset, p.id, p.x, p.y);
  }
  preset = { ...preset, locked, updatedAt };
  if (template) preset.template = template;
  return preset;
}

// ---- settings -------------------------------------------------------------

const KNOWN_APP = ["inputLatencyMs", "outputLatencyMs", "timingPreset", "defaultCountIn", "metronomeDuringPlay", "keepAwake", "colorblindPalette"];
const KNOWN_SOUND = ["enabled", "volume", "playForMidi"];

function validateSettings(raw: unknown, warnings: string[]): SettingsPatch {
  const o = vObj(raw, "settings.json");
  const out: SettingsPatch = {};
  const ignore = (obj: Record<string, unknown>, known: string[], where: string) => {
    for (const k of Object.keys(obj)) if (!known.includes(k)) warnings.push(`${where}: unknown setting "${k.slice(0, 40)}" ignored.`);
  };
  if (o.app !== undefined) {
    const a = vObj(o.app, "settings.json app");
    ignore(a, KNOWN_APP, "settings.json app");
    const app: Partial<AppSettings> = {};
    if (a.inputLatencyMs !== undefined) app.inputLatencyMs = vNum(a.inputLatencyMs, "inputLatencyMs", -500, 500);
    if (a.outputLatencyMs !== undefined) app.outputLatencyMs = vNum(a.outputLatencyMs, "outputLatencyMs", -500, 500);
    if (a.timingPreset !== undefined) app.timingPreset = vEnum(a.timingPreset, "timingPreset", ["beginner", "normal", "strict"] as const);
    if (a.defaultCountIn !== undefined) {
      const c = vInt(a.defaultCountIn, "defaultCountIn", 0, 4);
      if (c !== 0 && c !== 2 && c !== 4) bad("defaultCountIn", "must be 0, 2 or 4");
      app.defaultCountIn = c as 0 | 2 | 4;
    }
    if (a.metronomeDuringPlay !== undefined) app.metronomeDuringPlay = vBool(a.metronomeDuringPlay, "metronomeDuringPlay");
    if (a.keepAwake !== undefined) app.keepAwake = vBool(a.keepAwake, "keepAwake");
    if (a.colorblindPalette !== undefined) app.colorblindPalette = vBool(a.colorblindPalette, "colorblindPalette");
    out.app = app;
  }
  if (o.sound !== undefined) {
    const s = vObj(o.sound, "settings.json sound");
    ignore(s, KNOWN_SOUND, "settings.json sound");
    const sound: Partial<SoundSettings> = {};
    if (s.enabled !== undefined) sound.enabled = vBool(s.enabled, "sound enabled");
    if (s.volume !== undefined) sound.volume = vNum(s.volume, "sound volume", 0, 1);
    if (s.playForMidi !== undefined) sound.playForMidi = vBool(s.playForMidi, "sound playForMidi");
    out.sound = sound;
  }
  if (o.display !== undefined) out.display = vEnum(o.display, "display", ["lanes", "kit"] as const);
  if (o.approach !== undefined) out.approach = vNum(o.approach, "approach", MIN_APPROACH_SEC, MAX_APPROACH_SEC);
  for (const k of Object.keys(o)) if (!["app", "sound", "display", "approach"].includes(k)) warnings.push(`settings.json: unknown section "${k.slice(0, 40)}" ignored.`);
  return out;
}

// ---- songs ----------------------------------------------------------------

const DIFFS: readonly Difficulty[] = ["easy", "medium", "hard", "expert"];
const FORMATS: readonly ChartFormat[] = ["clonehero-mid", "clonehero-chart", "gm-midi"];
const ROLES: readonly StemRole[] = ["drums", "song", "guitar", "bass", "vocals", "rhythm", "keys", "crowd", "full", "other"];
const MAX_NOTES_PER_DIFF = 250_000;

function validateSong(raw: unknown, dir: string): SongRecord {
  const w = `songs/${dir}/song.json`;
  const o = vObj(raw, w);
  const m = vObj(o.meta, `${w} meta`);
  const meta: SongRecord["meta"] = {
    title: vStr(m.title, `${w} meta.title`, 300),
    artist: vStr(m.artist, `${w} meta.artist`, 300),
    delayMs: vNum(m.delayMs, `${w} meta.delayMs`, -60_000, 60_000),
  };
  for (const k of ["album", "year", "charter"] as const) if (m[k] !== undefined) meta[k] = vStr(m[k], `${w} meta.${k}`, 300);
  if (m.lengthSec !== undefined) meta.lengthSec = vNum(m.lengthSec, `${w} meta.lengthSec`, 0, 86_400);
  if (m.startBpm !== undefined) meta.startBpm = vNum(m.startBpm, `${w} meta.startBpm`, 1, 2000);
  if (m.beatsPerBar !== undefined) meta.beatsPerBar = vInt(m.beatsPerBar, `${w} meta.beatsPerBar`, 1, 64);
  if (m.tempoMap !== undefined) {
    meta.tempoMap = vArr(m.tempoMap, `${w} meta.tempoMap`, 20_000).map((t, i): TempoPoint => {
      const to = vObj(t, `${w} tempo ${i + 1}`);
      return { timeSec: vNum(to.timeSec, `${w} tempo ${i + 1} timeSec`, 0, 100_000), bpm: vNum(to.bpm, `${w} tempo ${i + 1} bpm`, 1, 2000) };
    });
  }
  const nb = vObj(o.notesByDifficulty, `${w} notesByDifficulty`);
  const notesByDifficulty: SongRecord["notesByDifficulty"] = {};
  for (const k of Object.keys(nb)) {
    if (!(DIFFS as readonly string[]).includes(k)) bad(`${w} notesByDifficulty`, `unknown difficulty ${JSON.stringify(k.slice(0, 20))}`);
  }
  for (const d of DIFFS) {
    if (nb[d] === undefined) continue;
    notesByDifficulty[d] = vArr(nb[d], `${w} ${d} notes`, MAX_NOTES_PER_DIFF).map((n, i): NoteEvent => {
      const no = vObj(n, `${w} ${d} note ${i + 1}`);
      const ev: NoteEvent = {
        timeSec: vNum(no.timeSec, `${w} ${d} note ${i + 1} timeSec`, 0, 100_000),
        piece: vEnum(no.piece, `${w} ${d} note ${i + 1} piece`, PIECE_ORDER),
        velocity: vNum(no.velocity, `${w} ${d} note ${i + 1} velocity`, 0, 127),
      };
      if (no.source !== undefined) ev.source = vStr(no.source, `${w} ${d} note ${i + 1} source`, 64);
      return ev;
    });
  }
  const names = new Set<string>();
  const stems = vArr(o.stems, `${w} stems`, 64).map((s, i) => {
    const so = vObj(s, `${w} stem ${i + 1}`);
    const name = vStr(so.name, `${w} stem ${i + 1} name`, 200, 1);
    if (name.includes("/") || name.includes("\\")) bad(`${w} stem ${i + 1} name`, "must not contain slashes");
    if (names.has(name)) bad(`${w} stems`, `duplicate stem name ${JSON.stringify(name)}`);
    names.add(name);
    return { name, role: vEnum(so.role, `${w} stem ${i + 1} role`, ROLES) };
  });
  const rec: SongRecord = {
    id: vStr(o.id, `${w} id`, 200, 1),
    title: vStr(o.title, `${w} title`, 300),
    artist: vStr(o.artist, `${w} artist`, 300),
    meta,
    format: vEnum(o.format, `${w} format`, FORMATS),
    notesByDifficulty,
    stems,
    offsetMs: vNum(o.offsetMs, `${w} offsetMs`, -60_000, 60_000),
    addedAt: vNum(o.addedAt, `${w} addedAt`, 0, 8.64e15),
  };
  if (o.bestScore !== undefined) rec.bestScore = vNum(o.bestScore, `${w} bestScore`, 0, 1e12);
  if (o.bestByDifficulty !== undefined) {
    const b = vObj(o.bestByDifficulty, `${w} bestByDifficulty`);
    const out: Partial<Record<Difficulty, number>> = {};
    for (const d of DIFFS) if (b[d] !== undefined) out[d] = vNum(b[d], `${w} best ${d}`, 0, 1e12);
    rec.bestByDifficulty = out;
  }
  return rec;
}

// ---- inspect (untrusted zip) ---------------------------------------------

type Kind =
  | { t: "manifest" | "kits" | "settings" }
  | { t: "song"; dir: string }
  | { t: "audio"; dir: string; index: number; ext: string };

const SONG_JSON = /^songs\/([A-Za-z0-9._-]{1,100})\/song\.json$/;
const SONG_AUDIO = /^songs\/([A-Za-z0-9._-]{1,100})\/audio\/(\d{1,2})\.([a-z0-9]{2,5})$/;

function classify(name: string): Kind | null {
  if (name === "manifest.json") return { t: "manifest" };
  if (name === "kits.json") return { t: "kits" };
  if (name === "settings.json") return { t: "settings" };
  let m = SONG_JSON.exec(name);
  if (m && !onlyDots(m[1]!)) return { t: "song", dir: m[1]! };
  m = SONG_AUDIO.exec(name);
  if (m && !onlyDots(m[1]!) && AUDIO_EXT.has(m[3]!)) return { t: "audio", dir: m[1]!, index: Number(m[2]), ext: m[3]! };
  return null;
}

export interface PreparedSong {
  dir: string;
  /** Validated record; `stems` only lists stems whose audio file is in the zip. */
  record: SongRecord;
  /** Zip entry per stem name. */
  audioEntries: { name: string; path: string; size: number }[];
  audioBytes: number;
  /** The id in the file was unusable and a new one is assigned on import. */
  idReplaced: boolean;
}

export interface PreparedBackup {
  createdAt: string;
  schemaVersion: number;
  kits: KitPreset[];
  songs: PreparedSong[];
  settings: SettingsPatch | null;
  warnings: string[];
  audioBytes: number;
  /** Inflates the audio of one song (on demand, one song at a time). */
  readAudio(song: PreparedSong): Promise<{ name: string; blob: Blob }[]>;
}

export const hasKits = (p: PreparedBackup) => p.kits.length > 0;
export const hasSongs = (p: PreparedBackup) => p.songs.length > 0;
export const hasSettings = (p: PreparedBackup) => p.settings !== null;
/** The file carries latency calibration values (device specific, restored only on request). */
export const hasLatency = (p: PreparedBackup) => p.settings?.app?.inputLatencyMs !== undefined || p.settings?.app?.outputLatencyMs !== undefined;

/**
 * Validates a backup zip completely and returns what it contains. Writes NOTHING. Throws BackupError
 * (readable) for anything that is not a well-formed, in-limits backup.
 */
export async function inspectBackup(file: Blob, limits: Partial<BackupLimits> = {}): Promise<PreparedBackup> {
  const lim = { ...DEFAULT_BACKUP_LIMITS, ...limits };
  if (file.size > lim.maxBytes + 16 * 1024 ** 2) {
    throw new BackupError(
      `This file is ${(file.size / 1024 ** 2).toFixed(0)} MB. Backups over ${Math.round(lim.maxBytes / 1024 ** 2)} MB cannot be imported, ` +
        `because the whole file has to fit in the phone's memory. Export "Kits and settings only" instead, or split your songs into several smaller backups.`,
      "too-large",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(file);
  } catch (e) {
    throw readable(e, "read the file");
  }
  const warnings: string[] = [];

  // Pass 1: central directory only. Nothing is inflated (filter returns false for every entry).
  const catalog = new Map<string, { kind: Kind; size: number }>();
  let count = 0;
  let total = 0;
  let totalJson = 0;
  let skipped = 0;
  try {
    unzipSync(bytes, {
      filter(info) {
        count++;
        if (count > lim.maxEntries) bad("Zip", `too many entries (limit ${lim.maxEntries})`);
        const name = info.name;
        if (isUnsafeName(name)) bad("Zip", `unsafe file name ${JSON.stringify(name.slice(0, 80))}; the file was rejected`);
        if (name.endsWith("/")) return false;
        const kind = classify(name);
        if (!kind) {
          skipped++;
          return false;
        }
        if (catalog.has(name)) bad("Zip", `duplicate entry ${JSON.stringify(name)}`);
        if (info.originalSize > Number.MAX_SAFE_INTEGER || info.originalSize < 0) bad("Zip", "invalid declared size");
        if (kind.t !== "audio") {
          const cap = JSON_CAPS[kind.t];
          if (info.originalSize > cap) bad(name, `is too large (${(info.originalSize / 1024 ** 2).toFixed(1)} MB, limit ${(cap / 1024 ** 2).toFixed(0)} MB)`);
          totalJson += info.originalSize;
          if (totalJson > MAX_TOTAL_JSON_BYTES) bad("Zip", "data files are too large when unpacked");
        }
        total += info.originalSize;
        if (total > lim.maxBytes) throw new BackupError(
            `The backup is more than ${Math.round(lim.maxBytes / 1024 ** 2)} MB when unpacked and was refused. Export "Kits and settings only" instead, or split your songs into several smaller backups.`,
            "too-large",
          );
        catalog.set(name, { kind, size: info.originalSize });
        return false;
      },
    });
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError(`This is not a readable zip file (${(e as Error)?.message || "unknown error"}).`, "invalid", { cause: e });
  }
  if (skipped) warnings.push(`${skipped} unrecognized file${skipped === 1 ? " was" : "s were"} in the zip and ignored.`);

  const inflate = (names: string[]): Record<string, Uint8Array> => {
    const want = new Set(names);
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, { filter: (i) => want.has(i.name) });
    } catch (e) {
      throw new BackupError(`Could not unpack ${names[0] ?? "file"}: ${(e as Error)?.message || "corrupt data"}.`, "invalid", { cause: e });
    }
    for (const n of names) {
      const got = files[n];
      if (!got || got.length !== catalog.get(n)!.size) bad(n, "is corrupt (size does not match the zip directory)");
    }
    return files;
  };
  const json = (name: string): unknown => parseJson(inflate([name])[name]!, name);

  // Manifest.
  if (!catalog.has("manifest.json")) bad("This file", "is not a Drum Bass backup (manifest.json is missing)");
  const man = vObj(json("manifest.json"), "manifest.json");
  if (man.app !== BACKUP_APP_ID || man.format !== BACKUP_FORMAT) bad("This file", "is not a Drum Bass backup");
  const schemaVersion = vInt(man.schemaVersion, "manifest.json schemaVersion", 1, 1_000_000);
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    bad("This backup", `was made by a newer version of the app (format ${schemaVersion}); update the app and try again`);
  }
  const createdAt = vStr(man.createdAt, "manifest.json createdAt", 64);

  // Kits.
  const kits: KitPreset[] = [];
  if (catalog.has("kits.json")) {
    const k = vObj(json("kits.json"), "kits.json");
    const list = vArr(k.kits, "kits.json kits", MAX_KITS);
    list.forEach((r, i) => {
      const p = validatePreset(r, i, warnings);
      if (p) kits.push(p);
    });
    if (list.length > 0 && kits.length === 0) bad("kits.json", "contains no usable kit");
  }

  // Settings.
  const settings = catalog.has("settings.json") ? validateSettings(json("settings.json"), warnings) : null;

  // Songs: validate every record now; audio is only checked against the directory (not inflated).
  const dirs = new Map<string, { json?: string; audio: { index: number; path: string; ext: string; size: number }[] }>();
  for (const [name, { kind, size }] of catalog) {
    if (kind.t === "song") (dirs.get(kind.dir) ?? dirs.set(kind.dir, { audio: [] }).get(kind.dir)!).json = name;
    if (kind.t === "audio") (dirs.get(kind.dir) ?? dirs.set(kind.dir, { audio: [] }).get(kind.dir)!).audio.push({ index: kind.index, path: name, ext: kind.ext, size });
  }
  if (dirs.size > MAX_SONGS) bad("Zip", `too many songs (limit ${MAX_SONGS})`);
  const songs: PreparedSong[] = [];
  const seenIds = new Set<string>();
  let audioBytes = 0;
  for (const [dir, d] of [...dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!d.json) {
      warnings.push(`songs/${dir}: audio without song.json was ignored.`);
      continue;
    }
    const rec = validateSong(json(d.json), dir);
    let idReplaced = false;
    if (!SAFE_SONG_ID.test(rec.id) || onlyDots(rec.id) || seenIds.has(rec.id)) {
      rec.id = newId();
      idReplaced = true;
    }
    seenIds.add(rec.id);
    const byIndex = new Map(d.audio.map((a) => [a.index, a]));
    const audioEntries: PreparedSong["audioEntries"] = [];
    const kept: SongRecord["stems"] = [];
    rec.stems.forEach((s, i) => {
      const a = byIndex.get(i);
      if (!a) {
        warnings.push(`"${rec.title}": audio "${s.name}" is not in the backup (stem dropped).`);
        return;
      }
      kept.push(s);
      audioEntries.push({ name: s.name, path: a.path, size: a.size });
    });
    for (const a of d.audio) if (a.index >= rec.stems.length) warnings.push(`songs/${dir}: unused audio file ${a.index}.${a.ext} ignored.`);
    rec.stems = kept;
    const ab = audioEntries.reduce((n, a) => n + a.size, 0);
    audioBytes += ab;
    songs.push({ dir, record: rec, audioEntries, audioBytes: ab, idReplaced });
  }

  return {
    createdAt,
    schemaVersion,
    kits,
    songs,
    settings,
    warnings,
    audioBytes,
    async readAudio(song) {
      const files = inflate(song.audioEntries.map((a) => a.path));
      return song.audioEntries.map((a) => {
        const ext = a.path.slice(a.path.lastIndexOf(".") + 1);
        const data = files[a.path]!;
        return { name: a.name, blob: new Blob([data as BlobPart], MIME[ext] ? { type: MIME[ext] } : undefined) };
      });
    },
  };
}

// ---- apply (import) -------------------------------------------------------

export type ImportMode = "add" | "replace";

export interface ImportOptions {
  mode: ImportMode;
  /**
   * Apply settings.json. Rules: replace mode applies it (the UI passes true); add mode never touches settings
   * unless the user opted in. Latency calibration is device specific and is NOT part of this: see applyLatency.
   */
  applySettings: boolean;
  /** Also restore inputLatencyMs / outputLatencyMs from the file (only meaningful with applySettings). Default off. */
  applyLatency?: boolean;
  onProgress?: Progress;
}

export interface ImportSummary {
  kitsAdded: number;
  kitsSkipped: number;
  kitsRemoved: number;
  songsAdded: number;
  songsSkipped: number;
  songsRemoved: number;
  settingsApplied: boolean;
  warnings: string[];
  /** Set when a write failed part-way: what was already written stays, nothing was deleted. */
  error?: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** JSON with object keys sorted at every level, so equal data gives equal text whatever the build order. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Canonical kit form: sorted keys, pieces sorted by id, id and updatedAt ignored. */
export function kitCanon(p: KitPreset): string {
  const { id: _id, updatedAt: _u, pieces, ...rest } = p as KitPreset & Record<string, unknown>;
  const sorted = [...pieces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return stableStringify({ ...rest, pieces: sorted });
}

let operationBusy = false;
const busyError = () => new BackupError("Another import or delete is still running. Wait for it to finish.", "other");

/**
 * Writes a prepared backup. Add mode never overwrites: id collisions get fresh ids, name clashes get
 * "name 2", identical items are skipped. Replace mode touches only the data types present in the file,
 * writes the new data first and removes the old items last, and only if every write succeeded.
 */
export async function applyBackup(
  p: PreparedBackup,
  opts: ImportOptions,
  deps: BackupDeps = defaultBackupDeps(),
): Promise<ImportSummary> {
  const progress = opts.onProgress ?? (() => {});
  const sum: ImportSummary = {
    kitsAdded: 0, kitsSkipped: 0, kitsRemoved: 0, songsAdded: 0, songsSkipped: 0, songsRemoved: 0,
    settingsApplied: false, warnings: [...p.warnings],
  };
  const replace = opts.mode === "replace";
  if (operationBusy) {
    sum.error = busyError().message;
    return sum;
  }
  operationBusy = true;
  try {
    // ---- kits
    if (hasKits(p)) {
      const existing = await deps.kits.getAll();
      const takenIds = new Set(replace ? [] : existing.map((k) => k.id));
      const names: string[] = replace ? [] : existing.map((k) => k.name);
      const written = new Set<string>();
      const existingCanon = new Set(existing.map(kitCanon));
      let i = 0;
      for (const k of p.kits) {
        progress({ phase: "Saving kits", done: i++, total: p.kits.length });
        const same = !replace && existingCanon.has(kitCanon(k));
        if (same) {
          sum.kitsSkipped++;
          continue;
        }
        const id = takenIds.has(k.id) || written.has(k.id) ? newId() : k.id;
        const name = uniqueName(k.name, names);
        names.push(name);
        takenIds.add(id);
        written.add(id);
        await deps.kits.put({ ...k, id, name });
        existingCanon.add(kitCanon(k));
        sum.kitsAdded++;
      }
      if (replace) {
        for (const e of existing) {
          if (!written.has(e.id)) {
            await deps.kits.remove(e.id);
            sum.kitsRemoved++;
          }
        }
        if (existing.length && !written.has((await deps.kits.getMeta(ACTIVE_KIT_META_KEY)) ?? "")) await deps.kits.setMeta(ACTIVE_KIT_META_KEY, null);
        await deps.ensureDefaultKit();
      }
    }

    // ---- songs
    if (hasSongs(p)) {
      const existing = await deps.songs.getAllSummaries();
      const takenIds = new Set(replace ? [] : existing.map((s) => s.id));
      const written = new Set<string>();
      let n = 0;
      for (const s of p.songs) {
        progress({ phase: `Saving "${s.record.title}"`, done: n++, total: p.songs.length });
        const dup = !replace && existing.find((e) => norm(e.title) === norm(s.record.title) && norm(e.artist) === norm(s.record.artist));
        if (dup) {
          sum.songsSkipped++;
          sum.warnings.push(`"${s.record.title}" is already in the library and was not added again.`);
          continue;
        }
        const id = takenIds.has(s.record.id) || written.has(s.record.id) ? newId() : s.record.id;
        const audio = await p.readAudio(s);
        await deps.songs.putSong({ ...s.record, id }, audio);
        takenIds.add(id);
        written.add(id);
        sum.songsAdded++;
      }
      if (replace) {
        for (const e of existing) {
          if (!written.has(e.id)) {
            await deps.songs.deleteSong(e.id);
            sum.songsRemoved++;
          }
        }
      }
    }
    progress({ phase: "Done", done: 1, total: 1 });

    // ---- settings (last: cannot half-fail, and a failed song write leaves them untouched)
    if (hasSettings(p) && opts.applySettings) {
      const patch: SettingsPatch = { ...p.settings! };
      if (patch.app) {
        const { inputLatencyMs: _i, outputLatencyMs: _o, ...app } = patch.app;
        patch.app = opts.applyLatency ? patch.app : app;
      }
      deps.settings.apply(patch);
      sum.settingsApplied = true;
    }
  } catch (e) {
    sum.error = readable(e, "import the backup").message;
  } finally {
    operationBusy = false;
  }
  return sum;
}

// ---- clear ----------------------------------------------------------------

export type ClearTarget = "kits" | "songs" | "settings" | "everything";
export interface ClearSummary {
  kitsRemoved: number;
  songsRemoved: number;
  settingsReset: boolean;
}

/**
 * Deletes records through the stores (the database itself is never deleted, so open connections in
 * other tabs are not blocked). Clearing kits recreates the default preset right away.
 */
export async function clearData(target: ClearTarget, deps: BackupDeps = defaultBackupDeps(), onProgress?: Progress): Promise<ClearSummary> {
  const out: ClearSummary = { kitsRemoved: 0, songsRemoved: 0, settingsReset: false };
  if (operationBusy) throw busyError();
  operationBusy = true;
  try {
    if (target === "songs" || target === "everything") {
      const sums = await deps.songs.getAllSummaries();
      let n = 0;
      for (const s of sums) {
        onProgress?.({ phase: "Deleting songs", done: n++, total: sums.length });
        await deps.songs.deleteSong(s.id);
        out.songsRemoved++;
      }
    }
    if (target === "kits" || target === "everything") {
      const all = await deps.kits.getAll();
      for (const k of all) {
        await deps.kits.remove(k.id);
        out.kitsRemoved++;
      }
      await deps.kits.setMeta(ACTIVE_KIT_META_KEY, null);
      await deps.ensureDefaultKit();
    }
    if (target === "settings" || target === "everything") {
      deps.settings.reset();
      out.settingsReset = true;
    }
  } catch (e) {
    throw readable(e, "clear the data");
  } finally {
    operationBusy = false;
  }
  return out;
}
