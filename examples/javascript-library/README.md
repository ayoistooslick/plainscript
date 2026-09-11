# Dropping into a JavaScript library

The full-interop showcase: import an npm package with `bring`, call members and
`new` constructors on it, pass PlainScript functions as native callbacks, and
optionally shape the scene with a JSON config fetched at runtime. This is the
**import path**  -  unlike `examples/three-dimensional`, which maps `THREE` to a
browser global, this file demands the package be bundled for the browser.

What the script exercises:

- `bring THREE from "three"` emits `require('three')` at the top of the build.
- `new THREE.Scene()`, `new THREE.WebGLRenderer()`, `new THREE.SphereGeometry(...)`
  and `new THREE.Mesh(geo, mat)` fill a starfield of 150 primitives. Colors use
  v1.0.362 hex literals (`0x40c463`), so the palette is legible at a glance.
- A resize callback `make fitWindow() ... done` passed straight to
  `window.addEventListener("resize", fitWindow)`.
- `fetchJson("config.json")` (auto-awaiting) reads `{stars, color}` out of a
  served file and re-sizes/re-colors the field. In `try ... recover as err ... done`
  a failing fetch logs the error and falls back to the built-in defaults  - 
  serve the folder over HTTP so the fetch succeeds, and you'll see the fallback
  path fire if you ever open the page from `file://`.
- `every frame ... done` rotates the whole scene and calls `renderer.render(...)`.
- `show "..."` lines land in the browser console because `show` compiles to
  `console.log`.

## Run

```bash
plainscript add three
npx plainscript build src/interop.pln -o public/interop.js
npx esbuild public/interop.js --bundle --outfile=public/interop.bundle.js
npx serve public
```

Then open http://localhost:3000 (check the console). `index.html` already points
at `interop.bundle.js`.

`plainscript add <package>` installs a package into the current project and
saves it to `package.json` (`npm install <package> --save` under the hood). The
esbuild one-liner above is all the bundling the import path needs; vite or
rollup work equally well. Build twice  -  once by PlainScript, once by a bundler  - 
is the whole trick: PlainScript emits ordinary CommonJS `require()`s and the
bundler turns them into browser-safe modules.

`check` never needs the package installed: `npx plainscript check src` validates
imports from the source alone.

## What to tweak

Point `fetchJson` at a remote URL or drop a different `config.json` next to the
page. Anything you can reach with `fetch`  -  `fetchJson` returns
`{ok, status, data, text, parseError}`  -  is fair game, and the
`try ... recover` block shows the friendly-fallback pattern when the network
misbehaves.