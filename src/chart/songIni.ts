import type { SongMeta } from "./types";

/** Parse one section of a Clone Hero song.ini into a lowercase-key map. Tolerant of BOM, case, whitespace. */
export function parseIniSection(text: string, section = "song"): Record<string, string> {
  const out: Record<string, string> = {};
  const loose: Record<string, string> = {};
  let current: string | null = null; // null = before any section header
  let sawWanted = false;
  for (const rawLine of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sec = /^\[(.*)\]$/.exec(line);
    if (sec) {
      current = sec[1]!.trim().toLowerCase();
      if (current === section) sawWanted = true;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (!key) continue;
    if (current === section) out[key] = value;
    else if (current === null) loose[key] = value;
  }
  // Header-less files: fall back to the loose keys.
  return sawWanted ? out : loose;
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
};

/** song.ini text -> SongMeta. Missing title/artist come back as empty strings (the importer fills fallbacks). */
export function parseSongIni(text: string): SongMeta {
  const ini = parseIniSection(text);
  const meta: SongMeta = {
    title: ini["name"] ?? "",
    artist: ini["artist"] ?? "",
    delayMs: num(ini["delay"]) ?? 0,
  };
  if (ini["album"]) meta.album = ini["album"];
  if (ini["year"]) meta.year = ini["year"].replace(/^,\s*/, "");
  const charter = ini["charter"] || ini["frets"];
  if (charter) meta.charter = charter;
  const len = num(ini["song_length"]);
  if (len !== undefined && len > 0) meta.lengthSec = len / 1000;
  return meta;
}
