// Generates the PWA icons (PNG) with no dependencies: teal background, white medical cross with a
// location pin dot. Run with: npm run icons   (output is committed, so this is only needed to restyle)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 3x3 supersampling for smooth edges
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const [pr, pg, pb] = pixel((x + (sx + 0.5) / 3) / size, (y + (sy + 0.5) / 3) / size);
          r += pr; g += pg; b += pb;
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(r / 9); raw[o + 1] = Math.round(g / 9); raw[o + 2] = Math.round(b / 9); raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const TEAL = [15, 118, 110];
const DARK = [11, 92, 86];
const WHITE = [255, 255, 255];

const inRoundRect = (u, v, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return u >= x0 && u <= x1 && v >= y0 && v <= y1 && (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
};

// All content stays inside the central 60% so the same artwork works as a "maskable" icon.
function icon(u, v) {
  const bg = v > 0.5 ? DARK : TEAL;
  const arm = 0.085;
  const cross = inRoundRect(u, v, 0.5 - arm, 0.25, 0.5 + arm, 0.75, 0.04) || inRoundRect(u, v, 0.25, 0.5 - arm, 0.75, 0.5 + arm, 0.04);
  const dot = (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.045 ** 2;
  if (dot) return TEAL;
  return cross ? WHITE : bg;
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(join(out, name), png(size, icon));
  console.log("wrote", name);
}
