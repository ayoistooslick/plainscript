'use strict';

// Application-level integration: these are the patterns real full-stack work
// needs (class-based npm APIs, streaming responses). They compile a real
// PlainScript program, run it, and assert on observable behaviour.

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { spawn } = require('child_process');

const { runSource, compileProject } = require('./helpers');

const sqliteSupported = Number(process.versions.node.split('.')[0]) >= 22;
const sqliteSkip = !sqliteSupported ? 'node:sqlite requires Node 22' : false;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch (failure) {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

test('node:sqlite is usable through new and prepared statements', { skip: sqliteSkip }, () => {
  const result = runSource(`import { print } from "std/io"
import { DatabaseSync } from "node:sqlite"

let database = new DatabaseSync(":memory:")
database.exec("create table tasks (id integer primary key autoincrement, title text not null)")
let insert = database.prepare("insert into tasks (title) values (?)")
insert.run("first")
insert.run("second")

for row in database.prepare("select id, title from tasks order by id").all() as list of any
    print("{row.id}: {row.title}")
end
`);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '1: first\n2: second\n');
});

test('std/http streams Server-Sent Events instead of buffering them', async () => {
  const program = `import { serve } from "std/http"
import { env } from "std/io"
import { parseNumber } from "std/text"

declare const ReadableStream: any
declare const Response: any
declare const TextEncoder: any

let encoder = new TextEncoder()

function eventStream() -> any
    let body = new ReadableStream({
        start: (controller: any) => do
            controller.enqueue(encoder.encode("event: hello\\ndata: connected\\n\\n"))
        end,
    })
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
end

async function handler(request: any) -> any
    return eventStream()
end

let port = parseNumber(env("PORT", "0"))
await serve(port, handler)
`;

  const project = compileProject({ 'main.pln': program });
  assert.strictEqual(project.compiler.diagnostics.filter((d) => d.severity === 'error').length, 0,
    JSON.stringify(project.compiler.diagnostics));

  const port = await freePort();
  const child = spawn(process.execPath, [project.entryOut], {
    cwd: project.directory,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    const ready = await waitForServer(`http://127.0.0.1:${port}/events`);
    assert.ok(ready, `server did not start: ${stderr}`);

    const controller = new AbortController();
    const readFirstEvent = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/events`, { signal: controller.signal });
      assert.strictEqual(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
      const reader = response.body.getReader();
      const first = await reader.read();
      controller.abort();
      return Buffer.from(first.value || new Uint8Array()).toString('utf8');
    };

    const firstEvent = await Promise.race([
      readFirstEvent(),
      new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 4000)),
    ]);

    assert.notStrictEqual(firstEvent, 'TIMEOUT', 'no SSE body arrived; the server buffered the stream');
    assert.match(firstEvent, /event: hello/);
    assert.match(firstEvent, /data: connected/);
  } finally {
    child.kill('SIGKILL');
  }
});
