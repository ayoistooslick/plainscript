# PlainScript Game Development Prompt Guide (v1.0.361)

The standing instruction sheet for AI agents asked to build games and
interactive browser apps in PlainScript.

## Standing instructions for AI agents

You are an AI agent building a game or interactive browser app. PlainScript is
the source of truth. This guide and `docs/PLAINSCRIPT-SPEC.md` describe what
the compiler actually implements.

- **Work in PlainScript.** Write `.pln`, compile it, ship the generated JS. Do
  not hand-rewrite the logic in JavaScript.
- **Rule Zero  -  trust the compiler, nothing else.** Before you claim anything
  works, run `node compiler/cli.js check <file.pln>` (or `plainscript check`).
  If it does not compile, it does not work.
- **You may import and CALL any JavaScript library**  -  canvas, Web Audio,
  three.js, matter.js, npm packages, browser globals. `new Type(args)`, member
  chains, property assignment, promises, and callbacks all work.
- **Never rewrite PlainScript project logic in JavaScript** just because the
  underlying API is JS. A library is *called* from PlainScript; game logic
  stays in `.pln`. JS is the guest library, not the host language.

Every PlainScript block you show a user must compile  -  check it first.

---

## 1. Philosophy: intent-first, never rewrite in JavaScript (cardinal rule)

PlainScript is intent-oriented: you describe *what* the game should do and the
compiler generates JavaScript. One hard rule  -  **game logic lives in
PlainScript**. v1.0.361 reaches into any JS API from `.pln`, which makes
dropping to JS tempting; do not. Every browser capability below stays
reachable without leaving PlainScript.

- Loop, state, and collision logic are PlainScript.
- Graphics, math, and platform features are JS *libraries* you call.
- No built-in? `use` / `bring` a library and call it. Never transplant the
  project's logic into the library's language.

---

## 2. Project structure

```text
my-game/
  src/
    game.pln          client-side game logic (compiled to the browser)
    server.pln        optional: web app that serves public/
    helpers.pln       optional: shared .pln modules, imported via `bring`
  public/
    index.html        shell page: <canvas>, HUD divs, <script src="game.js">
    game.js           compiled browser bundle (build output)
  package.json        optional; only needed for npm libraries
```

`src/game.pln` holds all client logic; `src/server.pln` (optional) is a Node
web app that serves the page; `public/index.html` is a dumb shell owning the
canvas and script tag; `public/game.js` is build output, never hand-edited;
`src/*.pln` helpers are pulled in with `bring name from "./helpers.pln"`.
Keep server and client logic in separate files  -  different runtimes.

---

## 3. Browser target / how a game is served

A game is static files. `server.pln`  -  `serve folder "public"` exposes every
file under `public/` at `/`, and `reply file` sends the HTML shell for the
root path:

```plainscript
web app
serve folder "public"

route get "/"
    reply file "public/index.html"
done

start 3000
```

Build the client into the served folder:

```bash
node compiler/cli.js build src/game.pln -o public/game.js
```

`index.html` loads the compiled bundle with a plain script tag:

```html
<canvas id="game" width="640" height="480"></canvas>
<button id="restart" type="button">Restart</button>
<script src="game.js"></script>
```

**Package-free JS is browser-`<script>`-safe.** Without an npm import the
generated code has no `require()`  -  it is an async IIFE with a guarded
`module.exports` tail, so it loads as a plain script.

**When you need an npm library in the browser:**

1. **CDN global (preferred, stays package-free).** Load the library in
   `index.html` *before* `game.js`; it becomes a browser global that
   PlainScript calls directly  -  no `use`, no bundler:

   ```html
   <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
   <script src="game.js"></script>
   ```

2. **Bundler.** For `bring name from "pkg"`, compile to `public/game.js`, then
   run it through a bundler (esbuild, Vite, Rollup) that inlines
   `node_modules`.

---

## 4. Rendering options

### 4.1 Canvas 2D

Default for 2D games  -  get the element, its 2D context, draw each frame:

