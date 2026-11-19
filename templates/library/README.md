# Typed library starter

```bash
npm install
npm run check
npm run build
```

`plainscript build --declarations` emits JavaScript, source maps and `dist/index.d.pln`.
The package entry points at those files, so another PlainScript project (or a JavaScript
consumer) can import the built module without shipping the sources.

`Task`, `createTask` and `complete` are ordinary exports; incompatible callers are rejected
by the compiler.
