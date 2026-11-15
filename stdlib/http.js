// Standard library: std/http
// PlainScript speaks the Web-standard HTTP types: handlers receive a Request
// and return a Response. The same handler shape runs on Node, Deno, Bun and
// Cloudflare Workers, so server code is portable by construction.
import http from 'node:http';

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function serve(port, handler) {
  const server = http.createServer(async (request, response) => {
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
      const host = request.headers.host || `localhost:${port}`;
      const webRequest = new Request(`http://${host}${request.url}`, {
        method: request.method,
        headers: request.headers,
        body,
      });
      const result = await handler(webRequest);
      const webResponse = result instanceof Response ? result : json(result);
      const headers = {};
      webResponse.headers.forEach((value, key) => { headers[key] = value; });
      response.writeHead(webResponse.status, headers);
      // Flush headers before the body so streaming responses (Server-Sent
      // Events, chunked output) reach the client as soon as they are written.
      if (typeof response.flushHeaders === 'function') response.flushHeaders();

      if (request.method === 'HEAD' || !webResponse.body) {
        response.end();
        return;
      }

      // Stream the body instead of buffering it. Buffering made any response
      // whose body stays open (SSE) impossible to deliver, and delayed large
      // responses until they were complete.
      const reader = webResponse.body.getReader();
      let clientGone = false;
      response.on('close', () => {
        clientGone = true;
        reader.cancel().catch(() => {});
      });
      try {
        while (!clientGone) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) response.write(Buffer.from(value));
        }
      } catch (failure) {
        // The stream or the client closed mid-response; nothing to report.
      } finally {
        response.end();
      }
    } catch (failure) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Internal error: ${failure && failure.message ? failure.message : String(failure)}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return server;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function text(body, status = 200) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export function html(body, status = 200) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export function javascript(body, status = 200) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
  });
}

export function css(body, status = 200) {
  return new Response(String(body), {
    status,
    headers: { 'content-type': 'text/css; charset=utf-8' },
  });
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

export function notFound(body = 'Not found') {
  return text(body, 404);
}

export async function requestJson(request) {
  return request.json();
}

export async function requestText(request) {
  return request.text();
}

export function urlOf(request) {
  return new URL(request.url);
}

export function fetch(url, options) {
  return globalThis.fetch(url, options);
}

export async function fetchJson(url, options) {
  const response = await globalThis.fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}
