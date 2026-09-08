// packages/telegram/index.js
// Modular Telegram bot API package for PlainScript.

const https = require('node:https');

function telegramRequest(token, method, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ ok: false, error: e.message, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(token, chatId, text, options = {}) {
  return telegramRequest(token, 'sendMessage', {
    chat_id: chatId,
    text: String(text),
    ...options
  });
}

function sendPhoto(token, chatId, photo, caption = '') {
  return telegramRequest(token, 'sendPhoto', {
    chat_id: chatId,
    photo,
    caption
  });
}

function createBot(token) {
  return {
    token,
    sendMessage: (chatId, text, opts) => sendMessage(token, chatId, text, opts),
    sendPhoto: (chatId, photo, caption) => sendPhoto(token, chatId, photo, caption),
  };
}

module.exports = {
  sendMessage,
  sendPhoto,
  createBot,
  telegramRequest
};
