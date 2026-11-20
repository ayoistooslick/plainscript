'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const loadWs = () => import(pathToFileURL(path.join(ROOT, 'stdlib', 'ws.js')).toString());

function maskedFrame(opcode, payload, fin = true) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const mask = Buffer.from([1, 2, 3, 4]);
  const length = data.length;
  const header = [];
  header.push((fin ? 0x80 : 0) | opcode);
  if (length < 126) header.push(0x80 | length);
  else if (length < 65536) { header.push(0x80 | 126, length >> 8, length & 0xff); }
  else { header.push(0x80 | 127, 0, 0, 0, 0, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff); }
  const masked = Buffer.from(data);
  for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index % 4];
  return Buffer.concat([Buffer.from(header), mask, masked]);
}

async function connectRaw(port) {
  const socket = net.connect({ host: '127.0.0.1', port });
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  const waiters = [];
  const frames = [];
  const notify = () => {
    while (waiters.length) {
      const waiter = waiters[0];
      if (!waiter.predicate()) break;
      waiters.shift();
      waiter.resolve();
    }
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = buffer.slice(0, end).toString('latin1');
      if (!/101/.test(header)) { waiterError(new Error(header)); return; }
      upgraded = true;
      buffer = buffer.slice(end + 4);
    }
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (buffer.length < 10) break; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + length) break;
      frames.push({ opcode: first & 0x0f, fin: Boolean(first & 0x80), payload: buffer.slice(offset, offset + length) });
      buffer = buffer.slice(offset + length);
    }
    notify();
  });
  let waiterError = () => {};
  await new Promise((resolve, reject) => {
    waiterError = reject;
    socket.once('error', reject);
    socket.once('connect', () => {
      const key = Buffer.from('test-key-123456').toString('base64');
      socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      waiters.push({ predicate: () => upgraded, resolve });
    });
  });
  return {
    socket,
    send: (opcode, payload, fin = true) => socket.write(maskedFrame(opcode, payload, fin)),
    nextFrame(timeout = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for frame')), timeout);
        const check = () => {
          if (!frames.length) return false;
          const frame = frames.shift();
          clearTimeout(timer);
          resolve(frame);
          return true;
        };
        if (check()) return;
        waiters.push({ predicate: check, resolve: () => {} });
      });
    },
    close() { socket.destroy(); },
  };
}

test('fragmented messages, interleaved control frames and pong/ping work', async () => {
  const ws = await loadWs();
  const closed = [];
  const server = await ws.serve(0, (connection) => {
    connection.onMessage((message) => connection.send(message));
    connection.onClose((code, reason) => closed.push([code, reason]));
  });
  const client = await connectRaw(server.port);
  try {
    client.send(0x1, 'hel', false);
    client.send(0x9, 'ping');
    const pong = await client.nextFrame();
    assert.equal(pong.opcode, 0xA);
    assert.equal(pong.payload.toString(), 'ping');
    client.send(0x0, 'lo', false);
    client.send(0x0, ' world', true);
    const echo = await client.nextFrame();
    assert.equal(echo.opcode, 0x1);
    assert.equal(echo.payload.toString(), 'hello world');

    client.send(0x8, Buffer.from([0x03, 0xe8, 0x62, 0x79, 0x65]));
    const close = await client.nextFrame();
    assert.equal(close.opcode, 0x8);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(closed.some(([code]) => code === 1000));
  } finally {
    client.close();
    await server.close();
  }
});

test('protocol violations are rejected with the correct close codes', async () => {
  const ws = await loadWs();
  const server = await ws.serve(0, () => {}, { maxPayload: 8 });
  try {
    const unmasked = await connectRaw(server.port);
    unmasked.socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    const unmaskedClose = await unmasked.nextFrame();
    assert.equal(unmaskedClose.opcode, 0x8);
    assert.equal(unmaskedClose.payload.readUInt16BE(0), 1002);
    unmasked.close();

    const continuation = await connectRaw(server.port);
    continuation.send(0x0, 'orphan', true);
    const continuationClose = await continuation.nextFrame();
    assert.equal(continuationClose.payload.readUInt16BE(0), 1002);
    continuation.close();

    const tooLarge = await connectRaw(server.port);
    tooLarge.send(0x1, '123456789');
    const largeClose = await tooLarge.nextFrame();
    assert.equal(largeClose.payload.readUInt16BE(0), 1009);
    tooLarge.close();

    const control = await connectRaw(server.port);
    control.send(0x9, 'x', false);
    const controlClose = await control.nextFrame();
    assert.equal(controlClose.payload.readUInt16BE(0), 1002);
    control.close();

    const invalidClose = await connectRaw(server.port);
    invalidClose.send(0x8, Buffer.from([0x03, 0xed]));
    const invalidCloseFrame = await invalidClose.nextFrame();
    assert.equal(invalidCloseFrame.payload.readUInt16BE(0), 1002);
    invalidClose.close();

    const unsupportedControl = await connectRaw(server.port);
    unsupportedControl.send(0xb, 'x');
    const controlOpcodeClose = await unsupportedControl.nextFrame();
    assert.equal(controlOpcodeClose.payload.readUInt16BE(0), 1002);
    unsupportedControl.close();
  } finally {
    await server.close();
  }
});

test('invalid UTF-8 text is a 1007 protocol error', async () => {
  const ws = await loadWs();
  const server = await ws.serve(0, () => {});
  try {
    const client = await connectRaw(server.port);
    client.send(0x1, Buffer.from([0xc3, 0x28]));
    const close = await client.nextFrame();
    assert.equal(close.opcode, 0x8);
    assert.equal(close.payload.readUInt16BE(0), 1007);
    client.close();
  } finally {
    await server.close();
  }
});
