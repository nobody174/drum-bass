import { describe, expect, it } from "vitest";
import { parseCloneHeroChart } from "./cloneHeroChart";

const chart = (body: string, res = 192) => `﻿[Song]\r
{\r
  Name = "Chart Song"\r
  Artist = "Band"\r
  Resolution = ${res}\r
}\r
[SyncTrack]\r
{\r
  0 = TS 4\r
  0 = B 120000\r
  384 = B 60000\r
}\r
[Events]\r
{\r
  0 = E "section Intro"\r
}\r
${body}`;

describe(".chart parser", () => {
  it("parses lanes, cymbal flags, 2x kick and tempo changes", () => {
    const text = chart(`[ExpertDrums]
{
  0 = N 0 0
  0 = N 2 0
  0 = N 66 0
  192 = N 1 0
  192 = N 3 0
  384 = N 4 0
  384 = N 68 0
  384 = N 3 0
  384 = N 67 0
  576 = N 32 0
  576 = N 34 0
  576 = S 2 100
}
[EasyDrums]
{
  0 = N 0 0
}
`);
    const r = parseCloneHeroChart(text);
    expect(r.format).toBe("clonehero-chart");
    expect(r.meta).toMatchObject({ title: "Chart Song", artist: "Band" });
    const e = r.notesByDifficulty.expert!;
    // tick 0: kick + yellow cymbal(hihat). tick 192: snare + blue tom. tick 384: green cymbal + blue cymbal. tick 576: 2x kick.
    expect(e.map((n) => `${n.timeSec.toFixed(3)}:${n.piece}`)).toEqual([
      "0.000:kick", "0.000:hihat",
      "0.500:snare", "0.500:tom2",
      "1.000:crash1", "1.000:ride",
      "2.000:kick",
    ]);
    expect(e.every((n) => n.velocity === 100)).toBe(true);
    expect(r.notesByDifficulty.easy).toHaveLength(1);
  });

  it("unflagged yellow/blue/green are toms", () => {
    const r = parseCloneHeroChart(chart(`[ExpertDrums]
{
  0 = N 2 0
  0 = N 3 0
  0 = N 4 0
}
`));
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["tom1", "tom2", "tom3"]);
  });

  it("detects 5-lane and defaults resolution", () => {
    const r = parseCloneHeroChart(`[Song]
{
}
[ExpertDrums]
{
  0 = N 4 0
  0 = N 5 0
}
`);
    expect(r.notesByDifficulty.expert!.map((n) => n.piece)).toEqual(["tom2", "crash1"]);
    expect(r.warnings.join(" ")).toMatch(/Resolution/);
    expect(r.warnings.join(" ")).toMatch(/5-lane/);
  });

  it("warns when there are no drum sections", () => {
    const r = parseCloneHeroChart(chart(`[ExpertSingle]
{
  0 = N 0 0
}
`));
    expect(r.notesByDifficulty).toEqual({});
    expect(r.warnings.join(" ")).toMatch(/No drum sections/);
  });
});