```plainscript
remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
canvas.width becomes 640
canvas.height becomes 480

make step(t)
    ctx.clearRect(0, 0, 640, 480)
    ctx.fillStyle becomes "#40c463"
    ctx.fillRect(40, 40, 120, 60)
    requestAnimationFrame(step)
done

requestAnimationFrame(step)
```

Canvas state is property interop  -  `fillStyle becomes ...`, `strokeStyle
becomes ...`, `font becomes ...`  -  then a draw call. Colors like `"#0d1117"`
are just strings. Match the canvas backing size to its display size so nothing
drifts on resize:

```plainscript
remember winW as window.innerWidth
remember winH as window.innerHeight
canvas.width becomes winW
canvas.height becomes winH
```

Clear the whole canvas each frame (`clearRect`) or repaint the background;
skip both and the old frame bleeds through.

### 4.2 WebGL

`webglContext(canvas)` gets the context, `glShader` compiles a shader (throws a
teaching error on failure), `glProgram` links vertex + fragment shaders,
`glBuffer` uploads an `ARRAY_BUFFER` (`STATIC_DRAW`); all WebGL calls are
ordinary methods. One-time setup:

```plainscript
remember canvas as document.getElementById("gl")
remember gl as webglContext(canvas)
gl.viewport(0, 0, 640, 480)
gl.clearColor(0.1, 0.12, 0.15, 1)

remember vs as glShader(gl, "VERTEX_SHADER", `
    attribute vec2 a;
    void main() {
        gl_Position = vec4(a, 0.0, 1.0);
    }
`)
remember fs as glShader(gl, "FRAGMENT_SHADER", `
    precision mediump float;
    void main() {
        gl_FragColor = vec4(0.25, 0.76, 0.38, 1.0);
    }
`)
remember prog as glProgram(gl, vs, fs)
remember buf as glBuffer(gl, [0.0, 0.0, 1.0, 0.0, 0.0, 1.0])
```

Per-frame render  -  keep setup out of the loop:

```plainscript
make renderTriangle()
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(prog)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
done

every frame
    renderTriangle()
done
```

### 4.3 WebGPU

No special syntax  -  plain member-chain interop like WebGL, guarded, with the
promise verbs for async parts. Do not over-promise; support depends on the
browser/GPU:

```plainscript
make initGpu()
    if navigator.gpu is not undefined
        remember adapter as wait for navigator.gpu.requestAdapter()
        remember device as wait for adapter.requestDevice()
        show device
    done
done
initGpu()
```

### 4.4 Rendering libraries (three.js, Babylon.js, ...)

Load via CDN global (section 3) or npm import; construct with `new Type(args)`;
drive with PlainScript:

```plainscript
remember scene as new THREE.Scene()
remember camera as new THREE.PerspectiveCamera(75, 640 / 480, 0.1, 1000)
remember renderer as new THREE.WebGLRenderer({antialias: true})
renderer.setSize(640, 480)
document.getElementById("stage").appendChild(renderer.domElement)

remember geometry as new THREE.BoxGeometry(1, 1, 1)
remember material as new THREE.MeshStandardMaterial({color: 0x40c463})
remember mesh as new THREE.Mesh(geometry, material)
scene.add(mesh)
camera.position.set(0, 0, 5)
make loop()
    mesh.rotation.x becomes mesh.rotation.x + 0.01
    mesh.rotation.y becomes mesh.rotation.y + 0.01
    renderer.render(scene, camera)
    requestAnimationFrame(loop)
done
requestAnimationFrame(loop)
```

v1.0.361 adds hex literals (`0xRRGGBB`): numeric colors use `0xffffff` instead
of magic decimals, and a `"#ffffff"` string works too  -  THREE accepts all
three.

---

## 5. Input handling

The canonical idiom: **event handlers only record intent; the loop applies
it.** Keep a `keys{}` map, set flags in `keydown`/`keyup`, read the map inside
the loop. This avoids OS key-repeat and keeps one writer (the loop) for state.

