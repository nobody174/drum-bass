import { unzipSync } from "fflate";
import type { ChartFormat, ImportedAudio, ImportedSong, ParsedChart, SongMeta, StemRole } from "./types";
import { readBytes, readText } from "./bytes";
import { parseSongIni } from "./songIni";
import { parseCloneHeroMidi, hasPartDrums } from "./cloneHeroMidi";
import { parseCloneHeroChart } from "./cloneHeroChart";
import { parseGmMidi } from "./gmMidi";
import { loadMidi } from "./midiCommon";
import { bpmAtTime } from "./tempo";

export type ImportInput = { name: string; blob: Blob };
export type ImportFile = File | ImportInput;

export interface ImportLimits {
  /** Max total uncompressed bytes of the entries actually inflated (chart/ini/audio only). Default 400 MB. */
  maxUncompressedBytes: number;
  /** Max zip entries. Default 5000. */
  maxEntries: number;
}
export const DEFAULT_LIMITS: ImportLimits = { maxUncompressedBytes: 400 * 1024 ** 2, maxEntries: 5000 };

const AUDIO_EXT = new Set(["ogg", "opus", "mp3", "wav", "m4a", "aac", "flac"]);
/** Only these entries are ever inflated from a zip; video, images and everything else are skipped. */
const WANTED_EXT = new Set(["chart", "mid", "midi", "ini", ...AUDIO_EXT]);
/** Audio we cannot decode: not inflated, but reported. */
const UNSUPPORTED_AUDIO_EXT = new Set(["wma", "aif", "aiff", "mp2"]);
const MIME: Record<string, string> = {
  ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
};

interface Entry {
  /** Normalized forward-slash path (webkitRelativePath if present). */
  path: string;
  blob: Blob;
}

const extOf = (p: string) => {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
};
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const stemOf = (p: string) => {
  const b = baseOf(p);
  const i = b.lastIndexOf(".");
  return (i < 0 ? b : b.slice(0, i)).toLowerCase();
};

/** True if a zip entry name is unsafe (absolute, drive letter, `..` segment, NUL). */
export function isUnsafePath(name: string): boolean {
  if (name.includes("\0")) return true;
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return true;
  return n.split("/").some((seg) => seg === "..");
}

/** Classify an audio file name (without extension) into a stem role. */
export function classifyStem(stem: string): StemRole | null {
  const s = stem.toLowerCase().trim();
  if (/^(preview|album|cover)/.test(s)) return null;
  if (/^drums?(_?\d+)?$/.test(s) || /^drums?[_ -]/.test(s)) return "drums";
  if (/^(song|backing|backing_?track)(_?\d+)?$/.test(s)) return "song";
  if (/^guitar(_?\d+)?$/.test(s)) return "guitar";
  if (/^bass(_?\d+)?$/.test(s)) return "bass";
  if (/^(vocals?|vox)(_?\d+)?$/.test(s)) return "vocals";
  if (/^rhythm(_?\d+)?$/.test(s)) return "rhythm";
  if (/^keys?(_?\d+)?$/.test(s)) return "keys";
  if (/^crowd(_?\d+)?$/.test(s)) return "crowd";
  return "other";
}

