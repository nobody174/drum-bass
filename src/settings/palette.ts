import type { KitPreset, PieceId } from "../kit/types";

/**
 * Colorblind-friendly piece colors. Drums use the Okabe-Ito categorical palette (distinguishable
 * under the common color-vision deficiencies); cymbals are neutral greys/white so "drum vs cymbal" is
 * also readable without hue. Every color has >= 3:1 contrast against the dark stage background.
 */
export const COLORBLIND_COLORS: Record<PieceId, string> = {
  kick: "#e69f00",
  snare: "#d55e00",
  hihat: "#f0e442",
  tom1: "#56b4e9",
  tom2: "#009e73",
  tom3: "#cc79a7",
  tom4: "#3d8fd1",
  crash1: "#ffffff",
  crash2: "#9a9a9a",
  crash3: "#6e6e6e",
  ride: "#c8c8c8",
  splash: "#b8f0e8",
  china: "#ff9ec4",
};

/** Dark theme background the colors are validated against. */
export const PALETTE_BACKGROUND = "#0d0d0f";

/** Pieces shown in the Settings live preview (label + colorblind color + the default theme color). */
export const PALETTE_PREVIEW: { id: PieceId; label: string; color: string; normal: string }[] = [
  { id: "kick", label: "Kick", color: COLORBLIND_COLORS.kick, normal: "#ff7a1a" },
  { id: "snare", label: "Snare", color: COLORBLIND_COLORS.snare, normal: "#e5232b" },
  { id: "hihat", label: "Hi-hat", color: COLORBLIND_COLORS.hihat, normal: "#f5d90a" },
  { id: "tom1", label: "Tom 1", color: COLORBLIND_COLORS.tom1, normal: "#3b82f6" },
  { id: "tom2", label: "Tom 2", color: COLORBLIND_COLORS.tom2, normal: "#14b8a6" },
  { id: "tom3", label: "Tom 3", color: COLORBLIND_COLORS.tom3, normal: "#8b5cf6" },
  { id: "crash1", label: "Crash", color: COLORBLIND_COLORS.crash1, normal: "#22d3ee" },
  { id: "ride", label: "Ride", color: COLORBLIND_COLORS.ride, normal: "#e8f1f5" },
];

/** Returns a new preset; with colorblind=false the same preset object is returned unchanged. */
export function applyPalette(preset: KitPreset, colorblind: boolean): KitPreset {
  if (!colorblind) return preset;
  return {
    ...preset,
    pieces: preset.pieces.map((p) => ({ ...p, color: COLORBLIND_COLORS[p.id] ?? p.color })),
  };
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
