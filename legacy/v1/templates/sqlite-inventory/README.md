# SQLite inventory API

An MIT-licensed inventory service using PlainScript's SQLite blocks and a
portable WebAssembly SQLite driver. It runs without a native database build.

```bash
npx plainscript build src/app.pln -o dist/app.js
node dist/app.js
```