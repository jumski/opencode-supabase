# Package TSX Review Fixes Design

## Goal

Fix two review findings in the package and OpenCode TUI regression tests:

1. Ensure the TUI smoke test executes the `/supabase` command and renders the
   compiled JSX dialog, rather than only checking command-palette suggestions.
2. Keep the isolated package test shell-free on Windows so Bun's inline
   `-e` program is not reparsed by `cmd.exe`.

## Design

### TUI smoke test

After typing `/supabase`, send Enter to select the command. Assert stable text
from the resulting dialog, specifically the authorization prompt. This proves
the command callback ran and the packaged Solid JSX entrypoint loaded far
enough to render the dialog. The command-palette title is no longer used as the
success condition.

### Cross-platform package test process launching

Change the test helper to call `spawnSync` with `shell: false` (the default).
Resolve platform command wrappers explicitly: use `npm.cmd` and `tsc.cmd` on
Windows, and `npm` and `tsc` elsewhere. Invoke Bun through `process.execPath`
directly on every platform, preserving the inline JavaScript without shell
quoting.

## Verification

- Run the focused packed-entrypoint test through the repository package script.
- Run lint, typecheck, the full test suite, and package verification.
- Inspect the final diff for only the intended test and smoke-script changes
  (plus this design record).
