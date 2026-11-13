import { describe, expect, it } from "vitest";
import { gainsForStems, planMix } from "./stems";

describe("planMix", () => {
  it("full mixes every stem when there is no full stem", () => {
    expect(planMix(["drums", "song", "guitar"], "full").gainsByRole).toEqual({ drums: 1, song: 1, guitar: 1 });
  });
  it("full uses only the full stem when present (no doubling)", () => {
    expect(planMix(["full", "drums", "bass"], "full").gainsByRole).toEqual({ full: 1, drums: 0, bass: 0 });
  });
  it("nodrums drops drums and keeps the rest", () => {
    const p = planMix(["drums", "song", "bass"], "nodrums");
    expect(p.gainsByRole).toEqual({ drums: 0, song: 1, bass: 1 });
    expect(p.nodrumsAvailable).toBe(true);
  });
  it("nodrums ignores the full stem when real non-drum stems exist", () => {
    expect(planMix(["full", "drums", "song"], "nodrums").gainsByRole).toEqual({ full: 0, drums: 0, song: 1 });
  });
  it("nodrums falls back to the full mix and flags it", () => {
    const p = planMix(["full"], "nodrums");
    expect(p.gainsByRole).toEqual({ full: 1 });
    expect(p.nodrumsAvailable).toBe(false);
  });
  it("nodrums with only drums is silent and flagged", () => {
    const p = planMix(["drums"], "nodrums");
    expect(p.gainsByRole).toEqual({ drums: 0 });
    expect(p.nodrumsAvailable).toBe(false);
  });
  it("drumsonly plays only drums, flags when missing", () => {
    expect(planMix(["drums", "song"], "drumsonly")).toMatchObject({
      gainsByRole: { drums: 1, song: 0 },
      drumsonlyAvailable: true,
    });
    expect(planMix(["full", "song"], "drumsonly")).toMatchObject({
      gainsByRole: { full: 0, song: 0 },
      drumsonlyAvailable: false,
    });
  });
  it("clickonly mutes everything", () => {
    expect(Object.values(planMix(["drums", "full", "song"], "clickonly").gainsByRole)).toEqual([0, 0, 0]);
  });
  it("gainsForStems follows input order and shares gain between same roles", () => {
    expect(gainsForStems(["song", "drums", "song"], "nodrums")).toEqual([1, 0, 1]);
    expect(gainsForStems([], "full")).toEqual([]);
  });
});
