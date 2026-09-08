// tests/packages.test.js
// Tests for modular decoupled packages: @plainscript/telegram and @plainscript/vision.

const { test, assert } = require('./compat/_util');
const telegram = require('../packages/telegram');
const vision = require('../packages/vision');

test('modular package: @plainscript/telegram exports sendMessage and createBot', () => {
  assert(typeof telegram.sendMessage === 'function', 'sendMessage should be a function');
  assert(typeof telegram.sendPhoto === 'function', 'sendPhoto should be a function');
  assert(typeof telegram.createBot === 'function', 'createBot should be a function');

  const bot = telegram.createBot('test-token');
  assert(typeof bot.sendMessage === 'function', 'bot.sendMessage should be a function');
  assert(bot.token === 'test-token', 'bot.token should match');
});

test('modular package: @plainscript/vision exports readText', () => {
  assert(typeof vision.readText === 'function', 'readText should be a function');
  assert(typeof vision.recognize === 'function', 'recognize should be a function');
});
