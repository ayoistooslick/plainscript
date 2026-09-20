# PlainScript Grammar Reference

This document is the single source of truth for the PlainScript language
surface. Compiler behavior (`compiler/lexer.js`, `compiler/parser.js`,
`compiler/generator.js`) overrides any prose in this or other docs.

Version: 1.0.363

---

## 1. Files and encoding

A `.pln` file is UTF-8 text. Line comments start with `//`. Blank lines are
ignored. Indentation is conventional and ignored by the lexer; blocks are
*keyword* delimited, not indentation delimited.

## 2. Tokens and keywords

PlainScript is lexed into tokens first. Almost every line begins with a
keyword; the parser dispatches statements off the first token. The full
keyword set:

```text
remember  let  show  print  display  as  is  if  otherwise  else  done  end
do  greater  less  than  make  define  function  give  return  give back
becomes  is now  set to  change to  for  each  every  in  while  use
import  include  load  when  someone  visits  listen  start on  serve on
on  reply  respond  send back  json  file  serve  serve static  serve public
folder  above  below  at  least  most  not  empty  contains  starts  ends
with  between  and  or  instanceof  now  back  true  false  null  undefined
web  route  start  run on  database  connect database  use database
ask  prompt  ocr  gather  filter  total  match  against  pattern  parallel
stream  emit  happens  catches  yield  symbol  debugger  to  together  be
then  plus  minus  times  divided by  list with  record with  raise  raises
choosing  uses  fills  repeat  until  log  query  insert  update  delete
execute
```

Some keywords are contextual: `end` is a universal block terminator (an alias
for `done`); `most` only forms a comparator as `is at most`.

### Reserved words: names you cannot declare

You cannot use a keyword as a variable, function, or parameter name. This
includes (non-exhaustively): `log`, `start`, `empty`,
`pattern`, `match`, `filter`, `gather`, `stream`, `emit`, `run`,
`then`, `to`, `file`*, `load`, `route`, `database`, `raise`, `retry`,
`between`, `contains`, `with`, `and`, `or`, `not`.

\* `file` is accepted as a variable name by `remember` but not as a
function name. `back`, `total`, `reply`, `respond`, `send` and the SQL words
(`query`, `insert`, `update`, `delete`, `execute`) are contextual and *are*
accepted as declaration names where unambiguous.

When a reserved word is used as a name, the compiler reports a clean error
naming the word, e.g.:

```text
Line 1, Column 10: Expected a variable name after "remember".

"log" is a reserved PlainScript word and cannot be used as a name here.
Pick a different name (see docs/PLAINSCRIPT-GRAMMAR.md).
```

### Operators

| Token | Meaning |
|---|---|
| `+ - * / %` | arithmetic |
| `**` | exponentiation |
| `plus`, `minus`, `times`, `divided by` | word-form arithmetic |
| `->` | case arrow / lambda arrow |
| `.` `?.` `??` | member access, optional chain, nullish coalesce |
| `...` | spread |
| `(` `)` `[` `]` `{` `}` `,` `:` | grouping, literals, comma, object colon |

### Assignment operators

| Operator | Meaning |
|---|---|
| `=` | never used as a token; assignments are word-formed (see §4) |
| `+=` | add-assign (lexed as `PLUS_ASSIGN`; the legacy spelling `++=` is accepted and normalized) |
| `-=` | subtract-assign |
| `*=` | multiply-assign |
| `/=` | divide-assign |
| `%=` | remainder-assign |
| `\|\|=` | logical-or assign (word form: `or becomes`) |
| `&&=` | logical-and assign (word form: `and becomes`) |
| `??=` | nullish assign (word form: `nullish becomes`) |

## 3. Literals

```plainscript
remember zero as 0
remember negative as -5
remember pi as 3.14
remember hex as 0xFF
remember big as 1n
remember quoted as "double-quoted string"
remember templated as `template ${interpolation}`
remember truth as true
remember falsity as false
remember nothing as null
remember absent as undefined
remember arr as [1, 2, 3]
remember arr2 as list with 1, 2, 3
remember obj as { name: "Ada", age: 17 }
remember rec as record with name "Ada" and age 17
```

