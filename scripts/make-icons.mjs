// Draws the extension icon as PNGs in icons/: the natzir.com tools tile (Passage Lens family) with
// lines of content and one amber ad block across the page. Shapes are in a 128 × 128 grid,
// antialiased by 4 × 4 supersampling.
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TILE = { x: 0, y: 0, w: 128, h: 128, r: 28, color: [23, 34, 36], alpha: 1 };
const SHAPES = [
  { x: 20, y: 22, w: 88, h: 11, r: 5.5, color: [255, 255, 255], alpha: 0.92 },
  { x: 20, y: 42, w: 64, h: 11, r: 5.5, color: [149, 165, 166], alpha: 0.6 },
  { x: 20, y: 62, w: 88, h: 30, r: 8, color: [245, 158, 11], alpha: 1 },
  { x: 20, y: 101, w: 52, h: 11, r: 5.5, color: [255, 255, 255], alpha: 0.92 },
];

const inside = (u, v, s) => {
  if (u < s.x || u > s.x + s.w || v < s.y || v > s.y + s.h) return false;
  const dx = Math.max(s.x + s.r - u, 0, u - (s.x + s.w - s.r));
  const dy = Math.max(s.y + s.r - v, 0, v - (s.y + s.h - s.r));
  return dx * dx + dy * dy <= s.r * s.r;
};

export function iconPixel(x, y, size) {
  const n = 4;
  const sum = [0, 0, 0];
  let covered = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u = ((x + (i + 0.5) / n) * 128) / size;
      const v = ((y + (j + 0.5) / n) * 128) / size;
      if (!inside(u, v, TILE)) continue;
      let color = TILE.color;
      for (const s of SHAPES) if (inside(u, v, s)) color = color.map((c, k) => s.color[k] * s.alpha + c * (1 - s.alpha));
      color.forEach((c, k) => { sum[k] += c; });
      covered += 1;
    }
  }
  if (!covered) return [0, 0, 0, 0];
  return [...sum.map((c) => Math.round(c / covered)), Math.round((covered / (n * n)) * 255)];
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) raw.set(iconPixel(x, y, size), y * stride + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync('icons', { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(`icons/${size}.png`, png(size));
}
