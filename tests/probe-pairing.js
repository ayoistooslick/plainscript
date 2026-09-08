// Standalone pairing probe: tests a REAL WhatsApp pairing code request
// against the qwerty fork of Baileys. Run with:
//
//   node tests/probe-pairing.js [PHONE]
//
// Default phone: 2349012834275
// The script creates a local auth folder (probe-auth), requests a pairing
// code, prints the pretty XXXX-XXXX form, and exits.

const PHONE = process.argv[2] || '2349012834275';

async function main() {
  const baileys = require('@qwerty-xcv/baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, makeCacheableSignalKeyStore } = baileys;

  const logger = (() => {
    const noop = () => {};
    return { level: 'silent', child: () => logger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  })();

  console.log('Phone:', PHONE);
  console.log('Connecting...');

  const { state, saveCreds } = await useMultiFileAuthState('probe-auth');

  const sock = makeWASocket({
    version: [2, 2413, 1],
    browser: ['Mac Os', 'chrome', '121.0.6167.159'],
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 50000,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
  });

  sock.ev.on('creds.update', saveCreds);

  // Request pairing code after 2 seconds (same timing as the runtime).
  setTimeout(async () => {
    try {
      const rawCode = await sock.requestPairingCode(PHONE);
      const pretty = String(rawCode || '').replace(/[^A-Za-z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
      console.log('Raw code:', rawCode);
      console.log('Pretty code:', pretty);
      console.log('Pairing code requested successfully.');
    } catch (error) {
      console.error('Pairing code request failed:', error.message);
    }
    process.exit(0);
  }, 2000);
}

// 30-second safety timeout.
setTimeout(() => {
  console.error('Probe timed out after 30 seconds.');
  process.exit(1);
}, 30000);

main().catch((error) => {
  console.error('Probe failed:', error.message || error);
  process.exit(1);
});
