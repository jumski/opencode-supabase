# OpenCode Package Compatibility Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic package builds, one reusable local/CI verifier, pinned compatibility coverage, and early warning for new OpenCode releases.

**Architecture:** Build complete server and TUI JavaScript artifacts while externalizing only host-owned TUI runtimes. Drive every package check through one exact tarball and one shared verifier. Keep pull-request checks pinned; run floating OpenCode versions only on schedule.

**Tech Stack:** Bun, TypeScript, npm tarballs, OpenCode CLI/server/TUI, tmux, Herdr, GitHub Actions.

## Global Constraints

- Start in a new Worktrunk worktree after current TSX branch merges.
- Keep OpenCode `>=1.17.4` floor unless shipped evidence requires later version.
- Use npm-style `file:/absolute/path/package.tgz` for exact local artifacts.
- Build once per run and reuse same tarball across host cells.
- Externalize only host TUI singleton runtimes from TUI bundle.
- Required PR checks use exact OpenCode versions; floating checks never block PRs.
- Never inherit credentials, global OpenCode config, project plugins, npm config, or caches.
- Automated smoke must not contact Supabase, launch browser, or complete OAuth.
- Run tests through package scripts; never raw `bun test`.
- Do not commit unless user explicitly requests it during execution.

## File Structure

- `scripts/build.ts`: deterministic server and TUI builds.
- `package.json`, `bun.lock`: compiled exports and exact build dependencies.
- `test/phase1-package-contract.test.ts`: package boundary assertions.
- `.changeset/calm-plugins-build.md`: consumer-facing build and compatibility note.
- `scripts/packed-plugin-fixture.ts`: pack, isolate, provision, install, and evidence helpers.
- `scripts/test-packed-plugin.ts`: local/CI command runner.
- `test/packed-plugin-fixture.test.ts`: runner unit tests.
- `.github/workflows/ci.yml`: required pinned compatibility matrix.
- `.github/workflows/opencode-compatibility-canary.yml`: scheduled floating-version warning.
- `docs/development.md`, `docs/releasing.md`: local commands and compatibility policy.

---

### Task 1: Build Deterministic Server and TUI Artifacts

**Files:**
- Modify: `test/phase1-package-contract.test.ts`
- Modify: `scripts/build.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: `src/server/index.ts`, `src/tui/index.tsx`, Solid transform.
- Produces: `dist/server/index.js`, `dist/server/index.d.ts`, `dist/tui.js`, `dist/tui.d.ts`.

If current-branch clean reproduction did not require optional host peers, establish that optional-peer boundary in this task before removing ordinary runtime dependencies.

- [ ] **Step 1: Add failing export assertions**

Require:

```ts
expect(packageJson.exports["./server"]).toBe("./dist/server/index.js");
expect(packageJson.exports["./tui"]).toBe("./dist/tui.js");
expect(packageJson.dependencies).toEqual({ "@opencode-ai/plugin": "1.3.13" });
```

- [ ] **Step 2: Confirm failure**

```bash
bun run test test/phase1-package-contract.test.ts
```

Expected: FAIL because server still exports source and runtime dependencies remain.

- [ ] **Step 3: Clean output and add reusable build helper**

In `scripts/build.ts`, remove stale output before building:

```ts
import { mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
```

Then add:

```ts
async function build(options: Bun.BuildConfig) {
  const result = await Bun.build(options);
  if (!result.success) {
    console.error(...result.logs);
    process.exit(1);
  }
}
```

Build server at a path preserving `../../skills`:

```ts
await build({
  entrypoints: ["src/server/index.ts"],
  outdir: "dist/server",
  naming: "index.js",
  target: "bun",
});
```

Build TUI selectively:

```ts
await build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist",
  naming: "tui.js",
  target: "bun",
  external: ["@opentui/core", "@opentui/solid", "solid-js", "solid-js/store"],
  plugins: [solid],
});
```

- [ ] **Step 4: Emit server declaration**

Add:

```ts
await Bun.write(
  "dist/server/index.d.ts",
  'import type { Plugin } from "@opencode-ai/plugin";\ndeclare const plugin: { id: string; server: Plugin };\nexport default plugin;\n',
);
```

- [ ] **Step 5: Freeze build dependencies**

Point `./server` at built JS. Remove unused direct `@opencode-ai/sdk` and `zod`. Keep `@opencode-ai/plugin` as exact regular dependency because declarations import its types. Move other bundled inputs to exact dev dependencies based on current lock:

```json
"open": "11.0.0",
"@types/bun": "1.3.11",
"@types/node": "25.5.2",
"typescript": "5.9.3"
```

Before removal, verify no source directly imports SDK or zod:

```bash
rg '@opencode-ai/sdk|from "zod"' src
```

Expected: no matches.

Keep OpenTUI/Solid optional peers. Set only this regular dependency:

```json
"dependencies": {
  "@opencode-ai/plugin": "1.3.13"
}
```

This preserves standalone declaration resolution. `@opencode-ai/plugin` already declares OpenTUI as optional peers, so it does not install private renderer copies.

- [ ] **Step 6: Add changeset**

Create `.changeset/calm-plugins-build.md`:

```markdown
---
"opencode-supabase": patch
---

