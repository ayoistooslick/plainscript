# Torture-test fixtures

Each subdirectory is a self-asserting PlainScript program exercised by
`tests/torture.test.js` (part of `npm test`). The runner copies a scenario
into a fresh temp directory, runs it through the real CLI (`plainscript run`),
and requires:

- exit code 0
- the program printed its `ok` marker
- every in-program expectation held (`exit(1)` on any mismatch)

Rules for new fixtures:

1. Name the entry file after the directory (`<name>/<name>.pln`); it is
   auto-discovered, no registration needed.
2. Print a final `<name> ok` marker.
3. Guard every expectation with `if ... exit(1)`, never rely on output
   inspection.
4. Never write inside the repository; the runner stages the fixture in a
   temp directory for you.
