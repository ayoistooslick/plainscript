# Telegram support bot

An MIT-licensed PlainScript starter for a small support bot with hardcoded
answers, command arguments, inline buttons, and a catch-all help response.

## Run

```bash
export TELEGRAM_BOT_TOKEN="your-token"
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```

The bot uses polling and keeps the Telegram token in the environment.