```plainscript
remember keys as {}
when document "keydown" happens as ke
    keys[ke.key] becomes true
done
when document "keyup" happens as ke
    keys[ke.key] becomes false
done

remember player as {x: 320}
make step(dt)
    if keys["ArrowLeft"] is true
        player.x becomes player.x - 240 * dt
    done
done
```

- Never mutate world state inside an event handler  -  set a flag, let the loop
  consume it.
- `when <target> "<event>" happens` → `target.addEventListener(event, ...)`
  with the parameter named via `as name` (default `event`).
- Named keys (`"ArrowLeft"`) or characters (`keys["a"]`) come from `ke.key`.

`localPoint(event, canvas)` maps client coordinates to canvas pixels:

```plainscript
remember canvas as select("canvas")
remember aim as {x: 0, y: 0}

when canvas "pointermove" happens as e
    remember p as localPoint(e, canvas)
    aim.x becomes p.x
    aim.y becomes p.y
done

when canvas "touchmove" happens as e
    e.preventDefault()
done

when window "wheel" happens as e
    show e.deltaY
done
```

Touch reuses pointer events (`"touchmove"`)  -  call `e.preventDefault()` when
you own the gesture; `"wheel"` gives `e.deltaY` for zoom; `gamepads()` returns
connected pads to read inside the loop; drag-and-drop files arrive via
`droppedFiles(event)` in a `drop` handler.

---

## 6. Animation loop and delta time

The browser runs a single-threaded event loop; the only good loop is
`requestAnimationFrame` (rAF). A `while true` or long synchronous loop blocks
rendering, input, and audio  -  the page freezes. Never write one.

rAF passes a millisecond timestamp  -  difference, normalize to seconds, and
movement is frame-rate independent:

```plainscript
remember lastTick as 0
make loop(t)
    remember dt as (t - lastTick) / 1000
    if dt is above 0
        step(dt)
    done
    lastTick becomes t
    requestAnimationFrame(loop)
done
requestAnimationFrame(loop)
```

Cap `dt` (skip the step after a long stall) so a background-tab resume does not
jump the sim forward by seconds. For loops that do not need delta time, the
short form is `every frame ... done` (still rAF under the hood  -  see the
Appendix); use rAF + `dt` when movement must be time-based.

---

## 7. Asset loading

Built-in loaders return promises and **auto-await**  -  no `await` written:

```plainscript
remember bg as loadImage("img/background.png")
remember sfx as loadAudio("mp3/click.mp3")
remember manifest as fetchJson("assets/manifest.json")
```

- `loadImage(url)` → an `Image` ready for `ctx.drawImage(img, x, y)`.
- `loadAudio(url)` → an `Audio` element; call `sound.play()`.
- `fetchJson(url)` → `{ok, status, data, text, parseError}`  -  never throws on a
  bad status; check `ok`.
- `fetchBytes(url)` → `{ok, status, data: Uint8Array}` for binary payloads.
- `readDataUrl(file)` → a `data:` URL string for a `File` (from
  `droppedFiles(event)` or a file input)  -  feed it straight to `loadImage`.

For an `Image` you own, use `new Image()` and `spriteSheet.src becomes "img.png"`.

Start the scene **after** assets are ready, or the first frame draws a blank
flash  -  gate scene start on a loaded flag. Sprite atlases are one image plus a
`fetchJson` manifest of `{x, y, w, h}` frames, drawn with
`drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh)`.

---

## 8. Audio

```plainscript
remember ctx as audioContext()
playTone(440, 0.25)
remember sfx as loadAudio("boing.mp3")
```

`audioContext()` lazily creates a singleton `AudioContext` (with a
`webkitAudioContext` fallback); `playTone(freq, seconds, options)` plays a tone
on it. **Browsers require a user gesture to start audio**  -  the context stays
`"suspended"` until a click/keypress/touch, so resume it from the first one:

```plainscript
make resumeAudio()
    ctx.resume()
done
document.addEventListener("click", resumeAudio)
```

The #1 "audio does not work" bug in browser games  -  always wire the resume.

---

## 9. Game state

Model entities and global values with record kinds; keep one `state` record so
the loop, HUD, and restart logic read one source of truth:

