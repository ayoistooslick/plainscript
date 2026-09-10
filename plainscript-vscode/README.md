# PlainScript Language Support

VS Code syntax support for PlainScript `1.0.361`.

The extension provides:

- `.pln` language registration
- current keyword, comparison, string, template, number, and function scopes
- folding and indentation for `done` blocks
- snippets for the maintained declaration, web, SQL, async, test, and module forms

The compiler is the authority for accepted syntax. Validate source with:

```bash
node compiler/cli.js check path/to/file.pln
```

## Development

Open this folder in VS Code and press `F5` to launch an Extension Development
Host. The extension has no build step.

## Package

```bash
npm install
npx vsce package
```