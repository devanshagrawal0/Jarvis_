"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// CRC32 lookup table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcVal]);
}

function makePNG(size, drawFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = drawFn(x, y, size);
      row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
    }
    rows.push(row);
  }

  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawJarvisIcon(x, y, size) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.46;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Background
  const bg = [2, 8, 14];

  // Outer glow ring
  const ringOuter = r, ringInner = r - size * 0.055;
  if (dist <= ringOuter && dist >= ringInner) {
    const t = Math.sin(Math.PI * (dist - ringInner) / (ringOuter - ringInner));
    return [Math.round(t * 0), Math.round(bg[1] + t * (210 - bg[1])), Math.round(bg[2] + t * (195 - bg[2]))];
  }

  // Inside ring
  if (dist < ringInner) {
    // Subtle inner fill — very dark teal tint
    const fill = [3, 14, 20];

    // Center diamond / hex shape (the "J" glyph)
    const adx = Math.abs(dx) / (size * 0.13);
    const ady = Math.abs(dy) / (size * 0.13);

    // Hexagonal approximation: max(adx, ady, (adx+ady)*0.67)
    const hex = Math.max(adx, ady, (adx + ady) * 0.67);
    if (hex < 1.0) {
      // Bright cyan core
      const glow = Math.max(0, 1 - hex);
      return [
        Math.round(fill[0] + glow * (0 - fill[0])),
        Math.round(fill[1] + glow * (230 - fill[1])),
        Math.round(fill[2] + glow * (210 - fill[2])),
      ];
    }

    // Inner subtle arc lines (radial tick marks at 60° intervals)
    const angle = Math.atan2(dy, dx);
    const normalized = ((angle / Math.PI) * 180 + 360) % 360;
    const nearTick = [0, 60, 120, 180, 240, 300].some(a => {
      const diff = Math.abs(((normalized - a + 540) % 360) - 180);
      return diff < 2.5 && dist > ringInner * 0.55 && dist < ringInner * 0.85;
    });
    if (nearTick) return [0, 120, 110];

    return fill;
  }

  return bg;
}

const outDir = path.join(__dirname, "..", "public", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = makePNG(size, drawJarvisIcon);
  const out = path.join(outDir, `phone-icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`✓ ${out} (${(png.length / 1024).toFixed(1)} KB)`);
}
