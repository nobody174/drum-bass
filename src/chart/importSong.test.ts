import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { importSongFiles, classifyStem, isUnsafePath, DEFAULT_LIMITS } from "./importSong";
import { buildMidi, file } from "./testUtils";

const chMidi = () => buildMidi({ tracks: [{ name: "PART DRUMS", notes: [{ midi: 96, ticks: 0 }, { midi: 97, ticks: 480 }, { midi: 110, ticks: 0, durationTicks: 5 }] }] });
const gmMidi = () => buildMidi({ tracks: [{ channel: 9, notes: [{ midi: 36, ticks: 0 }, { midi: 38, ticks: 480 }] }] });
const INI = "[song]\nname = Folder Song\nartist = Folk\ndelay = 40\n";
const chartText = "[Song]\n{\n  Resolution = 192\n}\n[ExpertDrums]\n{\n  0 = N 0 0\n}\n";

describe("classifyStem", () => {
  it("classifies stems by filename", () => {
    expect(classifyStem("drums")).toBe("drums");
    expect(classifyStem("drums_1")).toBe("drums");
    expect(classifyStem("Drums_2")).toBe("drums");
    expect(classifyStem("song")).toBe("song");
    expect(classifyStem("guitar")).toBe("guitar");
    expect(classifyStem("bass")).toBe("bass");
    expect(classifyStem("vocals_1")).toBe("vocals");
    expect(classifyStem("rhythm")).toBe("rhythm");
    expect(classifyStem("keys")).toBe("keys");
    expect(classifyStem("crowd")).toBe("crowd");
    expect(classifyStem("weird")).toBe("other");
    expect(classifyStem("preview")).toBeNull();
  });
});

describe("importSongFiles: folder selection", () => {
  it("imports a Clone Hero folder with stems", async () => {
    const song = await importSongFiles([
      file("notes.mid", chMidi(), "My Song/notes.mid"),
      file("song.ini", INI, "My Song/song.ini"),
      file("drums_1.ogg", "x", "My Song/drums_1.ogg"),
      file("drums_2.ogg", "x", "My Song/drums_2.ogg"),
      file("song.ogg", "x", "My Song/song.ogg"),
      file("guitar.opus", "x", "My Song/guitar.opus"),
      file("preview.ogg", "x", "My Song/preview.ogg"),
      file("album.png", "x", "My Song/album.png"),
    ]);
    expect(song.format).toBe("clonehero-mid");
    expect(song.meta).toMatchObject({ title: "Folder Song", artist: "Folk", delayMs: 40 });
    expect(song.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["kick", "snare"]);
    expect(song.audio.map((a) => [a.name, a.role])).toEqual([
      ["drums_1.ogg", "drums"], ["drums_2.ogg", "drums"], ["guitar.opus", "guitar"], ["song.ogg", "song"],
    ]);
    expect(song.warnings).toEqual([]);
  });

  it("falls back to notes.chart and folder-name title without song.ini", async () => {
    const song = await importSongFiles([
      { name: "notes.chart", blob: new Blob([chartText]) },
      { name: "backing.mp3", blob: new Blob(["x"]) },
    ]);
    expect(song.format).toBe("clonehero-chart");
    expect(song.meta.title).toBe("notes");
    expect(song.meta.artist).toBe("Unknown artist");
    expect(song.audio).toHaveLength(1);
    expect(song.audio[0]!.role).toBe("full");
    expect(song.warnings.join(" ")).toMatch(/song\.ini/);
  });

  it("prefers notes.mid over notes.chart and falls back if the mid has no drums", async () => {
    const both = await importSongFiles([file("notes.chart", chartText), file("notes.mid", chMidi())]);
    expect(both.format).toBe("clonehero-mid");
    const bad = await importSongFiles([
      file("notes.mid", buildMidi({ tracks: [{ name: "PART GUITAR", notes: [] }] })),
      file("notes.chart", chartText),
    ]);
    expect(bad.format).toBe("clonehero-chart");
    expect(bad.warnings.length).toBeGreaterThan(0);
  });

  it("only takes audio from the chart folder when several folders are selected", async () => {
    const song = await importSongFiles([
      file("notes.mid", chMidi(), "a/notes.mid"),
      file("song.ogg", "x", "a/song.ogg"),
      file("song.ogg", "x", "b/song.ogg"),
    ]);
    expect(song.audio).toHaveLength(1);
  });

  it("throws for hard problems", async () => {
    await expect(importSongFiles([])).rejects.toThrow(/No files/);
    await expect(importSongFiles([file("song.ogg", "x")])).rejects.toThrow(/No chart found/);
    await expect(importSongFiles([file("notes.mid", new Uint8Array([1, 2, 3]))])).rejects.toThrow(/No usable drum chart/);
  });

  it("warns about missing audio", async () => {
    const song = await importSongFiles([file("notes.mid", chMidi())]);
    expect(song.audio).toEqual([]);
    expect(song.warnings.join(" ")).toMatch(/No audio/);
  });
});

