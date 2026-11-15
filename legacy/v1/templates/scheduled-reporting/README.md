# Scheduled reporting service

An MIT-licensed scheduled job starter. It writes a timestamped report to a
local file and exposes the most recent report over HTTP.

```bash
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```