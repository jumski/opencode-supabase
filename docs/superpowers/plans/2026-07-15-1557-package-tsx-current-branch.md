# Package TSX Current Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the original package TSX fix by proving the packed npm plugin installs and renders `/supabase` on the supported OpenCode boundary.

**Architecture:** Keep the compiled TUI entrypoint. Correct the smoke test to install the exact tarball through OpenCode's npm path, prevent private OpenTUI/Solid runtime copies, and test the oldest supported host plus the original regression host. Leave server and release architecture unchanged.

**Tech Stack:** Bun 1.3.11, npm, TypeScript, Solid, OpenTUI, OpenCode 1.17.4 and 1.17.14, Bash, tmux, GitHub Actions.

## Global Constraints

- Raise minimum OpenCode version from `1.3.4` to `1.17.4`.
- Install tarballs with npm-style `file:/absolute/path/package.tgz`; never `file://...tgz`.
- Publish compiled `dist/tui.js`; never raw TSX.
- If clean reproduction confirms renderer mismatch, treat `@opentui/core`, `@opentui/solid`, and `solid-js` as host-owned singleton runtimes.
- Keep `./server` pointing to `./src/server/index.ts` on this branch.
- Do not add shared compatibility runner, canary, server bundle, or release changes here.
- Run tests through package scripts; never raw `bun test`.
- Preserve existing untracked design and plan files.
- Do not commit unless user explicitly requests it during execution.

## File Structure

- `scripts/test-opencode-tui-package.sh`: exact-tarball installation and rendered-dialog smoke.
- `package.json`, `bun.lock`: host version and runtime dependency contract.
- `test/phase1-package-contract.test.ts`: metadata regression coverage.
- `test/packed-tui-entrypoint.test.ts`: packed consumer with explicit host runtime.
- `README.md`, `docs/development.md`: support and verification docs.
- `.changeset/clean-taxis-build.md`: consumer-facing fix summary.
- `.github/workflows/ci.yml`: minimum/regression host matrix.

---

### Task 1: Reproduce Through OpenCode's npm Installer

**Files:**
- Modify: `scripts/test-opencode-tui-package.sh`

**Interfaces:**
- Consumes: `OPENCODE_BIN`, optional artifact directory, isolated HOME/XDG paths.
- Produces: exact tarball, npm-style plugin spec, pane capture, and full OpenCode log.

- [ ] **Step 1: Reject stale fixture state**

Before `mkdir`, add:

```bash
if [[ -e "$ARTIFACT_DIR" ]]; then
  printf 'Artifact directory already exists: %s\n' "$ARTIFACT_DIR" >&2
  exit 1
fi
```

Create current fixture directories plus `npm-cache`.

- [ ] **Step 2: Use npm package semantics**

Delete manual adjacent tarball extraction. Create controlled npm config before packing and run `prepack` without caller npm settings:

```bash
: >"$ARTIFACT_DIR/npmrc"
PACK_JSON="$(env -i \
  PATH="$PATH" \
  HOME="$ARTIFACT_DIR/home" \
  NPM_CONFIG_USERCONFIG="$ARTIFACT_DIR/npmrc" \
  NPM_CONFIG_CACHE="$ARTIFACT_DIR/npm-cache" \
  NPM_CONFIG_IGNORE_SCRIPTS=false \
  npm pack --json --pack-destination "$ARTIFACT_DIR/package")"
TARBALL="$ARTIFACT_DIR/package/$(jq -r '.[0].filename' <<<"$PACK_JSON")"
SPEC="file:$TARBALL"
```

Pass `$SPEC` to `opencode plugin` and both config assertions. Expected saved config value: exact single-slash `file:` spec.

- [ ] **Step 3: Complete environment isolation**

Add these values to both `clean_env` and generated `launch.sh`:

```bash
USER=opencode-test
LOGNAME=opencode-test
NPM_CONFIG_USERCONFIG="$ARTIFACT_DIR/npmrc"
NPM_CONFIG_CACHE="$ARTIFACT_DIR/npm-cache"
```

Before install, assert:

```bash
[[ ! -e "$ARTIFACT_DIR/home/.opencode" ]]
```

- [ ] **Step 4: Print server logs on failure**

In `diagnostics()`, print `$ARTIFACT_DIR/data/opencode/log/opencode.log` after `tui.stderr`. Keep full fixture upload.

- [ ] **Step 5: Verify syntax and reproduce**

Run:

```bash
bash -n scripts/test-opencode-tui-package.sh
TOOL_DIR="$(mktemp -d)"
RUN_ROOT="$(mktemp -d)"
~/.local/bin/mise install-into npm:opencode-ai@1.17.14 "$TOOL_DIR"
OPENCODE_BIN="$TOOL_DIR/bin/opencode" scripts/test-opencode-tui-package.sh "$RUN_ROOT/opencode-1.17.14"
```

Expected before Task 2: install uses OpenCode package cache, then `/supabase` fails with `No renderer found`. If failure differs, stop and inspect retained logs before changing dependencies.

Task 2 is gated by this exact reproduction. If clean npm installation already renders the dialog, do not move runtime dependencies on this branch; retain evidence and continue with minimum-version/docs/CI corrections only.

### Task 2: Remove Private Host Runtime Copies

