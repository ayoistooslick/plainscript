# Application templates

PlainScript ships eight starters. They are real program slices, not static landing pages:
each has PlainScript source, package metadata and documentation. The three application
templates include persistent storage; the framework starters show the supported boundary.

| Template | Command | What it contains |
| --- | --- | --- |
| `project-management` | `plainscript new my-project --template project-management` | SQLite-backed projects, tasks, status updates, dashboard statistics and browser client. |
| `ecommerce` | `plainscript new my-store --template ecommerce` | SQLite catalogue, inventory-safe simulated checkout, orders and browser client. |
| `realtime-chat` | `plainscript new my-chat --template realtime-chat` | SQLite conversations/messages with live Server-Sent Events and a browser client. |
| `react-vite` | `plainscript new my-ui --template react-vite` | React component written in PlainScript, compiled to `src/generated`, bundled by Vite. |
| `next` | `plainscript new my-site --template next` | Next.js App Router page rendered by a PlainScript React Server Component. |
| `express` | `plainscript new my-api --template express` | Express-compatible REST API using the real `express` package and typed handlers. |
| `cli` | `plainscript new my-cli --template cli` | Command-line starter using `std/io.args`, `print` and optional arguments. |
| `library` | `plainscript new my-lib --template library` | Typed exported records/functions and `plainscript build --declarations`. |

All templates expose `npm run check`. The three application templates and the library also
provide `npm run build`; framework templates compile PlainScript before their framework's
build/dev command. Configure `DB_PATH` and `PORT` for database templates, and `AUTH_SECRET`
for the contracts/authentication demonstration, before `npm start`.

The `.pln` sources are the implementation; emitted JavaScript is generated output. Every
scaffold is exercised by `tests/cli.test.js` with `plainscript check`, so a template cannot
silently drift into invalid source. Framework builds (`vite build`, `next build`) require
installing each starter's declared dependencies; those full builds are not run by the
compiler's zero-dependency test suite.

Known follow-up work is documented in each template README rather than hidden behind a
claim of completeness.
