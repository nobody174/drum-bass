import type { Difficulty, NoteEvent, ParsedChart, SongMeta } from "./types";
import { createTempoMap, beatsPerBarOf, type TempoChange } from "./tempo";
import { dedupeNotes, lanePiece, sortNotes, type Lane } from "./laneMap";

/**
 * `.chart` drum lanes: 0 kick, 1 red/snare, 2 yellow, 3 blue, 4 green (4-lane) or orange (5-lane),
 * 5 green (5-lane), 32 = 2x kick; cymbal flags 66/67/68 on the same tick make yellow/blue/green cymbals
 * (in `.chart`, no flag = tom). Flags 34..44 (accent/ghost) and others are ignored.
 * Lane numbers, 66/67/68 flags, 32, tom default, B (thousandths of BPM) and TS (power-of-two denominator)
 * VERIFIED against https://thenathannator.github.io/GuitarGame_ChartFormats/Chart-File-Formats/chart-format/Tracks/Drums
 * and .../Format-Overview. Resolution has no documented default (192 here is an assumption, with a warning).
 */
const SECTIONS: Record<string, Difficulty> = {
  expertdrums: "expert",
  harddrums: "hard",
  mediumdrums: "medium",
  easydrums: "easy",
};

interface Entry {
  tick: number;
  kind: string;
  args: string[];
}

function parseSections(text: string): Map<string, Entry[]> {
  const sections = new Map<string, Entry[]>();
  let current: Entry[] | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line === "{" || line === "}") continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      current = [];
      sections.set(head[1]!.trim().toLowerCase(), current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const left = line.slice(0, eq).trim();
    const right = line.slice(eq + 1).trim();
    const tick = Number(left);
    if (Number.isFinite(tick) && /^-?\d+$/.test(left)) {
      const parts = right.split(/\s+/);
      current.push({ tick, kind: parts[0]!.toUpperCase(), args: parts.slice(1) });
    } else {
      // key = value property (e.g. [Song] Resolution)
      current.push({ tick: NaN, kind: left.toLowerCase(), args: [right] });
    }
  }
  return sections;
}

const unquote = (s: string | undefined): string | undefined => {
  if (s === undefined) return undefined;
  const t = s.trim().replace(/^"(.*)"$/, "$1");
  return t || undefined;
};

export function parseCloneHeroChart(text: string): ParsedChart {
  const sections = parseSections(text);
  const warnings: string[] = [];
  const song = sections.get("song") ?? [];
  const prop = (k: string) => song.find((e) => Number.isNaN(e.tick) && e.kind === k)?.args[0];

  let ppq = Number(prop("resolution"));
  if (!(ppq > 0)) {
    ppq = 192;
    warnings.push("[Song] Resolution missing or invalid; assuming 192.");
  }

  const changes: TempoChange[] = [];
  for (const e of sections.get("synctrack") ?? []) {
    if (e.kind === "B") {
      const milli = Number(e.args[0]);
      if (milli > 0) changes.push({ tick: e.tick, usPerQuarter: 60e9 / milli });
    }
  }
  if (!changes.some((c) => c.tick === 0)) warnings.push("No tempo at tick 0 in [SyncTrack]; assuming 120 BPM.");
  const tempo = createTempoMap(ppq, changes);

  // Parse per difficulty; detect 5-lane across all sections.
  type Gem = { tick: number; lane: number; flags: Set<number> };
  const perDiff = new Map<Difficulty, Gem[]>();
  let fiveLane = false;
  for (const [name, diff] of Object.entries(SECTIONS)) {
    const entries = sections.get(name);
    if (!entries) continue;
    const byTick = new Map<number, { lanes: Set<number>; flags: Set<number> }>();
    for (const e of entries) {
      if (e.kind !== "N") continue;
      const lane = Number(e.args[0]);
      if (!Number.isInteger(lane)) continue;
      let slot = byTick.get(e.tick);
      if (!slot) byTick.set(e.tick, (slot = { lanes: new Set(), flags: new Set() }));
      if (lane >= 66 && lane <= 68) slot.flags.add(lane);
      else slot.lanes.add(lane);
      if (lane === 5) fiveLane = true;
    }
    const gems: Gem[] = [];
    for (const [tick, slot] of byTick) for (const lane of slot.lanes) gems.push({ tick, lane, flags: slot.flags });
    perDiff.set(diff, gems);
  }
  if (fiveLane) warnings.push("5-lane drum chart detected; yellow/orange are cymbals, blue/green toms.");

  const out: Partial<Record<Difficulty, NoteEvent[]>> = {};
  for (const [diff, gems] of perDiff) {
    const notes: NoteEvent[] = [];
    for (const g of gems) {
      let lane: Lane | undefined;
      let cymbalFlag = 0;
      switch (g.lane) {
        case 0: lane = "kick"; break;
        case 32: lane = "kick2x"; break;
        case 1: lane = "red"; break;
        case 2: lane = "yellow"; cymbalFlag = 66; break;
        case 3: lane = "blue"; cymbalFlag = 67; break;
        case 4: lane = fiveLane ? "orange" : "green"; cymbalFlag = 68; break;
        case 5: lane = "green"; break;
        default: break; // forced/ghost/etc.
      }
      if (!lane) continue;
      const isCymbal = cymbalFlag !== 0 && g.flags.has(cymbalFlag);
      const piece = lanePiece(lane, !isCymbal, fiveLane);
      const kind = cymbalFlag ? (isCymbal ? "cymbal" : "tom") : null;
      notes.push({
        timeSec: tempo.ticksToSeconds(g.tick),
        piece,
        velocity: 100,
        source: `${diff}:${lane}${kind ? "-" + kind : ""}`,
      });
    }
    if (notes.length) out[diff] = dedupeNotes(sortNotes(notes));
  }
  if (!Object.keys(out).length) warnings.push("No drum sections ([ExpertDrums] etc.) with notes found in .chart.");

  const meta: Partial<SongMeta> = { tempoMap: tempo.points };
  const ts = (sections.get("synctrack") ?? []).filter((e) => e.kind === "TS" && Number(e.args[0]) > 0).sort((a, b) => a.tick - b.tick)[0];
  if (ts) meta.beatsPerBar = beatsPerBarOf(Number(ts.args[0]), 2 ** (ts.args[1] !== undefined ? Number(ts.args[1]) : 2));
  const name = unquote(prop("name"));
  if (name) meta.title = name;
  const artist = unquote(prop("artist"));
  if (artist) meta.artist = artist;
  const album = unquote(prop("album"));
  if (album) meta.album = album;
  const year = unquote(prop("year"));
  if (year) meta.year = year.replace(/^,\s*/, "");
  const charter = unquote(prop("charter"));
  if (charter) meta.charter = charter;

  return { format: "clonehero-chart", notesByDifficulty: out, meta, warnings };
}