Arrays and records come in both a bracket and a word form; the two normalize
to the same AST.

### Nullish equality (v1.0.364)

`is null` is deliberately **nullish**: it matches `null` *and* `undefined`.
PlainScript builtins intentionally differ — `env()` of a missing variable
yields `null`, while reading a missing array slot (e.g. `first of []`)
yields `undefined` — so a guard written as `is null` must never silently
fail on the other nullish value:

```plainscript
remember f as first of []
if f is null          // true — catches null AND undefined
    show "missing"
done
```

`is undefined` is the strict escape hatch (matches `undefined` only), and
comparing the two literals to each other keeps JavaScript semantics
(`null is undefined` is false). `is not null` is nullish the same way.

### Parser limits

Expressions may nest up to 300 levels deep and blocks up to 200 levels deep
(real code never comes close). Beyond the limit compilation fails with a
clean positional error — never a JavaScript stack trace. Runtime failures of
common shapes (calling a non-function, reading a property of a missing value,
invalid JSON) are translated into PlainScript wording with a hint; run with
`--sourcemap` to also get the source-mapped `.pln` stack line.

## 4. Variables and assignment

## 4. Variables and assignment

Declaration — all three are identical and compile to the same JavaScript:

```plainscript
let x is 5
let y be 6
remember z as 7
```

Reassignment (word-formed; PlainScript has no `=` symbol):

```plainscript
x becomes 10
x is now 11
x set to 12
x change to 13
flag or becomes true        // flag ||= true
flag and becomes false      // flag &&= false
val nullish becomes "dflt"  // val ??= "dflt"
```

Prefix aliases (v1.0.363): `set <target> to <value>` and
`change <target> to <value>` are the prefix forms of the `set to` /
`change to` assignment above (the target may also be a member or a numbered
item):

```plainscript
set x to 10
change x to 20
set data at position 0 to 99
```

Compound arithmetic assignment:

```plainscript
n += 1       n -= 2       n *= 3       n /= 4       n %= 5
n ++= 1      // legacy spelling of +=; still accepted and normalized
```

Destructuring still uses the word form against a bracket/brace pattern:

```plainscript
remember [a, b] as pair
remember { x, y } as point
```

## 5. Statements and blocks

Blocks open with a keyword line and close with `done` **or** `end`. They are
equivalent; `end` maps to the same terminator as `done` in the lexer.

