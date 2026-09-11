# DOM-first interactive clicker

A small dashboard built with PlainScript that talks to the DOM directly  - 
no canvas, no library, no bundler. Click **+10 points** and the score span
updates; click **Log entry** to append a line to the run log; press **R** to
reset both.

It demonstrates the v1.0.362 browser API:

- `document.querySelector` + `.innerHTML becomes` / `.textContent becomes`.
- `when clickButton "click" happens` DOM event handlers.
- `document.createElement("li")` + `historyEl.appendChild(item)`.
- Reading state back out of the DOM (`parseInt(scoreEl.textContent)`) instead
  of keeping a parallel variable.
- `document.addEventListener("keydown", ...)` via `when document "keydown" happens as e`
  and `classList.add` / `classList.remove`.
- The DOM-overlay UI pattern: a plain HTML dashboard driving game-style logic.

## Run

Build the compiled script and serve the folder (any static file server works  - 
`npx serve public` is one option):

```bash
npx plainscript build src/interactive.pln -o public/interactive.js
npx serve public
```

Then open http://localhost:3000.