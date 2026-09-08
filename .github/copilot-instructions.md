# GitHub Copilot Instructions for PlainScript (.pln)

When writing or suggesting PlainScript (.pln) files:

1. **No `=` Operator**:
   - Variables: `remember <name> as <value>` (immutable) or `let <name> is <value>` (mutable)
   - Reassignment: `<name> becomes <value>`
   - Comparison: `if <a > is <b >` or `if <a > equals <b >`

2. **Block Structure**:
   - Functions start with `make <name>(<args>)` and end with `done`.
   - Return keyword is `give <value>`.
   - Conditionals: `if ... otherwise if ... otherwise ... done`.
   - Loops: `for each <item> in <list> ... done` or `while <condition> ... done`.

3. **Printing**:
   - Use `show <expr>` instead of `print` or `console.log`.

4. **Web Servers**:
   - `web app`
   - `route get "/path" ... reply "hello" done`
   - `start 3000`

5. **Self-Healing**:
   - You can run `plainscript fix <file.pln>` to auto-heal syntax mistakes.
