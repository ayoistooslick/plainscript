# PlainScript real-world starters

These starters are small open-source projects designed to
be copied, modified, and deployed:

| Starter | What it demonstrates |
| --- | --- |
| `aizen-chat` | MongoDB + Groq AI chat backend |
| `authenticated-api` | API keys, sessions, and signed tokens |
| `document-ocr-api` | Upload limits, MIME allow-lists, and OCR |
| `groq-telegram-bot` | Groq-backed AI replies alongside deterministic commands |
| `messaging-app` | Real-time chat with SQLite, WebSocket, auth, and message history |
| `postgres-app` | PostgreSQL connections, parameterized queries, and relational data |
| `realtime-chat` | WebSocket-powered live chat with presence and typing indicators |
| `rest-api-service` | JSON routes, validation, and CRUD-shaped state |
| `scheduled-reporting` | Cron scheduling, report generation, and a status route |
| `sqlite-inventory` | Portable SQLite storage and parameterized SQL |
| `telegram-support-bot` | Hardcoded commands, regex replies, buttons, and callbacks |
| `telegram-visualization-bot` | Telegram chart images generated with PlainScript SVG visualizations |
| `webhook-receiver` | Authenticated webhooks and fast acknowledgements |
| `whatsapp-hybrid-bot` | WhatsApp + Telegram in one process, media download, message types |

Every starter keeps `src/app.pln` as its runnable entry point, with reusable
logic split into nearby `.pln` modules. The entry point imports those helpers
with `bring ... from "./file.pln"`; the compiler bundles the dependency graph
into the same `dist/app.js` output.

From any starter directory:

```bash
npx plainscript check src
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```

Every `.pln` entry point is validated against the compiler before release.