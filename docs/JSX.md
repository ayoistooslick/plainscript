<!-- compile-examples -->

# JSX and React

PlainScript parses JSX as native syntax. A `.pln` file can contain React
components directly: there is no separate `.jsx` layer, no Babel step and no
runtime wrapper. The compiler parses elements and fragments, type-checks props
where it can, and lowers the tree to either the classic `createElement` factory
or the automatic JSX runtime.

JSX is available in 2.1 source, including files without an explicit pragma,
because the dialect and the JSX transform are independent. Components can still
use the ordinary PlainScript constructs around the markup.

## A first component

```plainscript
#syntax 2.1

import { createElement } from "react"

export type GreetingProps
    name: text
    excited?: boolean
end

define mark(excited: boolean) returns text
    when excited
        return "!"
    end
    return "."
end

export define Greeting(props: GreetingProps) returns any
    return <p className="greeting">
        Hello, {props.name}{mark(props.excited ?? false)}
    </p>
end
```

The default runtime is **classic**: JSX becomes
`createElement(type, props, ...children)`. React projects therefore need
`createElement` in scope, exactly as a classic-runtime JavaScript component
does. `Fragment` is also required when the component uses `<>…</>`.

`return any` is the normal type for a React element here. React's own types are
not modelled by the checker; the boundary type is `any`, while the component's
props are fully checked at PlainScript call sites.

## Fragments and children

```plainscript
#syntax 2.1

import { createElement, Fragment } from "react"
import { map } from "std/list"

export type Item
    id: number
    title: text
end

export define ItemList(props: { items: list of Item }) returns any
    return <>
        <h2>Items</h2>
        <ul>
            {map(props.items, (item: Item) => <li key={item.id}>{item.title}</li>)}
        </ul>
    </>
end
```

Fragments have no wrapper element. Expression containers may contain any
expression, including a call that returns an array of elements. Keys are not
inferred; pass `key` explicitly inside a mapped list, as in JavaScript React.

## Attributes

All ordinary JSX attribute forms are supported:

```plainscript
#syntax 2.1

import { createElement } from "react"

export define Link(props: { href: text, label: text }) returns any
    value extra is { target: "_blank", rel: "noreferrer" }
    return <a href={props.href} {...extra} data-kind="external">
        {props.label}
    </a>
end
```

- `name="text"` and `name={expression}` are equivalent to React props.
- A bare attribute such as `disabled` becomes `true`.
- `{...record}` spreads a record into the props object.
- HTML entities in text (`&amp;`, `&nbsp;`, numeric entities) are decoded.
- Text-only children are whitespace-normalised the way React's transform does:
  newlines and indentation around text collapse, while meaningful spaces inside
  a line are kept.
- `{/* … */}` comments are allowed inside a JSX tree.

Attribute names are emitted verbatim. React's `className`, `htmlFor` and
`onClick` spellings are therefore the ones to use; PlainScript does not rename
attributes.

## Events and hooks

Hooks are ordinary imported functions, and event handlers are ordinary
PlainScript lambdas:

```plainscript
#syntax 2.1

import { createElement, useState } from "react"

export define Counter() returns any
    set (count, setCount) to useState(0)
    return <button type="button" onClick={() => setCount(count + 1)}>
        Clicked {count} time(s)
    </button>
end
```

The generated module is a normal ES module, so hooks, context, refs, suspense
and third-party components work exactly as they do in JavaScript React. A
component imported from an npm package is typed `any`; local components with a
record prop type are checked.

## Automatic runtime

Set the automatic runtime per file with pragmas:

```plainscript
#syntax 2.1
# @jsxRuntime automatic
# @jsxImportSource react

export define App() returns any
    return <main>
        <h1>Automatic runtime</h1>
        <p>No createElement import is needed.</p>
    </main>
end
```

The emitted module imports `jsx`/`jsxs` from `react/jsx-runtime` (or from
`<importSource>/jsx-runtime`). Components, props, children and keys behave the
same; only the factory changes.

For Preact or another compatible runtime:

```plainscript
#syntax 2.1
# @jsxRuntime automatic
# @jsxImportSource preact

export define Island() returns any
    return <section class="island">Preact island</section>
end
```

