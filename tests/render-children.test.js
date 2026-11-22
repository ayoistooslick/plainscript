'use strict';

// Rendering behaviour that compiles to React without a JSX transform:
// fragments, dynamic child lists built with loops and branches, reliable keys,
// and the compile-time shape of promise rejection handling.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { compileProject, diagnosticsOf } = require('./helpers');

function compileReact(entry, files = {}) {
  const project = compileProject({ 'main.pln': entry, ...files });
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
  const child = spawnSync(process.execPath, [script], { cwd: project.outRoot, encoding: 'utf8' });
  return child;
}

const LIST_SOURCE = `#syntax 2.1
import { createElement, Fragment } from "react"
import { count } from "std/list"

export type Item
    id: number
    title: text
end

export define List(props: any) returns any
    value items is props.items as list of Item
    render
        element "ul" with className: "list"
            when count(items) is greater than 0
                for each item in items
                    element "li" with key: item.id
                        item.title
                    end
                end
            otherwise
                element "li" with className: "empty"
                    "nothing"
                end
            end
        end
    end
end

export define Group() returns any
    render
        element Fragment with key: "group"
            element "span"
                "a"
            end
            element "span"
                "b"
            end
        end
    end
end
`;

test('loops and branches inside render build a reliable keyed child list', () => {
  const project = compileReact(LIST_SOURCE);
  const rendered = serverRender(project, 'List', {
    items: [{ id: 2, title: 'second' }, { id: 1, title: 'first' }],
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, '<ul class="list"><li>second</li><li>first</li></ul>');
  // React warns on stderr when a dynamic list has no keys; we pass one.
  assert.doesNotMatch(rendered.stderr, /unique "key"/);

  const empty = serverRender(project, 'List', { items: [] });
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, '<ul class="list"><li class="empty">nothing</li></ul>');
});

test('element Fragment renders sibling children without a wrapper', () => {
  const project = compileReact(LIST_SOURCE);
  const rendered = serverRender(project, 'Group');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, '<span>a</span><span>b</span>');
});

test('a control-transfer statement directly inside render is a diagnostic, not a crash', () => {
  const project = compileProject({
    'main.pln': `#syntax 2.1
import { createElement } from "react"

export define Broken() returns any
    render
        return 1
    end
end
`,
  });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.ok(errors.some((diagnostic) => diagnostic.code === 'PS3410'), JSON.stringify(errors));
});

test('a return inside a loop inside render is reported as PS3410', () => {
  const project = compileProject({
    'main.pln': `#syntax 2.1
import { createElement } from "react"

export define BrokenWithLoop() returns any
    render
        for each item in items
            return 1
        end
    end
end
`,
  });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.ok(errors.some((diagnostic) => diagnostic.code === 'PS3410'), JSON.stringify(errors));
});

test('a return inside a conditional branch inside render is reported as PS3410', () => {
  const project = compileProject({
    'main.pln': `#syntax 2.1
import { createElement } from "react"

export define BrokenWithBranch() returns any
    render
        when true
            return 1
        end
    end
end
`,
  });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.ok(errors.some((diagnostic) => diagnostic.code === 'PS3410'), JSON.stringify(errors));
});

test('a return inside a while loop inside render is reported as PS3410', () => {
  const project = compileProject({
    'main.pln': `#syntax 2.1
import { createElement } from "react"

export define BrokenWithWhile() returns any
    render
        while true
            return 1
        end
    end
end
`,
  });
  const errors = project.compiler.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.ok(errors.some((diagnostic) => diagnostic.code === 'PS3410'), JSON.stringify(errors));
});

test('Promise then/catch/finally are typed and their handlers are checked', () => {
  const accepts = diagnosticsOf(`#syntax 2.1
declare const p: Promise of number
p.then((n: number) => n + 1)
p.catch((reason: any) => 0)
p.finally(() => 0)
`);
  assert.deepEqual(accepts.map((diagnostic) => diagnostic.code), []);

  const wrongHandler = diagnosticsOf(`#syntax 2.1
declare const p: Promise of number
p.then((n: text) => n)
`);
  assert.ok(wrongHandler.some((diagnostic) => diagnostic.code === 'PS3343'));

  const unknownField = diagnosticsOf(`#syntax 2.1
declare const p: Promise of number
p.nope
`);
  assert.ok(unknownField.some((diagnostic) => diagnostic.code === 'PS3335' && /then, catch and finally/.test(diagnostic.message)));
});
