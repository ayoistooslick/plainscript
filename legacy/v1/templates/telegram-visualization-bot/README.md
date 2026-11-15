# Telegram visualization bot

An MIT-licensed PlainScript starter that generates an SVG chart with the
built-in image library, serves it from a web route, and sends the public chart
URL when someone uses `/chart` in Telegram.

## Run

Set both environment variables before starting:

```bash
export TELEGRAM_BOT_TOKEN="your-token"
export PUBLIC_BASE_URL="https://your-public-domain.example"
npx plainscript check src
npx plainscript build src/app.pln -o dist/app.js
npm start
```

`PUBLIC_BASE_URL` must be reachable by Telegram and should not end with `/`.
The generated chart is available at `/chart.svg`, and `/health` returns `ok`.

The reusable chart builder lives in `src/chart.pln`; `src/app.pln` keeps the
web, bot, and lifecycle declarations in the entry point.