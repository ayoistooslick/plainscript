# PlainScript for VS Code

This extension connects VS Code to `plainscript-lsp`, the language server shipped by
`plainscript-lang` 2.0. It provides:

- Compiler diagnostics for the current document
- Completion for language keywords, declarations, imports and standard-library exports
- Hover types and function signatures
- Go to definition (including imports across PlainScript modules)
- Find references and document-scoped rename
- Document symbols
- Whole-document formatting

Run `npm install` and `npm run compile` is not required (the extension is plain CommonJS).
For local development, open this directory with `code --extensionDevelopmentPath=.`. The
extension first resolves the installed `plainscript-lang/lsp`; when running from the
repository without installing the package, it falls back to `../../src/lsp.js`.

The language server is also available directly:

```bash
plainscript lsp
```

The server is dependency-free and speaks LSP over stdio. No editor feature is advertised
unless the corresponding request is implemented.
