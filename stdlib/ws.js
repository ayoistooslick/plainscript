// Minimal RFC 6455 WebSocket server built on Node's http server.
//
// Supported: text and binary messages, ping/pong, close frames, one message
// callback per connection, JSON convenience, max payload limits and clean
// shutdown. Fragmentation and extensions are intentionally not claimed.

import http from 'node:http';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextId = 1;

function frame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, data]);
}

function closePayload(code = 1000, reason = '') {
  const text = Buffer.from(String(reason), 'utf8');
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return payload;
}

export async function serve(port, handler, options = {}) {
  const maxPayload = Number(options.maxPayload) || 1024 * 1024;
  const clients = new Set();
  const server = http.createServer((request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain', upgrade: 'websocket' });
    response.end('This endpoint accepts WebSocket upgrades.\n');
  });

  server.on('upgrade', async (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    const upgrade = String(request.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket' || typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // Authentication must happen before the 101 response, otherwise the client
    // is already speaking the WebSocket protocol on an unauthorized socket.
    if (typeof options.authorize === 'function') {
      let allowed = false;
      try { allowed = Boolean(await options.authorize(request)); } catch { allowed = false; }
      if (!allowed) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'));
    socket.setNoDelay(true);

    const id = String(nextId++);
    let closed = false;
    let buffer = Buffer.alloc(0);
    const messageHandlers = new Set();
    const closeHandlers = new Set();
    const emitMessage = (value) => { for (const listener of messageHandlers) listener(value); };
    const emitClose = (code, reason) => {
      if (closed) return;
      closed = true;
      clients.delete(connection);
      for (const listener of closeHandlers) listener(code, reason);
    };
    const connection = {
      id,
      request,
      send(value) {
        if (closed) return;
        if (Buffer.isBuffer(value)) socket.write(frame(0x2, value));
        else socket.write(frame(0x1, String(value)));
      },
      sendJson(value) {
        connection.send(JSON.stringify(value));
      },
      onMessage(listener) {
        messageHandlers.add(listener);
        return () => messageHandlers.delete(listener);
      },
      onClose(listener) {
        closeHandlers.add(listener);
        return () => closeHandlers.delete(listener);
      },
      close(code = 1000, reason = '') {
        if (closed) return;
        socket.write(frame(0x8, closePayload(code, reason)));
        emitClose(code, reason);
        socket.end();
      },
    };
    clients.add(connection);

    socket.on('data', (chunk) => {
      if (closed) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const first = buffer[0];
        const second = buffer[1];
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          const large = buffer.readBigUInt64BE(2);
          if (large > BigInt(maxPayload)) {
            connection.close(1009, 'message too large');
            return;
          }
          length = Number(large);
          offset = 10;
        }
        if (length > maxPayload) {
          connection.close(1009, 'message too large');
          return;
        }
        if (!masked) {
          connection.close(1002, 'client frames must be masked');
          return;
        }
        if (buffer.length < offset + 4 + length) return;
        const mask = buffer.slice(offset, offset + 4);
        const payload = Buffer.from(buffer.slice(offset + 4, offset + 4 + length));
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
        buffer = buffer.slice(offset + 4 + length);
        if (opcode === 0x8) {
          let code = 1000;
          let reason = '';
          if (payload.length >= 2) {
            code = payload.readUInt16BE(0);
            reason = payload.slice(2).toString('utf8');
          }
          if (!closed) socket.write(frame(0x8, closePayload(code, reason)));
          emitClose(code, reason);
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          if (!closed) socket.write(frame(0xA, payload));
          continue;
        }
        if (opcode === 0xA) continue;
        if (opcode === 0x1) emitMessage(payload.toString('utf8'));
        else if (opcode === 0x2) emitMessage(payload);
        else if (opcode === 0x0) {
          connection.close(1003, 'fragmented messages are not supported');
          return;
        } else {
          connection.close(1002, 'unsupported opcode');
          return;
        }
      }
    });
    socket.on('error', () => emitClose(1006, 'socket error'));
    socket.on('close', () => emitClose(1000, 'closed'));
    Promise.resolve(handler(connection)).catch(() => connection.close(1011, 'handler failed'));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, options.host || '0.0.0.0', resolve);
  });
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : Number(port),
    close() {
      return new Promise((resolve, reject) => {
        for (const client of clients) {
          try { client.close(1001, 'server shutting down'); } catch { /* already gone */ }
        }
        server.close((failure) => failure ? reject(failure) : resolve());
      });
    },
  };
}
