#!/usr/bin/env node
/**
 * Generates placeholder PWA icons as minimal PNG files for the Fables app.
 * Uses pure Node.js with no external dependencies — writes minimal valid PNGs
 * using raw byte construction. For production use, swap the SVG source file
 * and run through a proper rasterizer (e.g. sharp/imagemagick).
 *
 * Usage: node apps/web/scripts/gen-icons.mjs
 * Output: apps/web/public/icons/*.png
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

const SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];

// Fables brand colours
const BG_R = 0x1a,
  BG_G = 0x16,
  BG_B = 0x25; // #1a1625
const AC_R = 0xa7,
  AC_G = 0x8b,
  AC_B = 0xfa; // #a78bfa

function crc32(buf) {
  let crc = 0xffffffff;
  const table = crc32.table ?? (crc32.table = buildCrcTable());
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function buildCrcTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
}
function writeUint32BE(buf, offset, val) {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}
function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  writeUint32BE(len, 0, data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  writeUint32BE(crcBuf, 0, crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function makePng(size, maskable = false) {
  // IHDR
  const ihdrData = Buffer.alloc(13);
  writeUint32BE(ihdrData, 0, size);
  writeUint32BE(ihdrData, 4, size);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  // Build RGBA pixel data with a simple Fables icon
  const pixels = Buffer.alloc(size * size * 3);
  const cx = size / 2,
    cy = size / 2;
  const r = size * (maskable ? 0.5 : 0.4); // maskable: fill to edge; regular: circle with padding

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 3;
      const dx = x - cx,
        dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Corner radius for maskable (square fill); circle for regular
      const inside = maskable
        ? x >= size * 0.1 && x <= size * 0.9 && y >= size * 0.1 && y <= size * 0.9
        : dist <= r;

      if (!inside) {
        // transparent-ish background (white for browser compatibility)
        pixels[idx] = 0xff;
        pixels[idx + 1] = 0xff;
        pixels[idx + 2] = 0xff;
      } else {
        // Background
        let pr = BG_R,
          pg = BG_G,
          pb = BG_B;

        // Book spine (vertical bar in center)
        const spineW = size * 0.02;
        if (Math.abs(dx) < spineW) {
          pr = 0xff;
          pg = 0xff;
          pb = 0xff;
        }
        // Left page region
        else if (dx < 0 && dist < r * 0.85) {
          // Blend towards accent in book area
          const t = Math.max(0, 1 - dist / r);
          pr = Math.round(BG_R + (AC_R - BG_R) * t * 0.4);
          pg = Math.round(BG_G + (AC_G - BG_G) * t * 0.4);
          pb = Math.round(BG_B + (AC_B - BG_B) * t * 0.4);
        }
        // Right page region
        else if (dx > 0 && dist < r * 0.85) {
          const t = Math.max(0, 1 - dist / r);
          pr = Math.round(BG_R + (AC_R - BG_R) * t * 0.25);
          pg = Math.round(BG_G + (AC_G - BG_G) * t * 0.25);
          pb = Math.round(BG_B + (AC_B - BG_B) * t * 0.25);
        }

        // Horizontal lines on pages (text simulation)
        const relY = (y - cy) / r;
        if (Math.abs(dx) > size * 0.04 && relY > -0.3 && relY < 0.3) {
          const lineSpacing = size * 0.08;
          const inLine = (y + lineSpacing / 2) % lineSpacing < size * 0.015;
          if (inLine) {
            pr = Math.min(255, pr + 60);
            pg = Math.min(255, pg + 60);
            pb = Math.min(255, pb + 80);
          }
        }

        pixels[idx] = pr;
        pixels[idx + 1] = pg;
        pixels[idx + 2] = pb;
      }
    }
  }

  // Apply PNG filter (none=0 for each row) + deflate
  const rawRows = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    rawRows[y * (1 + size * 3)] = 0; // filter type: none
    pixels.copy(rawRows, y * (1 + size * 3) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const compressed = zlib.deflateSync(rawRows);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const regular = makePng(size, false);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), regular);
  console.log(`  icon-${size}.png (${regular.length} bytes)`);
}

// Maskable version at 192 and 512
for (const size of [192, 512]) {
  const maskable = makePng(size, true);
  fs.writeFileSync(path.join(outDir, `icon-${size}-maskable.png`), maskable);
  console.log(`  icon-${size}-maskable.png (${maskable.length} bytes)`);
}

// apple-touch-icon at 180
const appleIcon = makePng(180, false);
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), appleIcon);
console.log('  apple-touch-icon.png');

// favicon at 32
const favicon = makePng(32, false);
fs.writeFileSync(path.join(outDir, 'favicon-32.png'), favicon);
console.log('  favicon-32.png');

console.log('\nDone. Icons in apps/web/public/icons/');
