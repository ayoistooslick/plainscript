# Groq Telegram AI bot

An MIT-licensed PlainScript example that combines deterministic commands with
an optional Groq-backed answer. The provider adapter uses Groq's
OpenAI-compatible API, so the same source can target another compatible
provider by changing `provider`, `model`, and the API key environment variable.

## Run

```bash
export TELEGRAM_BOT_TOKEN="your-telegram-token"
export GROQ_API_KEY="your-groq-key"
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```

Credentials are never placed in the source file.