# CLI starter

```bash
npm install
npm start -- hello Ada
npm start
```

Arguments after the script path are exposed by `std/io.args()`. The program is compiled
before it runs, so type errors stop execution before any command logic executes.

```bash
npm run check
npm run build
npm link       # exposes plainscript-cli-starter from dist/main.js
```