**Files:**
- Modify: `test/phase1-package-contract.test.ts`
- Modify: `test/packed-tui-entrypoint.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: OpenCode runtime canonicalization of bare OpenTUI/Solid imports.
- Produces: optional host peers plus exact development runtimes.

- [ ] **Step 1: Add failing metadata assertions**

Add:

```ts
test("keeps TUI runtimes host-owned", () => {
  expect(packageJson.engines.opencode).toBe(">=1.17.4");
  for (const name of ["@opentui/core", "@opentui/solid", "solid-js"]) {
    expect(packageJson.dependencies?.[name]).toBeUndefined();
    expect(packageJson.peerDependenciesMeta[name]).toEqual({ optional: true });
    expect(packageJson.devDependencies[name]).toBeDefined();
  }
});
```

- [ ] **Step 2: Confirm test fails**

Run:

```bash
bun run test test/phase1-package-contract.test.ts
```

Expected: FAIL on missing host metadata and regular runtime dependencies.

- [ ] **Step 3: Change `package.json` boundary**

Add:

```json
"engines": { "opencode": ">=1.17.4" },
"peerDependencies": {
  "@opentui/core": "^0.3.4 || ^0.4.3",
  "@opentui/solid": "^0.3.4 || ^0.4.3",
  "solid-js": "^1.9.12"
},
"peerDependenciesMeta": {
  "@opentui/core": { "optional": true },
  "@opentui/solid": { "optional": true },
  "solid-js": { "optional": true }
}
```

Remove those packages from `dependencies`. Add exact development copies:

```json
"@opentui/core": "0.3.4",
"@opentui/solid": "0.3.4",
"solid-js": "1.9.12"
```

Leave unrelated `latest` cleanup for follow-up.

- [ ] **Step 4: Give direct consumer a host runtime**

Extend `npm install` in `test/packed-tui-entrypoint.test.ts` with:

```ts
"@opentui/core@0.3.4",
"@opentui/solid@0.3.4",
"solid-js@1.9.12",
```

- [ ] **Step 5: Refresh lock and run focused tests**

Run:

```bash
bun install
bun run test test/phase1-package-contract.test.ts test/packed-tui-entrypoint.test.ts
```

Expected: both test files pass; lockfile changes only reflect dependency-category changes.

- [ ] **Step 6: Re-run OpenCode 1.17.14 smoke**

Repeat Task 1 with a fresh artifact directory.

Expected: `/supabase` renders authorization dialog. Logs contain neither `No renderer found` nor missing Supabase auth hook.

### Task 3: Document Supported Contract

**Files:**
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `.changeset/clean-taxis-build.md`

**Interfaces:**
- Consumes: working package contract from Tasks 1-2.
- Produces: accurate user and contributor guidance.

- [ ] **Step 1: Raise README minimum**

Use:

```text
Requires OpenCode `>= 1.17.4`.
```

- [ ] **Step 2: Correct development docs**

Document:

```text
TUI source: `src/tui/index.tsx`.
Published TUI export: `dist/tui.js`, generated by `bun run build` and `prepack`.
```

Add `bash -n scripts/test-opencode-tui-package.sh` as focused syntax verification. State that real smoke requires tmux and `OPENCODE_BIN`.

- [ ] **Step 3: Update changeset**

Use:

```markdown
Ship the TUI entrypoint as compiled JavaScript and keep OpenTUI/Solid runtimes host-owned so npm-installed plugins render correctly. OpenCode 1.17.4 or newer is now required.
```

- [ ] **Step 4: Verify docs contract**

Run:

```bash
bun run test test/phase1-package-contract.test.ts
```

Expected: PASS.

### Task 4: Test Minimum and Regression Hosts in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: smoke script and pinned OpenCode versions.
- Produces: Linux smoke cells for minimum and original regression hosts.

- [ ] **Step 1: Add two-version matrix**

First align the existing cross-platform package smoke with the new support floor:

```yaml
- name: Install OpenCode
  run: npm i -g opencode-ai@1.17.4
```

Change its Ubuntu tarball spec to:

```bash
SPEC="file:$(pwd)/$TARBALL"
```

Change its Windows spec to:

```powershell
$spec = "file:$resolved"
```

When the direct consumer imports the optional-peer TUI, install its explicit host runtime too:

```text
@opentui/core@0.3.4 @opentui/solid@0.3.4 solid-js@1.9.12
```

- [ ] **Step 2: Add two-version TUI matrix**

Use:

```yaml
strategy:
  fail-fast: false
  matrix:
    opencode-version: [1.17.4, 1.17.14]
```

Set job name to `OpenCode ${{ matrix.opencode-version }} packed TUI`.

- [ ] **Step 3: Install matrix version**

Use:

```yaml
npm install -g opencode-ai@${{ matrix.opencode-version }}
```

- [ ] **Step 4: Separate artifacts by version**

Use versioned fixture paths and artifact names. Add `include-hidden-files: true` so `.opencode` configs are retained.

- [ ] **Step 5: Run lint**

Run:

```bash
bun run lint
```

Expected: PASS.

### Task 5: Verify Current Branch

**Files:**
- Verify: all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: complete focused fix.
- Produces: release-ready branch without follow-up architecture.

- [ ] **Step 1: Run focused checks**

```bash
bash -n scripts/test-opencode-tui-package.sh
bun run test test/phase1-package-contract.test.ts test/packed-tui-entrypoint.test.ts
```

- [ ] **Step 2: Mirror CI**

```bash
bun run lint
bun run typecheck
bun run test
bun run verify:pack
```

Expected: all pass; pack inventory includes `dist/tui.js` and `dist/tui.d.ts`.

- [ ] **Step 3: Run host smoke twice**

Run smoke with OpenCode 1.17.4 and 1.17.14, using distinct fresh artifact directories.

Expected: both render authorization dialog and remain alive.

- [ ] **Step 4: Inspect scope**

```bash
git status --short
git diff --check
git diff --stat
git diff
```

Expected: no server bundle, canary, shared runner, or release workflow changes.
