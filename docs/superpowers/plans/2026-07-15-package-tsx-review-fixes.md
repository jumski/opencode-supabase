# Package TSX Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make package regression tests execute compiled TUI JSX and launch child processes safely on Windows.

**Architecture:** Keep process spawning shell-free and resolve Windows command wrappers explicitly at each call site. Extend the existing tmux smoke test to select `/supabase` and recognize only dialog-specific content.

**Tech Stack:** Bun test, Node `spawnSync`, Bash, tmux, OpenCode 1.17.14.

## Global Constraints

- Invoke Bun through `process.execPath` directly on every platform.
- Use `.cmd` wrappers only for `npm` and `tsc` on Windows.
- The TUI success condition must come from the rendered dialog, not command suggestions.
- Do not commit unless the user explicitly requests a commit.

---

### Task 1: Shell-free package test commands

**Files:**
- Modify: `test/packed-tui-entrypoint.test.ts:12-53`
- Test: `test/packed-tui-entrypoint.test.ts`

**Interfaces:**
- Consumes: `process.platform`, `process.execPath`, and `spawnSync(executable, args, options)`.
- Produces: `command(name: "npm" | "tsc"): string`, returning a directly spawnable executable name/path.

- [ ] **Step 1: Preserve the regression expectation**

Keep the inline Bun import command unchanged so shell reparsing would remain observable:

```ts
run([process.execPath, "-e", 'console.log((await import("opencode-supabase/tui")).default.id)'], consumer);
```

- [ ] **Step 2: Implement explicit wrapper resolution**

Add:

```ts
function command(name: "npm" | "tsc") {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return name === "npm" ? `npm${suffix}` : join(consumer, `node_modules/.bin/tsc${suffix}`);
}
```

Place the resolver where `consumer` is available, replace `npm` and `tsc` call sites with resolved executables, and remove `shell: process.platform === "win32"` from `spawnSync` options.

- [ ] **Step 3: Run the focused package test**

Run: `bun run test test/packed-tui-entrypoint.test.ts`

Expected: one passing packed-entrypoint test; Bun inline import prints `supabase` internally.

### Task 2: Execute the packaged TUI command

**Files:**
- Modify: `scripts/test-opencode-tui-package.sh:86-100`

**Interfaces:**
- Consumes: tmux session containing the OpenCode TUI and registered `/supabase` command.
- Produces: smoke-test success only after the authorization dialog renders.

- [ ] **Step 1: Select the command**

After typing `/supabase`, send Enter:

```bash
tmux -S "$SOCKET" send-keys -t "$SESSION" Enter
```

- [ ] **Step 2: Assert dialog-specific content**

Replace the command-title check with:

```bash
if grep -q 'Open your browser to authorize OpenCode to access your Supabase account.' "$ARTIFACT_DIR/pane.txt"; then
```

Update success output to state that the `/supabase` dialog rendered.

- [ ] **Step 3: Validate shell syntax**

Run: `bash -n scripts/test-opencode-tui-package.sh`

Expected: exit code 0 and no output.

### Task 3: Repository verification

**Files:**
- Verify: all changed files

**Interfaces:**
- Consumes: completed Tasks 1-2.
- Produces: linted, typechecked, tested, packable branch.

- [ ] **Step 1: Run lint and typecheck**

Run: `bun run lint && bun run typecheck`

Expected: both commands exit 0.

- [ ] **Step 2: Run full tests and package verification**

Run: `bun run test && bun run verify:pack`

Expected: all tests pass and npm dry-run package succeeds.

- [ ] **Step 3: Inspect final state**

Run: `git status --short && git diff --check && git diff --stat && git diff`

Expected: only intended test/script changes and design/plan records; no whitespace errors.
