'use strict';

// Native JSX: classic and automatic runtimes, fragments, attribute forms,
// expression children, custom factories and component prop checking.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { compileProject, codesOf } = require('./helpers');

function compileReact(entry) {
  const project = compileProject({ 'main.pln': entry });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.deepEqual(errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`), []);
  return project;
}

function serverRender(project, component, props) {
  const script = path.join(project.outRoot, 'render-check.mjs');
  fs.writeFileSync(script, `import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { ${component} } = await import("./main.js");
process.stdout.write(renderToStaticMarkup(createElement(${component}, ${JSON.stringify(props || {})})));
`);
  return spawnSync(process.execPath, [script], { cwd: project.outRoot, encoding: 'utf8' });
}

const CLASSIC_SOURCE = `#syntax 2.1
import { createElement, Fragment } from "react"
import { map } from "std/list"

export type CardProps
    title: text
    count?: number
end

export define Card(props: CardProps) returns any
    return <article className="card">
        <h2>{props.title}</h2>
        <p>{props.count ?? 0}</p>
    </article>
end

export define App() returns any
    return <>
        <Card title="Hello &amp; welcome" count={2} />
        <ul>{map([1, 2], (n: number) => <li key={n}>{n}</li>)}</ul>
        <input disabled />
    </>
end
`;

test('classic JSX renders through React with fragments, children and entities', () => {
  const project = compileReact(CLASSIC_SOURCE);
  const rendered = serverRender(project, 'App');
  assert.strictEqual(rendered.status, 0, rendered.stderr);
  assert.strictEqual(
    rendered.stdout,
    '<article class="card"><h2>Hello &amp; welcome</h2><p>2</p></article><ul><li>1</li><li>2</li></ul><input disabled=""/>',
  );
  assert.doesNotMatch(rendered.stderr, /unique "key"/);
});

test('the generated JavaScript uses the readable classic factory by default', () => {
  const project = compileReact(CLASSIC_SOURCE);
  const generated = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(generated, /createElement\("article"/);
  assert.match(generated, /createElement\(Fragment, null/);
});

test('a JSX pragma selects a custom factory', () => {
  const project = compileProject({
    'main.pln': `#syntax 2.1
# @jsx h
import { print } from "std/io"
import { join } from "std/text"

define h(tag: any, props: any, ...children: list of any) returns text
    return "<{tag}>{join(children, \"\")}</{tag}>"
end

print(<main className="custom"><section>a<b>b</b></section></main>)
`,
  });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.deepEqual(errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`), []);
  const child = spawnSync(process.execPath, [project.entryOut], { cwd: project.outRoot, encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(child.stdout, '<main><section>a<b>b</b></section></main>\n');
});

test('the automatic runtime imports jsx/jsxs from the configured runtime', () => {
  const project = compileReact(`#syntax 2.1
# @jsxRuntime automatic
# @jsxImportSource react
import { map } from "std/list"

define Card(props: { title: text }) returns any
    return <article>{props.title}</article>
end

export define App() returns any
    return <main>
        <Card title="auto" />
        {map([1, 2], (n: number) => <span key={n}>{n}</span>)}
    </main>
end
`);
  const generated = fs.readFileSync(project.entryOut, 'utf8');
  assert.match(generated, /from "react\/jsx-runtime"/);
  assert.match(generated, /__psx_jsx/);
  const rendered = serverRender(project, 'App');
  assert.strictEqual(rendered.status, 0, rendered.stderr);
  assert.strictEqual(rendered.stdout, '<main><article>auto</article><span>1</span><span>2</span></main>');
});

test('spread attributes and null children are supported', () => {
  const project = compileReact(`#syntax 2.1
import { createElement } from "react"

export type RowProps
    id: number
    title: text
end

define Row(props: RowProps) returns any
    return <li>{props.title}</li>
end

export define List(props: any) returns any
    value rows is props.rows as list of RowProps
    value shared is { className: "rows" }
    set first to nothing
    when rows[0] is not equal to nothing
        change first to <Row {...rows[0]} />
    end
    return <ul {...shared}>{first}</ul>
end
`);
  const rendered = serverRender(project, 'List', { rows: [{ id: 1, title: 'one' }] });
  assert.strictEqual(rendered.status, 0, rendered.stderr);
  assert.strictEqual(rendered.stdout, '<ul class="rows"><li>one</li></ul>');
});

test('component props are checked: wrong type, unknown name, missing required', () => {
  const codes = codesOf(`#syntax 2.1
# @jsxRuntime automatic

type CardProps
    title: text
    count: number
end

define Card(props: CardProps) returns any
    return <article>{props.title}</article>
end

set a to <Card title={1} count={2} />
set b to <Card title="x" count={2} extra="no" />
set c to <Card title="x" />
`);
  assert.ok(codes.includes('PS3421'), JSON.stringify(codes));
  assert.ok(codes.includes('PS3420'), JSON.stringify(codes));
  assert.ok(codes.includes('PS3422'), JSON.stringify(codes));
});

test('a mismatched closing tag is reported at the close', () => {
  const codes = codesOf('#syntax 2.1\nset x to <div></span>\n');
  assert.ok(codes.includes('PS1013'), JSON.stringify(codes));
});

test('an unclosed JSX element is a diagnostic, not a crash', () => {
  const codes = codesOf('#syntax 2.1\nset x to <div><span></span>\n');
  assert.ok(codes.includes('PS1012'), JSON.stringify(codes));
});

test('classic JSX without a factory in scope is reported', () => {
  const codes = codesOf('#syntax 2.1\nset x to <div />\n');
  assert.ok(codes.includes('PS3405'), JSON.stringify(codes));
});

test('JSX text keeps meaningful spaces and collapses indentation', () => {
  const project = compileReact(`#syntax 2.1
import { createElement } from "react"

export define Line() returns any
    return <p>
        Hello
        <b>world</b>
        again
    </p>
end
`);
  const rendered = serverRender(project, 'Line');
  assert.strictEqual(rendered.status, 0, rendered.stderr);
  assert.strictEqual(rendered.stdout, '<p>Hello<b>world</b>again</p>');
});
