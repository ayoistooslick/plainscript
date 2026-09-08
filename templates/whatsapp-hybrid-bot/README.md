# WhatsApp + Telegram hybrid bot

A PlainScript starter that runs **both a WhatsApp bot and a Telegram bot in one
process**, sharing a single source file. It demonstrates:

- WhatsApp **pairing login** (from the `WHATSAPP_PHONE` environment variable),
  the qwerty Baileys fork (`@qwerty-xcv/baileys`), full message-type detection
  (`message.type`, `message.mtype`, `message.caption`, `message.buttonId`), and
  **media download** (`download "path"`).
- Telegram command handlers and an inline button menu that reuses the same
  options across both channels.

## Run

```bash
export TELEGRAM_BOT_TOKEN="your-telegram-token"
export WHATSAPP_PHONE="2348012345678"   # full international number, digits only
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```

When the WhatsApp session is new, a pairing code is printed in the terminal.
Enter it on your phone: WhatsApp > Settings > Linked devices > Link a device >
Link with phone number instead. Session credentials are kept in
`whatsapp-session/`.

## Bring your own Baileys

Inside the `whatsapp bot` block you can pin a specific implementation:

```
use baileys "@whiskeysockets/baileys"
```

The default is `@qwerty-xcv/baileys`.
