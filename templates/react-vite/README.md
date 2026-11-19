# React + Vite starter

A minimal React component written in PlainScript and bundled by Vite.

```bash
npm install
npm run dev
```

`plainscript build` compiles `src/App.pln` to `src/generated/App.js`; Vite loads that ordinary
ES module. The `render` block emits `createElement` calls from the imported React binding,
so no JSX transform or custom bundler plugin is required.

Verify without starting a server:

```bash
npm run check
npm run build
```
