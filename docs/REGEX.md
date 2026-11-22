<!-- compile-examples -->

# Regular expressions

Regular expressions are values in PlainScript. A literal is parsed by the
lexer, assigned the primitive type `regex`, and compiled to a native JavaScript
`RegExp`. The pattern engine is therefore the host's engine: V8 in Node and in
Chromium, with the same capture, lookaround, Unicode and replacement semantics
as the JavaScript running beside it.

PlainScript adds a type, a literal syntax and compiler diagnostics. It does not
wrap matches in a second engine.

## Literals

```plainscript
#syntax 2.1

import { print } from "std/io"

set pattern to /item-(?<id>\d+)/i
print(pattern.test("ITEM-42"))
print(pattern.source)
print(pattern.flags)
```

A literal has the form `/pattern/flags`. The parser records both parts:

- `pattern` is the text between the slashes, with backslashes preserved.
- `flags` is the suffix drawn from `d`, `g`, `i`, `m`, `s`, `u`, `v` and `y`.
  Flags are validated by the host engine, so an unsupported or duplicated flag
  is a compile-time error rather than a runtime surprise.
- Empty patterns (`//`) are legal; they match at every position.

### Slash versus division

The lexer decides by expression position. A `/` after a value is division; a
`/` where an expression is expected starts a regex:

```plainscript
#syntax 2.1

import { print } from "std/io"

set width to 10
set ratio to width / 2
set matcher to /a\/b/

print(ratio)
print(matcher.test("a/b"))
```

After identifiers, literals, calls, member access, closing brackets and
`nothing`, `/` is division. After operators, commas, opening brackets, `return`
and similar expression starts, it begins a regex. Write `width / 2` with spaces
if a pattern is ever visually ambiguous; escaping a slash inside the pattern as
`\/` is always valid.

## The `regex` type

`regex` is a primitive in the checker:

```plainscript
#syntax 2.1

import { print } from "std/io"

set pattern to /^[a-z]+$/i
print(pattern is regex)
print("text" is regex)
print(pattern.ignoreCase)
```

The following members are typed:

| Member | Type | Meaning |
| --- | --- | --- |
| `test(text)` | `boolean` | Whether the pattern matches |
| `source` | `text` | Pattern source |
| `flags` | `text` | Active flags |
| `global` | `boolean` | `g` is set |
| `ignoreCase` | `boolean` | `i` is set |
| `multiline` | `boolean` | `m` is set |
| `dotAll` | `boolean` | `s` is set |
| `unicode` | `boolean` | `u` or `v` is set |
| `sticky` | `boolean` | `y` is set |
| `hasIndices` | `boolean` | `d` is set |

A regex is JSON-serialisable as `{}` like a JavaScript `RegExp`; do not send it
across a process boundary expecting pattern text. Send `source` and `flags` and
reconstruct on the other side.

Because `test` delegates to the native object, a global or sticky regex keeps
`lastIndex` between calls. Use a fresh literal for a stateless test, or use the
`std/text` helpers, which reset the index for each call.

## Matching and captures

`std/text` provides typed helpers that return records rather than native match
arrays. They are usually clearer than unpacking JavaScript's array shape.

```plainscript
#syntax 2.1

import { print } from "std/io"
import { matches, findMatch, findAllMatches, matchTexts } from "std/text"

set content to "release-2.1 then release-2.2"

print(matches(content, /release-\d+\.\d+/))

set first to findMatch(content, /release-(?<major>\d+)\.(?<minor>\d+)/)
when first is not equal to nothing
    print(first.text)
    print(first.index)
    print(first.groups[0])
    print(first.named["major"])
    print(first.named["minor"])
end

print(matchTexts(content, /release-\d+\.\d+/))
```

`RegexMatch` is a record:

```plainscript
export type RegexMatch
    text: text
    index: number
    groups: list of text
    named: map of text to text
end
```

- `groups[0]` is the first positional capture, matching JavaScript's
  `match[1]` convention. `text` is the full match.
- `named` contains named captures by group name.
- A participating empty group is `""`. A group that did not participate is also
  an empty string, because the record stores text rather than nullable slots.
- `findMatch` returns `nothing` when there is no match.
- `findAllMatches` and `matchTexts` reset `lastIndex`, so a global literal is
  safe to reuse.

## Replacement and splitting

```plainscript
#syntax 2.1

import { print } from "std/io"
import { replaceMatch, replaceAllMatches, splitMatch, escapeRegex } from "std/text"

print(replaceMatch("a1b22", /\d+/, "#"))
print(replaceAllMatches("a1b22", /\d+/g, "#"))
print(replaceAllMatches("2026-11-22", /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/g, "$<day>/$<month>/$<year>"))
print(splitMatch("a, b,c", /,\s*/))
print(escapeRegex("a.b*c"))
```

Replacement strings use JavaScript's native substitution syntax: `$&` for the
whole match, `$1` for a capture and `$<name>` for a named capture.
`replaceMatch` replaces the first match; `replaceAllMatches` replaces every
match and adds the `g` behaviour itself. `splitMatch` splits on every match and
returns a `list of text`.

`escapeRegex` escapes the characters that have special meaning in a pattern. It
is for building a literal from user text, not for turning arbitrary input into a
trusted pattern.

## Unicode, multiline and zero-length matches

The flags are the host's:

- `u` enables Unicode code-point matching; `v` enables the Unicode sets mode in
  engines that support it.
- `m` makes `^` and `$` match at line boundaries.
- `s` makes `.` match newlines.
- `i` uses Unicode-aware case folding when combined with `u`.
- `g` and `y` are stateful on the native `RegExp`; the `std/text` helpers reset
  the index.

Zero-length patterns are valid. A global zero-length match advances by one
position in JavaScript, and PlainScript inherits that behaviour:

```plainscript
#syntax 2.1

import { print } from "std/io"
import { count } from "std/list"
import { findAllMatches } from "std/text"

print(count(findAllMatches("ab", /(?:)/)))
```

## Diagnostics

| Code | Meaning |
| --- | --- |
| `PS1006` | Unterminated regex literal |
| `PS1007` | Invalid or duplicated flag |
| `PS1008` | Invalid pattern for the host engine |

Pattern validation runs when the literal is lexed. The diagnostic includes the
engine's reason, for example `Unterminated group` or `Invalid group`, so a bad
pattern fails `plainscript check` before any module executes.

```text
value pattern is /(/      # PS1008: Invalid regular expression: Unterminated group
value pattern is /abc     # PS1006: Unterminated regular expression literal
value pattern is /a/gg    # PS1007: Invalid regular expression flags
```

## Differences from JavaScript

- There is no `RegExp` constructor in the language surface. Use a literal, or
  call a declared host API if a truly dynamic pattern is required. Dynamic
  patterns cannot receive compile-time validation.
- A regex is typed `regex`, not `object` or `any`. This is a PlainScript
  addition; the emitted value is a native `RegExp`.
- The checker rejects reading native array-shaped match properties directly
  from a `regex`; use `std/text` helpers for captures.
- The pattern language is exactly the host's. PlainScript does not claim
  cross-engine portability for features one engine lacks.

## Runtime compatibility

The emitted code uses a JavaScript regex literal, so it runs in Node and every
browser that V8 or another supported engine runs. There is no regex polyfill and
no runtime dependency. Replacement and split helpers live in `std/text` and are
plain JavaScript functions.