```plainscript
define a kind called "Player" with
    x is 0
    y is 0
    lives is 3
done

define a kind called "GameState" with
    score is 0
    paused is false
done

remember state as create a GameState with score 0 and paused false
remember player as create a Player with x 320 and y 240

make resetGame()
    state.score becomes 0
    player.x becomes 320
    player.y becomes 240
done
```

One-writer rule: **the loop applies, handlers register intent.** Input,
collision, and timers funnel through the loop's `step`, so state changes in
one predictable place per frame.

---

## 10. Collision and physics

Two workhorse tests. AABB  -  exact enough for rectangles and tiles:

```plainscript
if enemy.x is at least player.x - 26 and enemy.x is at most player.x + 26 and enemy.y is at least player.y - 26 and enemy.y is at most player.y + 26
    state.score becomes state.score + 1
done
```

Circle distance  -  compare squared distance against squared radius to skip a
`Math.sqrt` per pair:

```plainscript
remember dx as enemy.x - player.x
remember dy as enemy.y - player.y
remember distSq as dx * dx + dy * dy
if distSq is less than 400
    show "hit"
done
```

With many entities, do a broad phase first (bounding boxes, tile-grid buckets)
and run the precise test only on candidates. When you need real physics  - 
impulses, joints, continuous collision  -  delegate to a physics library. That is
interop, not surrender:

```plainscript
use matter
remember engine as matter.Engine.create()
remember world as engine.world
remember box as matter.Bodies.rectangle(320, 200, 40, 40)
matter.Composite.add(world, box)

make tick(dt)
    matter.Engine.update(engine, 1000 * dt)
done

every frame
    tick(1 / 60)
done
```

`use matter` binds the lowercase package name, so the chain is
`matter.Engine.create()`. The simulation policy stays in PlainScript; the
library computes physics.

---

## 11. UI overlay via DOM

Canvas = the world; DOM = the chrome. Score, lives, menus, and buttons live in
HTML and update by property assignment  -  `innerHTML becomes`,
`textContent becomes`, `classList.add`. Do not build UI in canvas when a div
will do:

```plainscript
remember scoreBox as document.querySelector("#score")
remember hud as parseHTML("<div id='hud'>Score: 0</div>")
document.body.appendChild(hud)

make refreshHud(scoreValue)
    scoreBox.innerHTML becomes `Score: ${scoreValue}`
done

when clickButton "click" happens
    refreshHud(10)
done
```

`parseHTML(html)` returns a `DocumentFragment` you can append. Update HUD
elements when values change, not every frame.

---

## 12. Networking

Server side uses the existing WebSocket server statement:

```plainscript
websocket server on 8080
    when socket connects
        send socket "connected"
    done
    when socket sends message
        broadcast message
    done
done
```

Client opens a WebSocket with `new WebSocket(url)` and listens with the same
`when ... happens` form as DOM events:

```plainscript
make applyState(data)
    state.score becomes jsonDecode(data).score
done

remember ws as new WebSocket("wss://example.com/socket")
when ws "message" happens as e
    applyState(e.data)
done

when ws "open" happens
    webSocketSend(ws, {type: "join", name: "Ada"})
done
```

`webSocketSend(ws, value)` sends strings as-is and JSON-stringifies anything
else. Design around **authority**: one peer owns the simulation and broadcasts a
compact tick/snapshot; clients render and correct.

---

## 13. Persistence

`localStorage` is direct interop  -  strings only. Wrap state in JSON:

```plainscript
remember rawSave as localStorage.getItem("plainscript-save")
if rawSave is not null
    remember restored as jsonDecode(rawSave)
    state.score becomes restored.score
done
localStorage.setItem("plainscript-save", jsonEncode(state))
```

Save on meaningful changes or `beforeunload`, not every frame  - 
`localStorage` is synchronous and small (~5MB). For structured or large data,
wrap IndexedDB behind promises via the `idb` npm library (`use idb`).

---

## 14. Performance guidelines

- **One rAF loop, one `step(dt)`.** No scattered timers drawing or simulating
  independently.
