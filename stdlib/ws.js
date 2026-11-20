// RFC 6455 WebSocket server built on Node's http server.
//
// Supported: text and binary messages, fragmentation and continuation frames,
// interleaved ping/pong/close control frames, UTF-8 validation, close-handshake
// checks, max message sizes, unmasked/reserved-bit protocol errors, and
// authentication before the HTTP upgrade. Extensions are not supported.

import http from 'node:http';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const VALID_CLOSE_CODES = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014]);
let nextId = 1;

function frame(opcode, payload, fin = true) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = data.length;
  const first = (fin ? 0x80 : 0) | opcode;
  let header;
  if (length < 126) {
    header = Buffer.from([first, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, data]);
}

function closePayload(code = 1000, reason = '') {
  let text = Buffer.from(String(reason), 'utf8');
  if (text.length > 123) {
    // Do not cut a UTF-8 code point in half: the peer must be able to decode
    // the close reason, and RFC 6455 limits the whole control payload to 125.
    let end = 123;
    while (end > 0 && (text[end] & 0xc0) === 0x80) end -= 1;
    text = text.subarray(0, end);
  }
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return payload;
}

function validCloseCode(code) {
  return VALID_CLOSE_CODES.has(code) || (code >= 3000 && code <= 4999);
}

function decodeText(payload) {
  return new TextDecoder('utf-8', { fatal: true }).decode(payload);
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
    let fragmented = null;
    let closeSent = false;
    let closeReceived = false;
    let closeTimer = null;
    const messageHandlers = new Set();
    const closeHandlers = new Set();
    const emitMessage = (value) => { for (const listener of messageHandlers) listener(value); };
    const emitClose = (code, reason) => {
      if (closed) return;
      closed = true;
      if (closeTimer) clearTimeout(closeTimer);
      clients.delete(connection);
      for (const listener of closeHandlers) listener(code, reason);
    };
    const finalize = (code, reason) => {
      emitClose(code, reason);
      try { socket.destroy(); } catch { /* already gone */ }
    };
    const sendClose = (code, reason) => {
      if (closeSent || closed) return;
      closeSent = true;
      try { socket.write(frame(0x8, closePayload(code, reason))); } catch { /* socket failed */ }
    };
    const fail = (code, reason) => {
      sendClose(code, reason);
      finalize(code, reason);
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
        const safeCode = validCloseCode(code) ? code : 1000;
        sendClose(safeCode, reason);
        if (closeReceived) {
          finalize(safeCode, reason);
          return;
        }
        // Give the peer a bounded opportunity to answer the close handshake.
        closeTimer = setTimeout(() => finalize(safeCode, reason), options.closeTimeout || 250);
      },
      terminate() {
        finalize(1001, 'server terminating');
      },
    };
    clients.add(connection);

    const deliver = (opcode, payload) => {
      try {
        if (opcode === 0x1) emitMessage(decodeText(payload));
        else emitMessage(payload);
      } catch {
        fail(1007, 'invalid UTF-8 payload');
      }
    };

    const control = (opcode, payload) => {
      if (opcode === 0x8) {
        closeReceived = true;
        let code = 1000;
        let reason = '';
        if (payload.length === 1) { fail(1002, 'invalid close payload'); return; }
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          if (!validCloseCode(code)) { fail(1002, 'invalid close code'); return; }
          try { reason = decodeText(payload.slice(2)); } catch { fail(1007, 'invalid close reason'); return; }
        }
        if (!closeSent) sendClose(code, reason);
        finalize(code, reason);
        return;
      }
      if (opcode === 0x9) {
        if (!closed) socket.write(frame(0xA, payload));
        return;
      }
      if (opcode === 0xA) return; // Pong frames are legal unsolicited traffic.
      fail(1002, 'unsupported control opcode');
    };

    socket.on('data', (chunk) => {
      if (closed) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const first = buffer[0];
        const second = buffer[1];
        const fin = (first & 0x80) !== 0;
        const rsv = first & 0x70;
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        let length = second & 0x7f;
        let offset = 2;
        if (rsv !== 0) { fail(1002, 'reserved bits are not supported'); return; }
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          const large = buffer.readBigUInt64BE(2);
          if (large > BigInt(maxPayload)) { fail(1009, 'message too large'); return; }
          length = Number(large);
          offset = 10;
        }
        const isControl = opcode >= 0x8;
        if (isControl && (!fin || length > 125)) { fail(1002, 'invalid control frame'); return; }
        if (length > maxPayload) { fail(1009, 'message too large'); return; }
        if (!masked) { fail(1002, 'client frames must be masked'); return; }
        if (buffer.length < offset + 4 + length) return;
        const mask = buffer.slice(offset, offset + 4);
        const payload = Buffer.from(buffer.slice(offset + 4, offset + 4 + length));
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
        buffer = buffer.slice(offset + 4 + length);

        if (isControl) {
          control(opcode, payload);
          if (closed) return;
          continue;
        }
        if (opcode === 0x0) {
          if (!fragmented) { fail(1002, 'unexpected continuation frame'); return; }
          fragmented.length += payload.length;
          if (fragmented.length > maxPayload) { fail(1009, 'message too large'); return; }
          fragmented.chunks.push(payload);
          if (fin) {
            const whole = Buffer.concat(fragmented.chunks);
            const original = fragmented.opcode;
            fragmented = null;
            deliver(original, whole);
            if (closed) return;
          }
          continue;
        }
        if (opcode !== 0x1 && opcode !== 0x2) { fail(1002, 'unsupported opcode'); return; }
        if (fragmented) { fail(1002, 'new data frame before fragmented message completed'); return; }
        if (fin) {
          deliver(opcode, payload);
          if (closed) return;
        } else {
          fragmented = { opcode, chunks: [payload], length: payload.length };
        }
      }
    });
    socket.on('error', () => finalize(1006, 'socket error'));
    socket.on('end', () => finalize(closeReceived ? 1000 : 1006, closeReceived ? 'closed' : 'connection ended'));
    socket.on('close', () => {
      if (!closed) finalize(closeReceived && closeSent ? 1000 : 1006, closeReceived ? 'closed' : 'connection lost');
    });
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
