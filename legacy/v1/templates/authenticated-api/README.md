# Authenticated API

An MIT-licensed starter for a small protected API. The API key is read from an
environment variable and sessions are signed with a separate secret.

```bash
export API_KEY="change-me"
export SESSION_SECRET="use-a-long-random-value"
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```