- **No allocations in the loop.** Reuse typed arrays and mutating math
  (gl-matrix `mat4.rotateX(mat, mat, 0.5)`)  -  never fresh arrays per frame.
- **Cap dt** so a background-tab resume cannot run the sim forward for seconds.
- **Canvas sizing discipline.** Match backing size to display size  -  oversized
  canvases are the #1 silent frame-rate killer.
- **Reuse sprites and draw calls**; redraw only what changed.
- **No synchronous work in the loop.** No storage writes, no fetch, no heavy
  JSON per frame.
- **Keep event handlers thin.** Set a flag; the loop works.

```plainscript
remember verts as new Float32Array(64)
make refreshVerts()
    for index i from 0 to 15
        verts[i] becomes verts[i] * 2
    done
done
refreshVerts()
```

---

## 15. JavaScript interoperability

What an imported library needs, without leaving PlainScript.

**Import npm packages and local modules:**

```plainscript
use lodash
bring axios from "axios"
bring geometry from "./helpers.pln"
```

**Call member chains**  -  no special syntax:

```plainscript
crypto.createHash("sha256").update("abc").digest("hex")
mesh.scale.set(2, 2, 2)
```

**Construct with `new Type(args)`**  -  statement start, `remember`, arguments,
member chains, or bare without parens:

```plainscript
remember date as new Date().getTime()
remember mut as new THREE.Vector3(1, 2, 3)
remember vec as new Float32Array([0.5, 1.0, 1.5])
scene.add(new THREE.Mesh(geometry, material))
remember box as new Enemy
```

**Pass `make`-function references as callbacks:**

```plainscript
make fitWindow()
    camera.aspect becomes window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
done
window.addEventListener("resize", fitWindow)
button.onclick becomes fitWindow
```

**Promises**  -  browser builtins (`loadImage`, `fetchJson`, `loadAudio`)
auto-await. Raw interop uses `await` / `wait for`; errors use the repository's
`try/recover` idiom  -  never `.then`:

```plainscript
remember response as await fetch("/api/state")
remember data as await response.json()
show data

try
    remember scores as wait for fetchJson("/api/scores")
    show scores
recover as err
    show message of err
finally
    show "done"
done
```

**Typed arrays / binary**  -  `remember buffer as new Uint8Array(64)` and index
with `buffer[0] becomes 255`.

**Arrays, objects, JSON:**

```plainscript
remember people as [{name: "Ada"}, {name: "Grace"}]
for each person in people
    show person.name
done
remember config as jsonDecode(rawJson)
```

Rules: no `=>`, `.then`, `let/const`, braces, or semicolons in `.pln`. A
library is *called* from PlainScript  -  symbol, flow, and state stay in
PlainScript. Need a stateful callback? Define a `make` function that reads the
shared state you already have.

---

## 16. Generated JavaScript expectations

What the compiler emits for a game, so you can read and debug `public/game.js`:

- Declarations emit as `let`/`const`; functions as `function name(...)`.
- `when <target> "<event>" happens` → `target.addEventListener("event", function (event) { ... })`.
- `every frame ... done` → a self-scheduling
  `requestAnimationFrame(function __frame(t) { ... })`; `after 3 seconds ... done`
  → `setTimeout(..., 3 * 1000)`.
- Any top-level `await` (triggered by promise builtins like `loadImage`) wraps
  the program in `(async () => { ... })();`; in-handler awaits make only that
  handler `async`.
- `require()` appears **only** for `use <pkg>` / `bring name from "pkg"`.
- The file ends with a guarded tail
  (`if (typeof module !== 'undefined') { module.exports = { ... }; }`) so the
  same output is a harmless browser script and still works under Node.

Debug by checking `game.js` for that shape (`addEventListener`,
`requestAnimationFrame`, the IIFE), not your source indentation.

---

## 17. Common mistakes

