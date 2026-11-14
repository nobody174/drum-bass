import { describe, expect, it } from "vitest";
import { COLORBLIND_COLORS, PALETTE_BACKGROUND, PALETTE_PREVIEW, applyPalette, contrastRatio } from "./palette";
import type { KitPreset, KitPiece, PieceId } from "../kit/types";

const ids = Object.keys(COLORBLIND_COLORS) as PieceId[];
const piece = (id: PieceId, color = "#123456"): KitPiece => ({ id, kind: "drum", x: 0.5, y: 0.5, size: 0.2, color, midiNotes: {} });
const preset: KitPreset = { id: "p", name: "P", pieces: ids.map((i) => piece(i)), locked: false, mirrored: false, updatedAt: 1 };

const dist = (a: string, b: string) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return Math.hypot((x >> 16) - (y >> 16), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255));
};

describe("palette", () => {
  it("false returns the preset unchanged", () => {
    expect(applyPalette(preset, false)).toBe(preset);
  });
  it("true returns a new preset and does not mutate the input", () => {
    const out = applyPalette(preset, true);
    expect(out).not.toBe(preset);
    expect(preset.pieces[0]!.color).toBe("#123456");
    expect(out.pieces.map((p) => p.color)).toEqual(ids.map((i) => COLORBLIND_COLORS[i]));
    expect(out.pieces[0]!.x).toBe(0.5);
  });
  it("is deterministic and keeps unknown piece colors", () => {
    expect(applyPalette(preset, true)).toEqual(applyPalette(preset, true));
    const odd = { ...preset, pieces: [piece("kick"), { ...piece("kick"), id: "weird" as PieceId, color: "#abcdef" }] };
    expect(applyPalette(odd, true).pieces[1]!.color).toBe("#abcdef");
  });
  it("all colors are distinct and well separated", () => {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        expect(dist(COLORBLIND_COLORS[ids[i]!], COLORBLIND_COLORS[ids[j]!]), `${ids[i]} vs ${ids[j]}`).toBeGreaterThanOrEqual(30);
  });
  it("all colors have >= 3:1 contrast on the dark background", () => {
    for (const id of ids) expect(contrastRatio(COLORBLIND_COLORS[id], PALETTE_BACKGROUND), id).toBeGreaterThanOrEqual(3);
  });
  it("preview matches the palette", () => {
    for (const p of PALETTE_PREVIEW) expect(p.color).toBe(COLORBLIND_COLORS[p.id]);
  });
});
