# Webhook receiver

An MIT-licensed webhook endpoint that validates a shared API key, returns
quickly, and records the last event in a local file for later processing.

```bash
export WEBHOOK_KEY="change-me"
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```