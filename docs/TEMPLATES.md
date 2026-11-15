# Application templates

PlainScript ships three application templates. They are intentionally real program slices rather than static landing pages: each has PlainScript backend logic, a browser module, package metadata, documentation, and persistent storage where the runtime supports it.

## project-management

`plainscript new my-project --template project-management`

Creates a SQLite-backed project/task service with project creation, task creation and status updates, validation, dashboard statistics, and a browser client. Configure `DB_PATH` and `PORT` before `npm start`.

## ecommerce

`plainscript new my-store --template ecommerce`

Creates a catalogue and inventory service with product administration, checkout transaction handling, order history, sales totals, and an explicitly simulated payment status. Configure `DB_PATH` and `PORT` before `npm start`.

## realtime-chat

`plainscript new my-chat --template realtime-chat`

Creates a persistent conversation/message service with live Server-Sent Events delivery and a browser client. Configure `DB_PATH` and `PORT` before `npm start`.

All templates expose `npm run check`, `npm run build`, and `npm start`. Their `.pln` sources are the application implementation; emitted JavaScript is generated output. Known follow-up work is documented in each template README rather than hidden behind a claim of completeness.
