# WebGL 3D scene via the global THREE object

The canonical PlainScript path to 3D: the page loads **three.js from a CDN**
before the compiled script, so `src/scene.pln` just references the global
`THREE` object directly. The build is 100% dependency-free — the emitted file
contains no `require(...)` and needs no bundler, it only needs `THREE` to exist
in the page.

What the script exercises:

- `remember scene as new THREE.Scene()`, `new THREE.PerspectiveCamera(...)`,
  `new THREE.WebGLRenderer()` and `renderer.setSize(...)`.
- `new THREE.BoxGeometry(...)`, `new THREE.MeshStandardMaterial({ color: 0x40c463 })`
  and `new THREE.Mesh(geo, mat)` — v1.0.36 hex literals (`0xRRGGBB`) keep the
  palette legible; the lights use `0xffffff`.
- A light rig with `new THREE.AmbientLight(...)` + `new THREE.DirectionalLight(...)`.
- `document.body.append(renderer.domElement)` mounts the WebGL canvas.
- A `when window "resize" happens` handler that updates the camera aspect ratio
  and the renderer size.
- An `every frame ... done` `requestAnimationFrame` loop that rotates the cube
  and calls `renderer.render(scene, camera)`.

## Run

No install, no bundler. Build, then open the page over a static server:

```bash
npx plainscript build src/scene.pln -o public/scene.js
npx serve public
```

Then open http://localhost:3000.

## The alternative: importing three as a package

If you prefer the npm module instead of a CDN global, swap the `.pln` header for

```plainscript
bring THREE from "three"
```

`plainscript build` then emits `const THREE = require('three');` at the top, and
the browser needs that bundled:

```bash
plainscript add three
npx esbuild public/scene.js --bundle --outfile=public/scene.bundle.js
```

and point `index.html` at the bundled file. The CDN-global route above exists
precisely so you can ship 3D without a bundler.