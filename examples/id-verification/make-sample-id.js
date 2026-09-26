#!/usr/bin/env node
// Dependency-free PNG generator used by the acceptance test.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  I: [14, 4, 4, 4, 4, 4, 14],
  L: [16, 16, 16, 16, 16, 16, 31],
  N: [17, 25, 25, 21, 19, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  R: [30, 17, 17, 30, 20, 18, 17],
  V: [17, 17, 17, 17, 17, 10, 4],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

const WIDTH = 480;
const HEIGHT = 160;
const SCALE = 6;
const MARGIN_X = 24;
const LINE_HEIGHT = 60;

function drawText(pixels, text, x0, y0) {
  let x = x0;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) {
      x += 6 * SCALE;
      continue;
    }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if ((glyph[row] >> (4 - col)) & 1) {
          for (let dy = 0; dy < SCALE; dy++) {
            for (let dx = 0; dx < SCALE; dx++) {
              const px = x + col * SCALE + dx;
              const py = y0 + row * SCALE + dy;
              if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT) {
                const index = (py * WIDTH + px) * 3;
                pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
              }
            }
          }
        }
      }
    }
    x += 6 * SCALE;
  }
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function createIdPng(lines) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3, 255);
  lines.forEach((line, index) => drawText(pixels, line, MARGIN_X, 24 + index * LINE_HEIGHT));
  const raw = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (WIDTH * 3 + 1)] = 0;
    pixels.copy(raw, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { createIdPng, FONT, WIDTH, HEIGHT, SCALE, MARGIN_X, LINE_HEIGHT };

if (require.main === module) {
  const output = process.argv[2] || path.join(__dirname, 'sample-id.png');
  const lines = process.argv.length > 3 ? process.argv.slice(3) : ['ADA LOVELACE', 'ID CARD'];
  fs.writeFileSync(output, createIdPng(lines));
  console.log(`wrote ${output}`);
}