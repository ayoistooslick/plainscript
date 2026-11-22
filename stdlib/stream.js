// Streams remain Node streams. These helpers add UTF-8 text collection,
// composition and a promise-returning pipeline without hiding backpressure:
// write() still returns false when the consumer is saturated.

import { Readable, Transform, Writable } from 'node:stream';
import { pipeline as nodePipeline } from 'node:stream/promises';

export { Readable, Writable, Transform };

export function fromText(text) {
  return Readable.from([Buffer.from(String(text), 'utf8')]);
}

export function fromBytes(bytes) {
  if (!Array.isArray(bytes)) throw new TypeError('std/stream.fromBytes expects a list of byte values');
  for (const value of bytes) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError('std/stream.fromBytes: each value must be an integer between 0 and 255');
    }
  }
  return Readable.from([Buffer.from(bytes)]);
}

export function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

export function collectBytes(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Array.from(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
}

export function writeAll(stream, text) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.end(String(text), (failure) => (failure ? reject(failure) : resolve(null)));
  });
}

export function pipeline(source, target) {
  return nodePipeline(source, target);
}

export function transform(f) {
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        callback(null, String(f(chunk.toString('utf8'))));
      } catch (failure) {
        callback(failure);
      }
    },
  });
}
