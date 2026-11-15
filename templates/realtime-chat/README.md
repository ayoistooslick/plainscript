# PlainScript Realtime Chat

A persistent conversations/messages API with live Server-Sent Events delivery. Messages are stored in SQLite and broadcast to connected browser clients immediately.

## Run

```bash
npm install
DB_PATH=./chat.db npm start
# open http://localhost:3000
```

Endpoints include `GET /api/conversations`, `POST /api/conversations`, `GET /api/messages/:conversationId`, `POST /api/messages`, and `GET /events`. The event stream emits `message` and `presence` events, while SQLite provides restart persistence.

`src/app.pln` owns persistence, authorization checks, and streaming; `src/client.pln` is a PlainScript browser client; `src/shared.pln` contains shared message records. Native WebSocket upgrade support, password authentication, and read receipts remain explicitly tracked follow-up work; this template does not mislabel SSE as WebSockets.

Commands: `npm run check`, `npm run build`, `npm start`.
