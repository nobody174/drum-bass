import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { importSongFiles } from "./importSong";
import { file } from "./testUtils";

// Vitest runs from the project root.
const dir = resolve("fixtures/synthetic/demo-rock") + "/";

interface Expected {
  difficulties: Record<"expert" | "easy", { tick: number; timeSec: number; piece: string }[]>;
}
const expected = JSON.parse(readFileSync(dir + "expected.json", "utf8")) as Expected;

const load = async () =>
  importSongFiles(readdirSync(dir).map((n) => file(n, new Uint8Array(readFileSync(dir + n)), `demo-rock/${n}`)));

describe("synthetic demo-rock fixture", () => {
  it("imports with metadata, stems and no warnings", async () => {
    const song = await load();
    expect(song.format).toBe("clonehero-mid");
    expect(song.meta).toMatchObject({ title: "Synthetic Demo Rock", delayMs: 0 });
    expect(song.meta.lengthSec).toBeGreaterThan(55);
    expect(song.audio.map((a) => [a.name, a.role])).toEqual([["drums.wav", "drums"], ["song.wav", "song"]]);
    expect(song.warnings).toEqual([]);
  });

  for (const diff of ["expert", "easy"] as const) {
    it(`${diff} notes match the generator's pattern (count, piece, timing across the tempo change)`, async () => {
      const song = await load();
      const got = song.notesByDifficulty[diff]!;
      const want = expected.difficulties[diff];
      expect(got.length).toBe(want.length);
      const key = (p: string) => p;
      // Compare as multisets per rounded time (several pieces share a time).
      const bucket = (list: { timeSec: number; piece: string }[]) => {
        const m = new Map<string, number>();
        for (const n of list) {
          const k = `${n.timeSec.toFixed(4)}|${key(n.piece)}`;
          m.set(k, (m.get(k) ?? 0) + 1);
        }
        return m;
      };
      expect(bucket(got)).toEqual(bucket(want));
      for (const n of got) expect(n.velocity).toBe(100);
    });
  }

  it("has known totals and tom/cymbal split", async () => {
    const e = (await load()).notesByDifficulty.expert!;
    const count = (p: string) => e.filter((n) => n.piece === p).length;
    expect(count("tom1")).toBe(8);
    expect(count("tom2")).toBe(8);
    expect(count("tom3")).toBe(8);
    expect(count("crash1")).toBe(8);
    expect(count("kick")).toBe(32 * 3 + 1);
    expect(count("snare")).toBe(64);
    expect(count("hihat")).toBe(116); // bars 1-16: 8/bar minus 4 fills (2 each) minus 4 crash beats
    expect(count("ride")).toBe(116); // bars 17-32, same arithmetic
    // Tempo change: bar 17 starts at 32 s, last bar ends near 59.4 s.
    const bar17Kick = e.find((n) => n.piece === "kick" && n.timeSec >= 32 - 1e-6)!;
    expect(bar17Kick.timeSec).toBeCloseTo(32, 4);
    expect(e.at(-1)!.timeSec).toBeGreaterThan(58);
    expect(e.at(-1)!.timeSec).toBeLessThan(59.5);
  });
});
