// Dependency-free icon generator. Run: node scripts/generate-icons.mjs
// Rasterises a simple "drum head + lightning bolt" mark into PNGs (zlib only) and writes an SVG favicon.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(outDir, { recursive: true });

const BG = [0x0d, 0x0d, 0x0f];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const RING = [0xff, 0x4a, 0x1c]; // red-orange
const HEAD = [0xc8, 0x14, 0x1e]; // deep red drum head
const HEAD_HI = [0xff, 0x7a, 0x1a]; // orange highlight
const STICK = [0xf2, 0xe6, 0xd0]; // bone white
const STICK_EDGE = [0x0d, 0x0d, 0x0f];

// Geometry in unit space (0..1), centred on (0.5, 0.5). All content lies within radius 0.40
// of the centre at scale 1, which is the maskable safe zone.
const BOLT = [[0.56,0.2],[0.33,0.54],[0.47,0.54],[0.41,0.8],[0.67,0.44],[0.52,0.44],[0.6,0.2]];
const R_RING = 0.4, R_RING_IN = 0.33, R_HEAD = 0.33;

function inPoly(x, y, p) {
  let w = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) w = !w;
  }
  return w;
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Colour at a unit-space point; scale > 1 zooms the mark in (for non-maskable icons).
function shade(x, y, scale) {
  const ux = 0.5 + (x - 0.5) / scale, uy = 0.5 + (y - 0.5) / scale;
  const r = Math.hypot(ux - 0.5, uy - 0.5);
  let c = mix(BG, [0x2a, 0x10, 0x10], Math.max(0, 1 - r / 0.7)); // faint warm glow
  if (r <= R_RING && r >= R_RING_IN) c = RING;
  else if (r < R_HEAD) c = mix(HEAD, HEAD_HI, Math.max(0, (0.5 - uy) * 1.2)); // lit from the top
  if (inPoly(ux, uy, BOLT)) c = STICK;
  return c;
}

function render(size, scale) {
  const SS = 3; // supersampling
  const px = Buffer.alloc(size * size * 3);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const c = shade((i + (si + 0.5) / SS) / size, (j + (sj + 0.5) / SS) / size, scale);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = (j * size + i) * 3, n = SS * SS;
    px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n;
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// "any" icons zoom the mark slightly; the maskable one keeps it inside the 80% safe zone.
const targets = [
  ['pwa-192x192.png', 192, 1.1],
  ['pwa-512x512.png', 512, 1.1],
  ['maskable-512x512.png', 512, 1.0],
  ['apple-touch-icon.png', 180, 1.0], // iOS applies its own rounding; keep full-bleed background
];
for (const [name, size, scale] of targets) {
  writeFileSync(join(outDir, name), png(size, render(size, scale)));
  console.log('wrote', name, `${size}x${size}`);
}

// SVG favicon (rounded square, same shapes)
const s = (n) => +(n * 64).toFixed(2);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(HEAD_HI)}"/><stop offset="0.7" stop-color="${hex(HEAD)}"/></linearGradient></defs>
<rect width="64" height="64" rx="12" fill="${hex(BG)}"/>
<circle cx="32" cy="32" r="${s((R_RING + R_RING_IN) / 2)}" fill="url(#h)" stroke="${hex(RING)}" stroke-width="${s(R_RING - R_RING_IN)}"/>
<polygon points="${BOLT.map((q) => q.map(s).join(",")).join(" ")}" fill="${hex(STICK)}"/>
</svg>
`;
writeFileSync(join(outDir, 'favicon.svg'), svg);
console.log('wrote favicon.svg');
