// Compression is synchronous and returns base64 text. That is a deliberate
// boundary: a dedicated byte type would complicate every JSON and HTTP call,
// while base64 round-trips correctly through both.

import zlib from 'node:zlib';

const CODECS = {
  gzip: { compress: zlib.gzipSync, decompress: zlib.gunzipSync },
  deflate: { compress: zlib.deflateSync, decompress: zlib.inflateSync },
  brotli: { compress: zlib.brotliCompressSync, decompress: zlib.brotliDecompressSync },
};

function codecFor(format) {
  const name = String(format || 'gzip').toLowerCase();
  if (!CODECS[name]) throw new Error(`Unsupported compression format "${format}". Use gzip, deflate or brotli.`);
  return CODECS[name];
}

export function gzip(text) { return zlib.gzipSync(Buffer.from(text, 'utf8')).toString('base64'); }
export function gunzip(data) {
  try { return zlib.gunzipSync(Buffer.from(data, 'base64')).toString('utf8'); }
  catch (failure) { throw new Error(`gzip decompression failed: ${failure.message}`); }
}

export function deflate(text) { return zlib.deflateSync(Buffer.from(text, 'utf8')).toString('base64'); }
export function inflate(data) {
  try { return zlib.inflateSync(Buffer.from(data, 'base64')).toString('utf8'); }
  catch (failure) { throw new Error(`deflate decompression failed: ${failure.message}`); }
}

export function brotli(text) { return zlib.brotliCompressSync(Buffer.from(text, 'utf8')).toString('base64'); }
export function unbrotli(data) {
  try { return zlib.brotliDecompressSync(Buffer.from(data, 'base64')).toString('utf8'); }
  catch (failure) { throw new Error(`brotli decompression failed: ${failure.message}`); }
}

export function compress(text, format = 'gzip') {
  return codecFor(format).compress(Buffer.from(text, 'utf8')).toString('base64');
}

export function decompress(data, format = 'gzip') {
  try {
    return codecFor(format).decompress(Buffer.from(data, 'base64')).toString('utf8');
  } catch (failure) {
    if (failure.message.startsWith('Unsupported compression')) throw failure;
    throw new Error(`${format} decompression failed: ${failure.message}`);
  }
}
