---
name: plainscript
description: Authoritative guide and grammar reference for PlainScript (.pln), an Intent-Oriented Programming Language optimized for human readability and LLM token efficiency. Use when writing, debugging, compiling, or refactoring PlainScript programs.
---

# PlainScript (.pln) Agent Skill & Grammar Guide

PlainScript is an Intent-Oriented Programming Language (IOPL) that compiles to ultra-readable JavaScript, native ES Modules, Bun, and standalone executables. It reduces LLM token consumption by over 50% compared to TypeScript/Python and eliminates unmatched bracket / indentation syntax errors.

---

## 1. Core Syntax & Invariants

### Variables & Constants
```plainscript
remember name as "Ada"       // Immutable/semantic declaration
let age is 25                // Mutable variable
age becomes 26               // Re-assignment (NEVER use "=")
```
> **CRITICAL RULE**: PlainScript NEVER uses `=` for assignment or comparison.
> - Declaration: `remember x as 1` or `let x is 1`
> - Update: `x becomes 2`
> - Equality comparison: `if x is 2` or `if x equals 2`

### Functions & Returns
Functions start with `make` (or `define`) and close with `done`. Return values with `give` (or `give back`).
```plainscript
make calculateTax(amount, rate)
  if amount is below 0
    give 0
  done
  give amount * rate
done
```

### Control Flow
```plainscript
// Conditionals
if score is at least 90
  show "A"
otherwise if score is at least 80
  show "B"
otherwise
  show "C"
done

// Loops & AppleScript Natural Repeat Constructs
for each item in items
  show item
done

repeat 5 times
  show "Hello!"
done

repeat with item in items
  show item
done

repeat until lives is 0
  lives becomes lives - 1
done

while lives is above 0
  lives becomes lives - 1
done

// Natural Accessors & Comparisons
let firstVal is first item of items
let totalItems is count of items
if "admin" is in roles and score is equal to 100
  show "Admin mastery"
done
```

### Web Applications
A full web backend in single, clear intent blocks:
```plainscript
web app

serve folder "public"

route get "/"
  reply "Welcome to PlainScript!"
done

route post "/api/users"
  let name is body("name")
  if name is empty
    status 400
    reply json
      error is "Name is required"
    done
  done
  reply json
    ok is true
    user is name
  done
done

start 3000
```

### Database (SQLite & Postgres)
```plainscript
database "app.db"

query "SELECT id, name FROM users WHERE active = 1" as users

for each u in users
  show `${u.id}: ${u.name}`
done
```

### Async & Concurrency Combinators
PlainScript has first-class concurrency built directly into the grammar:
```plainscript
// Concurrency
let [user, orders] is all of [fetchUser(id), fetchOrders(id)]
let fastest is any of [mirrorA(), mirrorB()]

// Built-in retries
retry 3 times every 2s
  let res is get "https://api.example.com/health"
  show res
done
```

---

## 2. CLI Tooling & Diagnostics

| Command | Purpose |
|---|---|
| `plainscript new <name>` | Scaffold a new web app project |
| `plainscript new <name> --lib` | Scaffold a pure PlainScript package library with `pln.json` |
| `plainscript run <file.pln>` | Execute directly |
| `plainscript check [target]` | Run compiler diagnostics, import resolution & semantic validation |
| `plainscript build` | Compile `src/` to `dist/` |
| `plainscript build --target=esm` | Emit native ES Modules (`export { ... }`, `import`) |
| `plainscript build --target=bun` | Emit Bun-native code (`bun:sqlite`, native ESM) |
| `plainscript build --target=edge` | Emit Edge/Cloudflare/Deno compatible code |
| `plainscript build --standalone` | Package into single zero-dependency executable binary |
| `plainscript pack` | Package library into `.plz` distribution archive with `.d.ts` types |
| `plainscript unpack <archive.plz>` | Unpack and verify `.plz` package |
| `plainscript fix <file.pln>` | Automated self-healing (fixes missing `done`, `=` signs, typo keywords) |
| `plainscript benchmark` | Run LLM token density and syntax benchmark |
| `plainscript repl` | Start interactive PlainScript REPL |
| `plainscript fmt <file.pln>` | In-place code formatter |

---

## 3. Self-Healing & Agent Fixing

When generating or refactoring PlainScript code:
1. Always run `plainscript check` or `plainscript check --json`.
2. If syntax errors occur, invoke `plainscript fix <file.pln>` to auto-heal missing `done` delimiters and accidental `=` assignments.
3. Every block keyword (`make`, `if`, `while`, `for`, `route`, `group`, `test`, `try`) MUST close with `done`.
