# Messaging app

A PlainScript backend for a simple messaging app with user accounts,
direct messages, conversation history, and real-time delivery over WebSocket.

## Run

```bash
export API_KEY="change-me"
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```

Send a user id in every request via the `X-API-Key` header.
