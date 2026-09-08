---
name: Finally block grammar
description: The parser boundary and documentation rule for recover/finally cleanup blocks.
---

PlainScript `try` blocks may use `recover` followed by `finally`; when `finally` is present, the cleanup block must end with an explicit `done`.

**Why:** Without a guarded recover terminator, `finally` can be consumed as part of the recover boundary and cleanup code disappears from the generated JavaScript.

**How to apply:** Keep `done` after the final `finally` body in examples and tests, and preserve the parser behavior that only consumes `done` when the next token is actually `done`.