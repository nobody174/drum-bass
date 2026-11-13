import { describe, expect, it } from "vitest";
import { parseSongIni } from "./songIni";

describe("song.ini", () => {
  it("parses typical fields", () => {
    const m = parseSongIni("[song]\nname = My Song\nartist=Someone\nalbum = Alb\nyear = , 1999\ncharter = Bob\ndelay = 150\nsong_length = 183500\n");
    expect(m).toEqual({ title: "My Song", artist: "Someone", album: "Alb", year: "1999", charter: "Bob", delayMs: 150, lengthSec: 183.5 });
  });

  it("is tolerant of BOM, case, CRLF, whitespace, comments", () => {
    const m = parseSongIni("﻿  [Song]  \r\n; comment\r\n  NAME   =   Title With = Sign \r\n  Artist = A\r\nFrets = Fred\r\n[other]\r\nname = nope\r\n");
    expect(m.title).toBe("Title With = Sign");
    expect(m.artist).toBe("A");
    expect(m.charter).toBe("Fred");
    expect(m.delayMs).toBe(0);
  });

  it("prefers charter over frets and survives junk", () => {
    expect(parseSongIni("[song]\nfrets=a\ncharter=b\ndelay=abc\n")).toMatchObject({ charter: "b", delayMs: 0 });
    expect(parseSongIni("")).toEqual({ title: "", artist: "", delayMs: 0 });
  });

  it("accepts negative delay and header-less files", () => {
    expect(parseSongIni("name = X\ndelay = -250").delayMs).toBe(-250);
    expect(parseSongIni("name = X").title).toBe("X");
  });
});
