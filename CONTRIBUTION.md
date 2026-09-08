# Contributing to PlainScript

## Thanks for your interest in contributing to PlainScript.
> An IOPL created by Ayokunle.

PlainScript is a small programming language and compiler designed to make programming readable without hiding the underlying power of JavaScript. Contributions are welcome, whether you're fixing a bug, improving the compiler, adding tests, improving documentation, or proposing a new feature.

Before You Start

Please read the README and existing documentation before making changes.

For larger changes, especially language or compiler changes, open an issue first so the approach can be discussed before significant implementation work begins.

Small fixes, documentation improvements, and test improvements can usually go directly into a pull request.

Development Setup

PlainScript is a Node.js project.

Clone the repository and install dependencies:
```bash
git clone https://github.com/ayoistooslick/plain-code.git
cd plain-code
npm install
```
Run the test suite with:
```bash
npm test
```
All tests should pass before submitting a pull request.

Making Changes

When working on PlainScript:

- Keep changes focused and related to the issue or feature being addressed.
- Preserve existing language behavior unless the change intentionally modifies the language.
- Prefer small, understandable compiler changes over large rewrites.
- Keep backwards compatibility in mind.
- Add regression tests for bugs you fix.
- Add tests for new language features.
- Update documentation when user-facing behavior changes.
- Do not silently introduce syntax that conflicts with existing PlainScript syntax.

PlainScript has a deliberately readable syntax. New syntax should fit that design rather than simply exposing JavaScript syntax in a different spelling.

Testing

The test suite is the primary way to verify compiler behavior.

Run:
```bash
npm test
```
Before submitting a pull request, make sure the complete suite passes.

A successful test run should report:

457 tests: 457 passed, 0 failed

The exact number of tests may increase as the project evolves.

Regression Tests

If you fix a bug, add a test that would have failed before the fix whenever practical.

For compiler changes, tests should generally cover:

1. Lexing
2. Parsing
3. Code generation
4. Runtime or integration behavior when applicable
5. Error handling when applicable

PlainScript Language Changes

Changes to the PlainScript language require extra care.

If you add or modify syntax:

- Update the lexer.
- Update the parser.
- Update code generation as necessary.
- Add positive tests.
- Add invalid-input tests where appropriate.
- Consider interactions with existing syntax.
- Update the documentation and examples.

Do not remove existing syntax or change its meaning without documenting the compatibility impact.

JavaScript Gateway

PlainScript supports a JavaScript Gateway for cases where PlainScript does not yet provide native syntax or functionality.

This includes JavaScript blocks and JavaScript interoperability.

When modifying the JavaScript Gateway:

- Preserve JavaScript blocks verbatim where the language requires it.
- Ensure PlainScript variables can continue to interact with gateway code correctly.
- Test async behavior.
- Test gateway behavior inside functions, routes, and loops where applicable.
- Test npm package detection and imports, including hyphenated and scoped package names.

Dependencies

Avoid adding dependencies unless they provide meaningful value.

When adding a dependency:

- Explain why it is needed.
- Keep the dependency's usage focused.
- Add or update tests where appropriate.
- Update dependency-related documentation if the dependency changes user-facing behavior.

Documentation

Documentation is part of the project, not an afterthought.

If a change affects users, update the relevant documentation.

This may include:

- "README.md"
- "docs/index.html"
- Examples
- CLI documentation
- Language feature documentation

Documentation should describe implemented behavior accurately. Do not document planned or experimental behavior as if it were already supported.

Pull Requests

Create a focused branch for your work:

git checkout -b feature/my-change

Make your changes, then run the tests:

npm test

Review your changes:

git diff
git status

Commit with a clear message:

git add .
git commit -m "feat: describe the change"

Push your branch:

git push -u origin feature/my-change

Then open a pull request.

Pull Request Guidelines

A good pull request should explain:

- What changed
- Why it changed
- How it was tested
- Any compatibility considerations
- Any documentation that was updated

Keep pull requests focused. A feature, unrelated cleanup, documentation rewrite, and personal vendetta against indentation should generally not become one enormous pull request.

Commit Messages

Use short, descriptive commit messages.

Examples:

feat: add string interpolation
fix: handle nested imports correctly
test: add gateway regression coverage
docs: update installation instructions
refactor: simplify expression parsing

Use a more specific description in the commit body when the change needs additional context.

Issues and Bug Reports

When reporting a bug, include:

- What you expected to happen
- What actually happened
- A minimal PlainScript example that reproduces the problem
- The command you ran
- The relevant error message
- Your Node.js version when relevant
- Your PlainScript version when relevant

A small reproduction is much more useful than a paragraph explaining that "the compiler is being weird."

Feature Requests

For feature requests, explain:

- What problem the feature solves
- What the proposed PlainScript syntax could look like
- Why the feature belongs in PlainScript rather than being handled through existing functionality
- Whether the proposal affects existing syntax or behavior

Language design changes should prioritize readability, consistency, and composability.

Code of Conduct

Contributors are expected to communicate respectfully and constructively.

Technical disagreement is normal and encouraged. Personal attacks, harassment, or deliberately disruptive behavior are not.

The goal is to make PlainScript better, not to win an argument on the internet, a task humanity has historically been spectacularly bad at.

License

By contributing to PlainScript, you agree that your contributions will be licensed under the same license as the project, subject to the terms of that license.

Questions

If you're unsure whether a change belongs in the project, open an issue and describe what you are trying to accomplish before investing heavily in an implementation.

Thanks for helping make **`plainscript`** better. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for the list of project contributors.