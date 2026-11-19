'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT } = require('./helpers');

const httpModule = () => import(pathToFileURL(path.join(ROOT, 'stdlib', 'http.js')).toString());

test('sse formats event fields and streams them in order', async () => {
  const { sse } = await httpModule();
  async function* events() {
    yield { event: 'ready', id: 1, data: { ok: true } };
    yield 'plain data';
    yield { data: 'two\nlines' };
  }
  const response = sse(events());
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
  const body = await response.text();
  assert.equal(body, [
    'id: 1',
    'event: ready',
    'data: {"ok":true}',
    '',
    'data: plain data',
    '',
    'data: two',
    'data: lines',
    '',
    '',
  ].join('\n'));
});

test('server errors do not leak exception text by default', async () => {
  const { serve } = await httpModule();
  const server = await serve(0, async () => { throw new Error('database password leaked'); });
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), 'Internal server error');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('cancelling an sse stream calls the producer cleanup hook', async () => {
  const { sse } = await httpModule();
  let cleaned = false;
  const source = {
    [Symbol.asyncIterator]() {
      let sent = false;
      return {
        async next() {
          if (sent) return new Promise(() => {});
          sent = true;
          return { done: false, value: 'first' };
        },
        async return() { cleaned = true; return { done: true }; },
      };
    },
  };
  const response = sse(source);
  const reader = response.body.getReader();
  const chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), /data: first/);
  await reader.cancel();
  assert.equal(cleaned, true);
});