Ship deterministic compiled server and TUI artifacts and verify package compatibility across supported OpenCode versions.
```

- [ ] **Step 7: Build and verify**

```bash
bun install
bun run build
bun run test test/phase1-package-contract.test.ts test/server-skills.test.ts
bun run verify:pack
```

Expected: compiled exports present, skills still resolve, and tarball declares only pinned `@opencode-ai/plugin` plus optional host-runtime peers.

### Task 2: Create One Packed-Plugin Verifier

**Files:**
- Create: `scripts/packed-plugin-fixture.ts`
- Create: `scripts/test-packed-plugin.ts`
- Create: `test/packed-plugin-fixture.test.ts`
- Modify: `package.json`
- Retire after parity: `scripts/test-opencode-tui-package.sh`

**Interfaces:**
- Produces: `npmFileSpec`, `packPlugin`, `createCell`, `runInstall`, `runServerSmoke`, `runTuiSmoke`.
- CLI accepts repeated `--opencode`, `--mode`, `--opencode-bin`, `--tarball`, `--artifact-dir`, `--keep`, and `--interactive`.

- [ ] **Step 1: Test spec and fixture helpers first**

Add tests:

```ts
expect(npmFileSpec("/tmp/plugin.tgz")).toBe("file:/tmp/plugin.tgz");
await expect(createCell(runRootWithExistingVersionCell, "1.17.14")).rejects.toThrow();
const packed = await packPlugin(root, artifactDirectory);
expect(packed.sha256).toMatch(/^[a-f0-9]{64}$/);
```

Run:

```bash
bun run test test/packed-plugin-fixture.test.ts
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 2: Implement deterministic primitives**

Use this public shape:

```ts
export type KeepPolicy = "always" | "failure" | "never";
export type SmokeMode = "install" | "entrypoint" | "server" | "tui" | "all";

export interface OpenCodeCell {
  version: string;
  root: string;
  home: string;
  work: string;
  cache: string;
  binary: string;
}

export function npmFileSpec(tarball: string): string;
export async function packPlugin(root: string, artifactDir: string): Promise<{ tarball: string; sha256: string }>;
export async function createCell(runRoot: string, version: string): Promise<OpenCodeCell>;
export async function runInstall(cell: OpenCodeCell, tarball: string): Promise<void>;
export async function runEntrypointSmoke(cell: OpenCodeCell): Promise<void>;
export async function runServerSmoke(cell: OpenCodeCell): Promise<void>;
export async function runTuiSmoke(cell: OpenCodeCell): Promise<void>;
```

Implement spec construction as:

```ts
import { resolve } from "node:path";

export function npmFileSpec(tarball: string) {
  return `file:${resolve(tarball).replaceAll("\\", "/")}`;
}
```

- [ ] **Step 3: Enforce clean environment**

Each cell gets empty HOME, TMPDIR, all XDG roots, npm config/cache, work directory, and OpenCode cache. `createCell()` rejects only an existing non-empty version-derived cell directory such as `runRoot/cells/1.17.14`; shared artifact directory may already contain canonical tarball. Child environment uses explicit allowlist only. Record effective paths in `run.json`.

- [ ] **Step 4: Implement acceptance predicates**

Install smoke:

- exact spec appears once in both OpenCode configs;
- installed package is below isolated OpenCode cache;
- installed name/version match tarball manifest;
- no plugin-load error exists.

Server smoke:

- start `opencode serve` on loopback/dynamic port;
- poll readiness, never fixed sleep;
- assert Supabase tool IDs or disconnected auth status;
- assert process remains alive.

Entrypoint smoke imports both package exports from installed cache and asserts `default.id === "supabase"`. This mode runs on Linux and Windows.

TUI smoke:

- fixed tmux size `120x40` and `TERM=xterm-256color`;
- wait for visible readiness;
- send `/supabase` and Enter;
- assert authorization dialog and live process;
- repeat with warm cache.

- [ ] **Step 5: Add CLI scripts**

Add:

```json
"verify:package": "bun scripts/test-packed-plugin.ts --mode all",
"debug:package": "bun scripts/test-packed-plugin.ts --mode tui --interactive --keep always"
```

- [ ] **Step 6: Prove parity before retiring Bash**

Run old and new smoke against same OpenCode version and compare predicates/artifacts. Delete old script only after new runner proves install, server, TUI, and diagnostics parity.

### Task 3: Add Local Automated and Interactive Workflows

**Files:**
- Modify: `docs/development.md`
- Modify: `scripts/test-packed-plugin.ts`