Automatic JSX accepts `class` as an attribute because Preact does. React's
automatic runtime expects `className`; the compiler does not rewrite either.

## Project configuration

Per-file pragmas override project defaults. Defaults live in
`plainscript.config.json`, either under a top-level `jsx` object or under
`compilerOptions.jsx`:

```json
{
  "jsx": {
    "jsxRuntime": "automatic",
    "jsxImportSource": "react"
  }
}
```

```json
{
  "compilerOptions": {
    "jsx": {
      "jsxRuntime": "classic",
      "jsxFactory": "createElement",
      "jsxFragment": "Fragment"
    }
  }
}
```

Supported pragmas, read from the first lines of a file:

| Pragma | Effect |
| --- | --- |
| `# @jsx h` | Classic factory function, for example Preact's `h` |
| `# @jsxFrag Fragment` | Fragment factory and forces the classic runtime |
| `# @jsxRuntime automatic` | Select the automatic runtime |
| `# @jsxRuntime classic` | Select the classic runtime |
| `# @jsxImportSource preact` | Automatic runtime package; also selects automatic |

The precedence is: built-in default → `plainscript.config.json` → file pragma.
JSX options are resolved per file, so a React page and a Preact island can live
in one repository.

A custom classic factory works with any function of the shape
`(type, props, ...children) => value`:

```plainscript
#syntax 2.1
# @jsx h
# @jsxFrag Group

import { print } from "std/io"
import { join } from "std/text"

define h(tag: any, props: any, ...children: list of any) returns text
    return "<{tag}>{join(children, \"\")}</{tag}>"
end

define Group(props: any, ...children: list of any) returns text
    return join(children, "")
end

print(<main><Group><b>custom</b></Group></main>)
```

## Prop checking

When a component has a declared record prop type, the checker validates its
call sites:

- `PS3421` — a prop value has the wrong type.
- `PS3420` — a prop name is not declared.
- `PS3422` — a required prop is missing.
- `PS3405` — classic JSX is used without the factory in scope.

```text
type CardProps
    title: text
    count: number
end

define Card(props: CardProps) returns any …

<Card title={1} count={2} />      # PS3421: title expects text
<Card title="x" />                # PS3422: count is required
<Card title="x" count={2} extra="y" />  # PS3420: extra is not declared
```

Optional props end in `?`; spread props are not checked member by member
because their record type may not be statically known.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `PS1009` | Invalid JSX character or malformed tag name |
| `PS1010` | Unclosed JSX expression container |
| `PS1011` | Invalid JSX attribute |
| `PS1012` | Unclosed JSX element |
| `PS1013` | Closing tag does not match the opening tag |
| `PS1014` | Invalid JSX entity |
| `PS3405` | Classic factory is not in scope |
| `PS3420` | Unknown component prop |
| `PS3421` | Prop type mismatch |
| `PS3422` | Missing required component prop |

## React tooling

The `integrations/react-vite` project is a React 19 + Vite application whose
component is written in PlainScript JSX. Its test renders the component through
`react-dom/server` and its production path runs the normal Vite build; no Babel
JSX plugin or separate JavaScript component is maintained.

For a Vite project:

1. Write the component in `src/App.pln` with `#syntax 2.1`.
2. Import React's `createElement` (classic) or use the automatic pragmas.
3. Run `plainscript build` to emit `generated/App.js`.
4. Let Vite import the generated module as usual.

Source maps are emitted beside the generated module, so browser and Node stack
traces point back to the `.pln` source.

## What is deliberately not supported

- `.tsx` files are not parsed; PlainScript's own `.pln` files contain JSX. Use
  `plainscript migrate` to wrap an existing TSX component behind a boundary, or
  rewrite it as PlainScript JSX.
- TypeScript's JSX type namespace (`JSX.IntrinsicElements`) is not imported.
  Only component props declared in PlainScript are checked.
- There is no automatic key insertion, and no compiler-managed React state.
- Vue templates and Svelte components are not JSX; only JSX factory runtimes
  are supported. A framework that compiles JSX through a compatible factory or
  automatic runtime works.