describe("importSongFiles: lone .mid", () => {
  it("imports a GM file", async () => {
    const song = await importSongFiles([file("groove.mid", gmMidi())]);
    expect(song.format).toBe("gm-midi");
    expect(song.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["kick", "snare"]);
    expect(song.meta.title).toBe("groove");
    expect(song.warnings.join(" ")).toMatch(/General MIDI/);
  });

  it("imports a Clone Hero style .mid by content", async () => {
    const song = await importSongFiles([file("whatever.mid", chMidi())]);
    expect(song.format).toBe("clonehero-mid");
  });
});

describe("importSongFiles: zip", () => {
  const zip = (files: Record<string, Uint8Array>) => new File([zipSync(files) as BlobPart], "pack.zip");

  it("imports a zip with a top-level folder", async () => {
    const song = await importSongFiles([
      zip({
        "Cool Song/notes.mid": chMidi(),
        "Cool Song/song.ini": strToU8(INI),
        "Cool Song/drums.ogg": strToU8("x"),
        "Cool Song/song.ogg": strToU8("x"),
        "__MACOSX/Cool Song/._notes.mid": strToU8("junk"),
      }),
    ]);
    expect(song.meta.title).toBe("Folder Song");
    expect(song.audio.map((a) => a.role).sort()).toEqual(["drums", "song"]);
    expect(song.audio[0]!.blob.size).toBe(1);
    expect(song.warnings).toEqual([]);
  });

  it("skips path traversal entries with a warning and never uses them", async () => {
    const song = await importSongFiles([
      zip({
        "notes.mid": chMidi(),
        "../evil.ogg": strToU8("x"),
        "/abs/evil2.ogg": strToU8("x"),
        "a/../../evil3.ogg": strToU8("x"),
        "ok.ogg": strToU8("x"),
      }),
    ]);
    expect(song.audio.map((a) => a.name)).toEqual(["ok.ogg"]);
    expect(song.warnings.filter((w) => /unsafe path/.test(w))).toHaveLength(3);
    expect(isUnsafePath("C:\\x\\y.ogg")).toBe(true);
    expect(isUnsafePath("a/b/c.ogg")).toBe(false);
  });

  it("enforces entry and size caps", async () => {
    const files: Record<string, Uint8Array> = { "notes.mid": chMidi() };
    for (let i = 0; i < 5; i++) files[`f${i}.ogg`] = strToU8("x");
    await expect(importSongFiles([zip(files)], { maxEntries: 3 })).rejects.toThrow(/too many entries/);
    await expect(importSongFiles([zip({ "notes.mid": chMidi(), "big.ogg": new Uint8Array(5000) })], { maxUncompressedBytes: 1000 })).rejects.toThrow(/too large/);
  });

  it("rejects a corrupt zip and an empty zip", async () => {
    await expect(importSongFiles([new File([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], "bad.zip")])).rejects.toThrow(/zip/i);
    await expect(importSongFiles([zip({})])).rejects.toThrow();
  });
});

