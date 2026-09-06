# Canvas 2D dodge mini-game

A self-contained PlainScript game: a green square you steer with WASD or the
arrow keys while red blocks fall from the top. Score a point for every block
that drifts past you; lose a life when one collides with you. Run out of lives
and the game freezes until you press Restart.

It demonstrates the v1.0.36 browser API:

- `when document "keydown"/"keyup" happens` handlers that set flags on a
  `keys{}` map — the game loop reads the map, the event handlers never move the
  player directly.
- `every frame ... done`, a `requestAnimationFrame` loop with delta time from
  `performance.now()` so movement speed is frame-rate independent.
- `define a kind called "Enemy"` records, `new Enemy`, and `Math.random()`
  spawning.
- Direct canvas interop: `canvas.getContext("2d")`, `clearRect`, `fillRect`,
  `fillStyle`, `fillText`, and `strokeStyle` via `becomes`.
- A Restart button wired up with `when restartButton "click" happens`.

## Run

Build the compiled script, then open the page (any static file server works —
`npx serve public` is one option):

```bash
npx plainscript build src/game.pln -o public/game.js
npx serve public
```

Then open http://localhost:3000.

The page needs a server only for the HTML script tag, not for the game logic —
opening `public/index.html` directly from disk works in most browsers too.