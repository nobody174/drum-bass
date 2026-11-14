import { describe, expect, it } from "vitest";
import { parseParams, playHref } from "./params";

const present = ["easy", "medium"] as const;
const parse = (qs: string) => parseParams(new URLSearchParams(qs), [...present], ["song"]);

describe("parseParams", () => {
  it("defaults the count-in to 4 beats when the param is absent or empty", () => {
    expect(parse("d=easy").countIn).toBe(4);
    expect(parse("c=").countIn).toBe(4);
  });
  it("honours an explicit count-in, including 0", () => {
    expect(parse("c=0").countIn).toBe(0);
    expect(parse("c=2").countIn).toBe(2);
    expect(parse("c=99").countIn).toBe(4);
    expect(parse("c=abc").countIn).toBe(4);
  });
  it("falls back to a present difficulty and a valid mix", () => {
    expect(parse("d=expert&m=bogus")).toMatchObject({ difficulty: "medium", mix: "full" });
  });
});

describe("display params", () => {
  it("reads v and a and clamps the approach time", () => {
    expect(parse("v=kit&a=2").display).toBe("kit");
    expect(parse("v=kit&a=2").approach).toBe(2);
    expect(parse("v=lanes&a=99").approach).toBe(2.5);
    expect(parse("v=lanes&a=0.1").approach).toBe(0.8);
  });
  it("falls back to lanes and 1.5 s when absent or invalid", () => {
    expect(parse("v=bogus").display).toBe("lanes");
    expect(parse("").approach).toBe(1.5);
  });
  it("playHref carries the mode so a run restarts in the same mode", () => {
    const href = playHref("abc", { difficulty: "easy", mix: "full", countIn: 4, display: "kit", approach: 1.8 });
    expect(href).toContain("v=kit");
    expect(href).toContain("a=1.8");
  });
});