| Statement | Opens | Closes with |
|---|---|---|
| `if <cond>` (with optional `otherwise`, `otherwise if`) | body | `done` |
| `for each <item> in <list>` | body | `done` |
| `for index <i> from <a> to <b>` | body | `done` |
| `while <cond>` | body | `done` |
| `repeat <n> times` / `repeat with <v> [...]` / `repeat while/until <cond>` | body | `done` |
| `make <name>(<params>)` (also `define <name>(<params>)`) | body | `done` |
| `match <value> against` | `->` cases + `otherwise ->` | `done` |
| `switch <value> against` | `->` cases | `done` |
| `try` | body with `recover as <err>` / `finally` clauses | `done` |
| `web app` / `route <method> "<path>"` / `when someone visits "<path>"` / `listen on <port>` blocks | body | `done` |
| `database "file.db"` SQL blocks (`query`, `insert`, `update`, `delete`, `execute`) | raw SQL | `done` (or `end`) |
| `run in parallel` | concurrent statements (each statement's value is awaited and resolved with `Promise.all`, collected in body order) | `done as <name>` |
| `when "<event>" happens` | body | `done` |
| `every <interval>` / `schedule "<cron>"` | body | `done` |
| `websocket server`, `bot`, `whatsapp bot`, `mail transport` | body | `done` |
| `stream "<file>" as <line>` | body | `done` |
| `test "<name>"` | `check` / `equals` / `raises` | `done` |

A `make` body that contains `yield` compiles to a generator function
(`function*`). SQL block text is passed through verbatim to SQLite.

## 6. Expressions

Recursive-descent parsing with precedence. Member access uses `of`:

```plainscript
remember user as { profile: { name: "Ada" } }
show profile of user                // user.profile
show name of profile of user        // user.profile.name   (chains build inside-out)
remember items as [10, 20, 30]
show items at position 1            // items[1]
show count of items                 // items.length
```

Call syntax is plain `name(args)`. `to ... together` declares a function
(modern verb form of `make`/`define`); calling it is plain `add(a, b)` or
inline `a + b`.

Lambda functions: `(n) -> n * 2` (the arrow body is an expression — no
`give`/`return` inside it). The block-bodied form uses `do` and ends with
`done`: `(n) do ... done` with `give` inside. Lambdas can reference
surrounding variables.

## 7. Built-in functions (STDLIB)

The runtime dispatches known call names at compile time; each is documented in
`compiler/generator.js` in the `STDLIB` table. Highlights:

- **I/O & console**: output statements `show` / `print` / `display` / `log`
  (all compile to `console.log(...)`); input statements `ask "<prompt>" as
  <name>` (`prompt` is a synonym). STDLIB functions: `stderr(...)`
  (compiles to `console.error`), `confirm("prompt")` (yes/no prompt →
  boolean), `choose("prompt", options)` (numbered picker → chosen option),
  `clearTerminal()`, `terminalWidth()`, `terminalHeight()`
- **Math**: `abs`, `round`, `floor`, `ceil`, `sqrt`, `pow`, `min`, `max`,
  `random`; `Math.*` member calls pass through to JavaScript. BigInt helpers:
  `bigInt(n)`, `bigIntAsIntN(width, n)`, `bigIntAsUintN(width, n)`.
- **Statistics & vectors**: `mean`, `median`, `variance`, `deviation`,
  `dotProduct`, `magnitude`, `normalize`
- **Randomness**: `randomInteger`, `randomChoice`, `shuffle`, `sample`,
  `weightedChoice`
- **Strings**: `trim`, `substring`, `split`, `join`, `replace`,
  `regexReplace`, `startsWith`, `endsWith`, `parseInt`, `parseFloat`,
  `parseBoolean`, `characters`
- **Collections**: `first`, `last`, `push`, plus the functional statements
  `gather each <item> in <list> giving <expr>` (maps the list),
  `filter each <item> in <list> when <cond>` (filters the list),
  `total each <item> in <list> giving <expr>` (sums into the variable) —
  each statement reassigns its collection variable
- **Files**: `readFile`, `writeFile`, `appendFile`, `fileExists`, `copyFile`,
  `moveFile`, `deleteFile`, `makeFolder`, `listFolder`
- **Network**: HTTP method expressions `get "url" timeout 5000`,
  `post "url" with {...} headers {...}`; process and job helpers
  `runCommand` (returns `{ ok, code, stdout, stderr }`), `sleep`,
  `run background`, `run in parallel`
- **Data**: `jsonEncode`, `jsonDecode`, `yamlEncode`, `yamlDecode`,
  `base64Encode`, `base64Decode`, `textToBytes`, `bytesToText`
- **Async**: `all of [...]`, `any of [...]`, `settled of [...]`
  (combinator form — not `allOf`/`anyOf`/`settledOf`), `withTimeout(x, ms)`
- **AI**: `chat`, `chatWith`, `embedText`, `embedWith`, `similarity` — all
  provider-based; no LLM is embedded in the runtime
- **Memoization**: `memoize(fn)` returns a cached wrapper
- **Regex matching**: `match pattern "..." in text as result`

## 8. Assignment of grammar vs. prose

This reference is normative. Where a README, SPEC, or knowledge document
conflicts with the compiler, the compiler (and this file) win.