**Interfaces:**
- Consumes: shared verifier.
- Produces: reproducible local matrix and retained Herdr session.

- [ ] **Step 1: Document exact local matrix**

```bash
bun run verify:package -- \
  --opencode 1.17.4 \
  --opencode 1.17.14 \
  --opencode 1.18.1
```

- [ ] **Step 2: Document retained artifact replay**

```bash
bun run verify:package -- \
  --tarball /absolute/path/opencode-supabase-0.5.0.tgz \
  --opencode 1.17.14 \
  --keep always
```

- [ ] **Step 3: Add Herdr mode**

```bash
bun run debug:package -- --opencode 1.17.14
```

Interactive mode creates a fresh Herdr tab, launches exact cell environment, prints artifact path, and closes tab in `finally`. It never uses active pane.

- [ ] **Step 4: Verify docs commands**

Run automated 1.17.14 smoke and one Herdr session. Expected: same tarball hash, config, and logs in both modes.

### Task 4: Add Required Pinned CI Matrix

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/releasing.md`

**Interfaces:**
- Consumes: one canonical tarball and shared verifier.
- Produces: required minimum, regression, and current-host checks.

- [ ] **Step 1: Pack once**

Add `package-once` job. It runs frozen install, `npm pack --json`, computes SHA-256, stores pack inventory/tool versions, and uploads one artifact.

- [ ] **Step 2: Consume same artifact in pinned cells**

Linux required matrix:

```yaml
opencode-version: [1.17.4, 1.17.14, 1.18.1]
```

Each Linux cell downloads tarball, verifies SHA-256, passes it with `--tarball`, then runs install, server, cold TUI, and warm TUI modes. Windows runs `--mode entrypoint` followed by server smoke for `1.18.1`.

- [ ] **Step 3: Add aggregate required check**

Add `package-compat-required` with `if: always()`. Fail unless package, Linux matrix, and Windows smoke all succeeded. Document this check beside `core` and `changeset-check` in `docs/releasing.md`.

After check exists on default branch, require these status contexts:

```json
["core", "changeset-check", "package-compat-required"]
```

Applying branch protection requires explicit user authorization during execution. After authorization and update, verify:

```bash
gh api repos/supabase-community/opencode-supabase/branches/main/protection
```

Expected: `required_status_checks.contexts` contains all three names.

- [ ] **Step 4: Upload diagnostics**

On failure upload tarball metadata, configs, dependency tree, install output, server output, OpenCode logs, pane captures, and version report. Include hidden files.

- [ ] **Step 5: Verify workflow**

```bash
bun run lint
bun run verify:package -- --opencode 1.17.4 --opencode 1.17.14 --opencode 1.18.1
```

Expected: lint and all pinned cells pass.

### Task 5: Add Scheduled Compatibility Canary

**Files:**
- Create: `.github/workflows/opencode-compatibility-canary.yml`
- Modify: `docs/releasing.md`

**Interfaces:**
- Consumes: shared verifier and floating OpenCode registry tags.
- Produces: non-PR early warning with full evidence.

- [ ] **Step 1: Add schedule and manual trigger**

```yaml
on:
  schedule:
    - cron: "17 6 * * 1"
  workflow_dispatch:
```

- [ ] **Step 2: Run stable floating release**

Resolve `opencode-ai@latest`, record exact version, and run full Linux package smoke. Do not add this workflow to `pull_request`.

- [ ] **Step 3: Preserve failure evidence**

Always upload version report and logs. Let incompatibility fail scheduled run so GitHub notifications alert maintainers.

- [ ] **Step 4: Document pin-advance policy**

State:

1. Canary detects new stable release.
2. Maintainer opens PR updating committed current pin.
3. Required pinned matrix must pass.
4. Merge advances supported current version.

Prerelease tags remain manual until registry naming stabilizes.

### Task 6: Final Verification

**Files:**
- Verify: all follow-up files.

**Interfaces:**
- Consumes: deterministic builds, shared runner, pinned CI, and canary.
- Produces: maintainable compatibility system usable locally and in CI.

- [ ] **Step 1: Run repository checks**

```bash
bun run lint
bun run typecheck
bun run test
bun run verify:pack
```

- [ ] **Step 2: Run package matrix**

```bash
bun run verify:package -- --opencode 1.17.4 --opencode 1.17.14 --opencode 1.18.1 --keep failure
```

- [ ] **Step 3: Inspect deterministic artifact**

Confirm all cells report same tarball SHA-256, built exports, isolated config origins, and no private OpenTUI/Solid runtime copy.

- [ ] **Step 4: Inspect final diff**

```bash
git status --short
git diff --check
git diff --stat
git diff
```

Expected: package determinism, reusable verification, pinned CI matrix, local docs, and scheduled canary only. No auth, MCP, or user-facing behavior changes.
