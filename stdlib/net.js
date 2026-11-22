// Networking wrappers over node:net and node:dgram. Text is UTF-8; binary
// protocols can use the host's Node declarations directly.

import net from 'node:net';
import dgram from 'node:dgram';

function wrapSocket(socket) {
  return {
    get remoteAddress() { return socket.remoteAddress || ''; },
    get remotePort() { return socket.remotePort || 0; },
    write(text) { return socket.write(String(text), 'utf8'); },
    end(text) { if (text === undefined) socket.end(); else socket.end(String(text), 'utf8'); },
    onData(handler) {
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => handler(String(chunk)));
    },
    onClose(handler) { socket.on('close', handler); },
    close() { socket.destroy(); },
  };
}

export function connectTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (failure) => {
      socket.destroy();
      reject(new Error(`Cannot connect to ${host}:${port}: ${failure.message}`));
    };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.removeListener('error', onError);
      socket.on('error', () => {});
      resolve(wrapSocket(socket));
    });
  });
}

export function listenTcp(host, port, onConnection) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      onConnection(wrapSocket(socket));
    });
    server.once('error', (failure) => reject(new Error(`Cannot listen on ${host}:${port}: ${failure.message}`)));
    server.listen({ host, port }, () => {
      const address = server.address();
      resolve({
        get port() { return typeof address === 'object' && address ? address.port : port; },
        get host() { return host; },
        close() { server.close(); },
      });
    });
  });
}

export function sendUdp(host, port, text, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error(`UDP request to ${host}:${port} timed out after ${timeout} ms.`));
    }, timeout);
    const finish = (failure, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (failure) reject(failure);
      else resolve(value);
    };
    socket.once('error', (failure) => finish(new Error(`UDP error: ${failure.message}`)));
    socket.once('message', (message) => finish(null, message.toString('utf8')));
    socket.send(Buffer.from(String(text), 'utf8'), port, host, (failure) => {
      if (failure) finish(new Error(`Cannot send UDP datagram: ${failure.message}`));
    });
  });
}

export function listenUdp(host, port, onMessage) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (failure) => reject(new Error(`Cannot listen for UDP on ${host}:${port}: ${failure.message}`)));
    socket.on('message', (message, remote) => {
      try {
        const reply = onMessage(message.toString('utf8'), remote.address, remote.port);
        if (typeof reply === 'string') {
          socket.send(Buffer.from(reply, 'utf8'), remote.port, remote.address);
        }
      } catch {
        // A handler failure must not take down the datagram socket.
      }
    });
    socket.bind(port, host, () => {
      const address = socket.address();
      resolve({
        get port() { return address.port; },
        close() { socket.close(); },
      });
    });
  });
}
