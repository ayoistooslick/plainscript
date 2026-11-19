'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

test('WebSocket authorization rejects an upgrade before the handshake', async () => {
  const ws = await import(pathToFileURL(path.join(ROOT, 'stdlib', 'ws.js')).toString());
  const server = await ws.serve(0, () => {}, {
    authorize: (request) => request.headers.authorization === 'Bearer secret',
  });
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: server.port,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });
      request.on('response', (response) => { response.resume(); resolve(response.statusCode); });
      request.on('upgrade', () => resolve(101));
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 401);
  } finally {
    await server.close();
  }
});

test('WebSocket server upgrades, echoes text, handles JSON and closes cleanly', async () => {
  const ws = await import(pathToFileURL(path.join(ROOT, 'stdlib', 'ws.js')).toString());
  const closed = [];
  const server = await ws.serve(0, (connection) => {
    connection.onMessage((message) => {
      if (typeof message === 'string' && message.startsWith('{')) connection.sendJson({ echo: JSON.parse(message) });
      else connection.send(message);
    });
    connection.onClose((code, reason) => closed.push([code, reason]));
  });
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const text = new Promise((resolve) => socket.addEventListener('message', (event) => resolve(event.data), { once: true }));
    socket.send('hello');
    assert.equal(await text, 'hello');
    const json = new Promise((resolve) => socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true }));
    socket.send(JSON.stringify({ id: 7 }));
    assert.deepEqual(await json, { echo: { id: 7 } });
    socket.close(1000, 'done');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(closed.some(([code]) => code === 1000));
  } finally {
    await server.close();
  }
});