describe("importSongFiles: zip memory safety and tempo", () => {
  const zip = (files: Record<string, Uint8Array>) => new File([zipSync(files) as BlobPart], "pack.zip");

  it("never inflates video, images or other non-song entries (they do not count toward the cap)", async () => {
    const song = await importSongFiles(
      [zip({ "notes.mid": chMidi(), "song.ogg": strToU8("x"), "video.mp4": new Uint8Array(50_000), "cover.png": new Uint8Array(50_000), "notes.txt": strToU8("hi") })],
      { maxUncompressedBytes: 1000 },
    );
    expect(song.audio.map((a) => a.name)).toEqual(["song.ogg"]);
    expect(song.warnings.join(" ")).toMatch(/Skipped 3 unneeded files/);
  });

  it("still enforces the cap on wanted entries, and the default cap is 400 MB", async () => {
    await expect(importSongFiles([zip({ "notes.mid": chMidi(), "big.ogg": new Uint8Array(5000) })], { maxUncompressedBytes: 1000 })).rejects.toThrow(/too large/);
    expect(DEFAULT_LIMITS.maxUncompressedBytes).toBe(400 * 1024 ** 2);
    expect(DEFAULT_LIMITS.maxEntries).toBe(5000);
  });

  it("counts skipped entries toward the entry cap and keeps path traversal rejection", async () => {
    const files: Record<string, Uint8Array> = { "notes.mid": chMidi() };
    for (let i = 0; i < 5; i++) files[`pic${i}.jpg`] = strToU8("x");
    await expect(importSongFiles([zip(files)], { maxEntries: 3 })).rejects.toThrow(/too many entries/);
    const song = await importSongFiles([zip({ "notes.mid": chMidi(), "../evil.ogg": strToU8("x"), "a/../../evil.mid": strToU8("x") })]);
    expect(song.warnings.filter((w) => /unsafe path/.test(w))).toHaveLength(2);
  });

  it("reports unsupported audio formats without inflating them", async () => {
    const song = await importSongFiles([zip({ "notes.mid": chMidi(), "song.wma": new Uint8Array(5000) })], { maxUncompressedBytes: 1000 });
    expect(song.warnings.join(" ")).toMatch(/Unsupported audio format skipped: song\.wma/);
  });

  it("stores the chart tempo map, start tempo and time signature in the song meta", async () => {
    const mid = buildMidi({
      tempos: [{ ticks: 0, bpm: 100 }, { ticks: 960, bpm: 150 }],
      tracks: [{ name: "PART DRUMS", notes: [{ midi: 96, ticks: 0 }, { midi: 97, ticks: 1200 }] }],
    });
    const song = await importSongFiles([file("notes.mid", mid)]);
    expect(song.meta.tempoMap).toEqual([{ timeSec: 0, bpm: 100 }, { timeSec: 1.2, bpm: 150 }]);
    expect(song.meta.startBpm).toBe(100);
    expect(song.meta.beatsPerBar).toBeUndefined(); // no time signature in the file: consumers assume 4
  });

  it("uses the tempo at the first note, not at tick 0, for startBpm", async () => {
    const mid = buildMidi({
      tempos: [{ ticks: 0, bpm: 100 }, { ticks: 480, bpm: 150 }],
      tracks: [{ name: "PART DRUMS", notes: [{ midi: 96, ticks: 960 }] }],
    });
    const song = await importSongFiles([file("notes.mid", mid)]);
    expect(song.meta.startBpm).toBe(150);
  });

  it(".chart: tempo map and time signature", async () => {
    const chart = "[Song]\n{\n  Resolution = 192\n}\n[SyncTrack]\n{\n  0 = TS 3\n  0 = B 90000\n  384 = B 120000\n}\n[ExpertDrums]\n{\n  0 = N 0 0\n}\n";
    const song = await importSongFiles([{ name: "notes.chart", blob: new Blob([chart]) }]);
    expect(song.meta.tempoMap).toEqual([{ timeSec: 0, bpm: 90 }, { timeSec: expect.closeTo(1.333, 2), bpm: 120 }]);
    expect(song.meta.beatsPerBar).toBe(3);
    expect(song.meta.startBpm).toBe(90);
  });
});