function normalizeInputs(files: ImportFile[]): Entry[] {
  return files.map((f) => {
    const rel = (f as File).webkitRelativePath;
    const raw = rel && rel.length > 0 ? rel : f.name;
    const blob = "blob" in f ? f.blob : f;
    return { path: raw.replace(/\\/g, "/").replace(/^\.\//, ""), blob };
  });
}

function unpackZip(bytes: Uint8Array, limits: ImportLimits, warnings: string[]): Entry[] {
  let total = 0;
  let count = 0;
  const sizes = new Map<string, number>();
  let skippedOther = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(info) {
        count++;
        if (count > limits.maxEntries) throw new Error(`Zip has too many entries (limit ${limits.maxEntries}).`);
        if (info.name.endsWith("/")) return false; // directory
        if (isUnsafePath(info.name)) {
          warnings.push(`Skipped unsafe path in zip: ${JSON.stringify(info.name)}.`);
          return false;
        }
        const base = baseOf(info.name);
        if (info.name.startsWith("__MACOSX/") || base === ".DS_Store" || base.startsWith("._")) return false;
        const ext = extOf(info.name);
        if (!WANTED_EXT.has(ext)) {
          // Decided from the name alone, before anything is inflated.
          if (UNSUPPORTED_AUDIO_EXT.has(ext)) warnings.push(`Unsupported audio format skipped: ${baseOf(info.name)}.`);
          else skippedOther++;
          return false;
        }
        total += info.originalSize;
        if (total > limits.maxUncompressedBytes) {
          throw new Error(`Zip is too large when unpacked (limit ${Math.round(limits.maxUncompressedBytes / 1024 ** 2)} MB).`);
        }
        sizes.set(info.name, info.originalSize);
        return true;
      },
    });
  } catch (e) {
    throw new Error(`Could not read zip: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (skippedOther) warnings.push(`Skipped ${skippedOther} unneeded file${skippedOther === 1 ? "" : "s"} in the zip (video, images, other).`);
  const out: Entry[] = [];
  for (const [name, data] of Object.entries(files)) {
    if (sizes.get(name) !== data.length) {
      warnings.push(`Skipped zip entry with inconsistent size: ${JSON.stringify(name)}.`);
      continue;
    }
    const ext = extOf(name);
    out.push({ path: name.replace(/\\/g, "/"), blob: new Blob([data as BlobPart], MIME[ext] ? { type: MIME[ext] } : undefined) });
  }
  return out;
}

async function parseChartCandidate(e: Entry, forceKind: "mid" | "chart"): Promise<ParsedChart> {
  if (forceKind === "chart") return parseCloneHeroChart(await readText(e.blob));
  const bytes = await readBytes(e.blob);
  const midi = loadMidi(bytes);
  if (hasPartDrums(midi)) return parseCloneHeroMidi(bytes); // raw bytes: needed for per-track text events (disco flip)
  const parsed = parseGmMidi(midi);
  parsed.warnings.unshift(`${baseOf(e.path)} has no PART DRUMS track; imported as General MIDI.`);
  return parsed;
}

/**
 * Import a Clone Hero song folder (multi-file selection), a .zip of one, or a lone .mid.
 * Throws an Error only for hard problems (no chart found, unreadable zip); soft problems go to `warnings`.
 */
export async function importSongFiles(
  files: ImportFile[],
  limits: Partial<ImportLimits> = {},
): Promise<ImportedSong> {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const warnings: string[] = [];
  if (!files.length) throw new Error("No files selected.");

  let entries = normalizeInputs(files);
  const zips = entries.filter((e) => extOf(e.path) === "zip");
  if (zips.length) {
    if (zips.length > 1) warnings.push("Several zip files selected; only the first was imported.");
    entries = unpackZip(await readBytes(zips[0]!.blob), lim, warnings);
    if (!entries.length) throw new Error("The zip file is empty.");
  }

  // Pick the chart: notes.mid, then notes.chart, then any other .mid/.mid; shallowest path first.
  const depth = (p: string) => p.split("/").length;
  const byDepth = (a: Entry, b: Entry) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path);
  const candidates: { entry: Entry; kind: "mid" | "chart" }[] = [
    ...entries.filter((e) => baseOf(e.path).toLowerCase() === "notes.mid").sort(byDepth).map((entry) => ({ entry, kind: "mid" as const })),
    ...entries.filter((e) => baseOf(e.path).toLowerCase() === "notes.chart").sort(byDepth).map((entry) => ({ entry, kind: "chart" as const })),
    ...entries
      .filter((e) => ["mid", "midi"].includes(extOf(e.path)) && baseOf(e.path).toLowerCase() !== "notes.mid")
      .sort(byDepth)
      .map((entry) => ({ entry, kind: "mid" as const })),
  ];
  if (!candidates.length) throw new Error("No chart found: expected notes.mid, notes.chart or a .mid file.");

  let chosen: Entry | undefined;
  let parsed: ParsedChart | undefined;
  for (const c of candidates) {
    try {
      const p = await parseChartCandidate(c.entry, c.kind);
      if (Object.values(p.notesByDifficulty).some((n) => n && n.length)) {
        chosen = c.entry;
        parsed = p;
        break;
      }
      warnings.push(`${c.entry.path}: no drum notes found.`);
    } catch (e) {
      warnings.push(`${c.entry.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!chosen || !parsed) {
    throw new Error(`No usable drum chart found. ${warnings.join(" ")}`.trim());
  }
  const generic = candidates.filter((c) => c.kind === "mid" && !/^notes\./i.test(baseOf(c.entry.path)));
  if (generic.length > 1 && !/^notes\./i.test(baseOf(chosen.path))) {
    warnings.push(`Several .mid files found; imported ${baseOf(chosen.path)}.`);
  }
  warnings.push(...parsed.warnings);

  const dir = dirOf(chosen.path);
  const sameDir = entries.filter((e) => dirOf(e.path) === dir);

  // Metadata
  const ini = sameDir.find((e) => baseOf(e.path).toLowerCase() === "song.ini");
  let meta: SongMeta = { title: "", artist: "", delayMs: 0 };
  if (ini) {
    try {
      meta = parseSongIni(await readText(ini.blob));
    } catch {
      warnings.push("song.ini could not be read.");
    }
  } else {
    warnings.push("No song.ini found; using defaults.");
  }
  meta = { title: "", artist: "", ...parsed.meta, ...stripEmpty(meta), delayMs: meta.delayMs };
  if (!meta.title) {
    const folder = dir ? dir.slice(dir.lastIndexOf("/") + 1) : "";
    meta.title = folder || stemOf(chosen.path) || "Untitled";
  }
  if (!meta.artist) meta.artist = "Unknown artist";

  // Audio
  const audioEntries = sameDir.filter((e) => AUDIO_EXT.has(extOf(e.path))).sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sameDir) {
    const ext = extOf(e.path);
    if (["wma", "aif", "aiff", "mp2"].includes(ext)) {
      warnings.push(`Unsupported audio format skipped: ${baseOf(e.path)}.`);
    }
  }
  const audio: ImportedAudio[] = [];
  for (const e of audioEntries) {
    const role = classifyStem(stemOf(e.path));
    if (role === null) continue; // preview etc.
    audio.push({ name: baseOf(e.path), role, blob: e.blob });
  }
  if (audio.length === 1 && audio[0]!.role !== "drums") audio[0]!.role = "full";
  if (!audio.length) warnings.push("No audio files found; the song can only be played silently.");
  else if (audio.some((a) => a.role === "other")) warnings.push("Some audio files were not recognized as stems and are tagged \"other\".");

  const allTimes = Object.values(parsed.notesByDifficulty).flatMap((n) => (n && n.length ? [n[0]!.timeSec] : []));
  if (meta.tempoMap?.length && allTimes.length) meta.startBpm = bpmAtTime(meta.tempoMap, Math.min(...allTimes));

  const format: ChartFormat = parsed.format;
  return { meta, format, notesByDifficulty: parsed.notesByDifficulty, audio, warnings };
}

function stripEmpty(m: SongMeta): Partial<SongMeta> {
  const out: Partial<SongMeta> = {};
  for (const [k, v] of Object.entries(m)) if (v !== "" && v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