| Mistake | Correct response |
| --- | --- |
| `while true` loop for the game loop | `requestAnimationFrame` / `every frame` |
| Mutating the world inside an event handler | Set a `keys{}` flag; the loop applies it |
| No delta time (speed varies with frame rate) | `dt = (t - last) / 1000`, multiply speeds by `dt` |
| `.then(...)` on a promise | `await` / `wait for`; `try/recover` for errors |
| Treating `check` as a run | `check` validates; `build`, then open the page to run |
| Blocking `fetch` in the browser | `await fetch`, `fetchJson`, or `loadImage` |
| Variable named for a keyword/builtin | Rename (`start`, `now`, `get`, `set`, `reply`, `from`, `as`, `of`, `in`, `json`, `bytes`, `update`, `status` are taken) |
| Writing `is most` for `<=` | Use `is at most` (`is most` is not a comparison) |
| Storing colors as opaque decimals (`4244579`) | Hex literal `0x40c463` is supported (or a `"#40c463"` string) |
| `make update` / `make get` as function names | Rename  -  those are keywords |
| Bare `keys["ArrowLeft"]` in `if` | Compare: `if keys["ArrowLeft"] is true` |
| Audio with no user gesture | `ctx.resume()` from a click/keydown handler |
| Drawing before assets load | Gate scene start on a loaded flag |

---

## 18. Complete working examples

### 18.1 A full 2D game in one file

Player + falling enemies + score + collision + DOM HUD + restart. The canonical
shape to copy: kinds and state up top, handlers only record input, the loop
owns all movement, canvas draws the world, DOM shows the score.

```plainscript
define a kind called "Player" with
    x is 0
    y is 0
    r is 12
    speed is 240
done
define a kind called "Enemy" with
    x is 0
    y is 0
    speed is 0
done

remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
remember state as {score: 0, over: false}
remember keys as {}

when document "keydown" happens as ke
    keys[ke.key] becomes true
done

when document "keyup" happens as ke
    keys[ke.key] becomes false
done

remember player as create a Player with x 320 and y 460
remember enemies as [
    {x: 60, y: 60, speed: 110},
    {x: 200, y: 60, speed: 140},
    {x: 340, y: 60, speed: 90},
    {x: 480, y: 60, speed: 160},
    {x: 560, y: 60, speed: 120}
]

make reset()
    state.score becomes 0
    state.over becomes false
    player.x becomes 320
    player.y becomes 460
    for each enemy in enemies
        enemy.y becomes 60
    done
done

when document.getElementById("restart") "click" happens
    reset()
done

make step(dt)
    if state.over is false
        if keys["ArrowLeft"] is true
            player.x becomes player.x - player.speed * dt
        done
        if keys["ArrowRight"] is true
            player.x becomes player.x + player.speed * dt
        done
        for each enemy in enemies
            enemy.y becomes enemy.y + enemy.speed * dt
            if enemy.y is above 480
                enemy.y becomes 40
                enemy.x becomes 40 + 560 * Math.random()
                state.score becomes state.score + 1
            done
            if enemy.x is at least player.x - 26 and enemy.x is at most player.x + 26 and enemy.y is at least player.y - 26 and enemy.y is at most player.y + 26
                state.over becomes true
            done
        done
    done
    ctx.clearRect(0, 0, 640, 480)
    ctx.fillStyle becomes "#1b1e24"
    ctx.fillRect(0, 0, 640, 480)
    for each enemy in enemies
        ctx.fillStyle becomes "#e2543f"
        ctx.beginPath()
        ctx.arc(enemy.x, enemy.y, 10, 0, Math.PI * 2)
        ctx.fill()
    done
    ctx.fillStyle becomes "#40c463"
    ctx.beginPath()
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2)
    ctx.fill()
    document.getElementById("score").textContent becomes `Score: ${state.score}`
    if state.over is true
        ctx.fillStyle becomes "#fff"
        ctx.fillText("GAME OVER - press Restart", 200, 240)
    done
done

make loop(t)
    requestAnimationFrame(loop)
    step(t / 1000)
done
requestAnimationFrame(loop)
```

### 18.2 A full 3D scene in one file

A camera, renderer, and one rotating mesh driven from one rAF loop, using a
global `THREE` from a CDN script tag:

```plainscript
remember scene as new THREE.Scene()
remember camera as new THREE.PerspectiveCamera(75, 640 / 480, 0.1, 1000)
remember renderer as new THREE.WebGLRenderer({antialias: true})
renderer.setSize(640, 480)
document.getElementById("stage").appendChild(renderer.domElement)

remember geometry as new THREE.BoxGeometry(1, 1, 1)
remember material as new THREE.MeshStandardMaterial({color: 0x40c463})
remember mesh as new THREE.Mesh(geometry, material)
scene.add(mesh)
camera.position.set(0, 0, 5)

make loop()
    mesh.rotation.x becomes mesh.rotation.x + 0.01
    mesh.rotation.y becomes mesh.rotation.y + 0.01
    renderer.render(scene, camera)
    requestAnimationFrame(loop)
done
requestAnimationFrame(loop)
```

---

## 19. Recommended architecture

### 19.1 Small games

For games up to a few hundred lines, one `.pln` file is correct: one `state`
record owned by the loop, one rAF loop (`every frame` or the dt form) that
steps then draws, one input set (a `keys{}` map plus one pointer handler), and
plain DOM updates for the HUD. File count should track surface area  -  a small
game in five files is as wrong as a big game in one.

### 19.2 Large games

Split by responsibility, not by function. The entry file owns lifecycle (and
the server); modules own entities and systems:

```plainscript
bring spawnEnemy from "./entities.pln"
import { loadAssets } from "./assets.pln"

remember firstWave as spawnEnemy(320, 40)
```

A proven structure:

- **Entity factories**  -  `define a kind` plus a `make spawnThing()` returning a
  new instance; one file per entity family.
- **Systems as `make` functions**  -  one system (movement, collision, rendering,
  scoring) per function, run in order by the loop.
- **Scene/state table**  -  a state record or switch with explicit `attract`,
  `play`, and `gameover` states.
- **Asset manifest**  -  one `assets` record of URLs loaded at boot; scenes look
  up paths instead of hardcoding.
- **A server when networking**  -  own `server.pln` with `websocket server`,
  authority checks, and snapshot broadcasts; the client is a pure renderer +
  input reporter.

Entities are records, factories and systems are PlainScript functions; browser
APIs stay libraries you call.

---

## 20. DO list and DO-NOT list

| DO | DO-NOT |
| --- | --- |
| Write the game logic in PlainScript | Rewrite logic in JS "because the API is JS" |
| Run `node compiler/cli.js check <file.pln>` before claiming it works | Claim code works because it looks readable |
| Use one rAF loop for the whole frame | `while true` / synchronous loops |
| Record input in handlers, apply in the loop | Mutate world state inside events |
| Multiply speeds by delta time | Move a fixed amount per frame |
| Use `await` / `wait for` and `try/recover` | `.then` / `.catch` chains |
| Keep handlers and per-frame work small | Heavy work, storage writes, fetches in the loop |
| Reuse buffers and objects across frames | Allocate new arrays every frame |
| Gate scene start on loaded assets | Draw before textures/audio are ready |
| Resume audio from a user gesture | Start audio and wonder why it is silent |
| Call libraries through interop | Hand-write what a library already does |

---

## Appendix A: Canonical snippets quick reference

Every line below is verified canonical form  -  copy it exactly:

```plainscript
remember canvas as document.getElementById("game")
remember ctx as canvas.getContext("2d")
remember s as new THREE.Scene()
when document "keydown" happens as ke
    show ke.key
done
every frame
    ctx.clearRect(0, 0, 640, 480)
done
after 0.5 seconds
    show "tick"
done
remember bg as loadImage("img.png")
```

## Run it

Runnable, maintained reference implementations live in:

- `examples/canvas-game`  -  canvas 2D dodge game (keys map + `every frame` + delta time + kinds + restart).
- `examples/browser-interactive`  -  DOM-first interactive app (`when ... happens`, `classList`, innerHTML/textContent).
- `examples/three-dimensional`  -  WebGL 3D scene via the global `THREE` object.
- `examples/javascript-library`  -  an npm library (`bring THREE from "three"`), callbacks, and `fetchJson`.