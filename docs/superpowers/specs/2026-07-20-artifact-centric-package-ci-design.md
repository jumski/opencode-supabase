# Artifact-Centric, Host-Realistic Package CI — Design

Issue: https://github.com/supabase-community/opencode-supabase/issues/73

**Goal:** Replace duplicated, mismatched package smoke checks with layered checks that exercise one exact packed artifact at each supported boundary.

**Non-goals (from issue):** no custom OpenCode runtime emulator, no Bubblewrap/Herdr in required CI, no release workflow redesign, no OAuth/Supabase contact in automated smoke, no dist/server build.

## Architecture

Three test layers:

1. **Source checks** — lint, typecheck, Bun tests run once on Linux (`build-package` job).
2. **Packed artifact contract** — one tarball created once per run; SHA-256 + `npm pack --json` inventory recorded; every package-facing job downloads and verifies that exact file.
3. **Host integration** — tarball installed through real OpenCode; `/supabase` rendered in real tmux TUI on Linux; server import + config registration on Windows. No raw `opencode-supabase/tui` import outside the OpenCode host.

## CI jobs (`.github/workflows/ci.yml`)

- `versions` — reads `.github/opencode-versions.json` (`{"floor","pinned"}`), exposes step outputs. Single source of truth for supported host versions; promotion = edit this file; future canary automation targets it.
- `build-package` (ubuntu) — frozen install → `npm pack --json` → metadata (filename, SHA-256, inventory) → `PACKAGE_TARBALL=<tgz> bun run lint|typecheck|test` (packed test reuses exact tarball) → upload artifact (`retention-days: 1`).
- `package-smoke` (windows, `needs: [build-package, versions]`) — download artifact, verify SHA-256, install pinned OpenCode, keep existing checks: `opencode plugin file:...`, `plugin_origins` registration, consumer `npm install`, raw `opencode-supabase/server` import. No pack/lint/typecheck/test/TUI import. No tmux on Windows (no native tmux/pty; MSYS2/WSL too fragile) — TUI render coverage is Linux-only.
- `tui-e2e` (linux, `needs: [build-package, versions]`) — dynamic matrix `[floor, pinned]` from `versions`; download artifact, verify SHA-256, run tmux harness with `PACKAGE_TARBALL`; upload evidence on failure.
- `core-required` (`name: core`, `needs: [build-package, package-smoke, tui-e2e]`, `if: always()`) — required aggregate. Check context stays `core` so branch protection (`["core", "changeset-check"]`) is unchanged; `core` now gates the full package boundary.
- `changeset-check` — unchanged.

## Canary (`.github/workflows/opencode-compatibility-canary.yml`)

Weekly cron + `workflow_dispatch`, never on PRs. Resolves `opencode-ai@latest` exact version (surfaced via `::notice`, step summary, evidence metadata), packs own tarball, runs same harness. Non-required; failure evidence always uploaded. Pin-promotion: canary green on new version → PR edits `opencode-versions.json` → required matrix passes → merge.

## Build rewriting (`scripts/build.ts`, `scripts/transform-solid.mjs`)

Replace PR #72's broad quoted-string regex with an import-aware Babel plugin (`scripts/host-runtime-rewrite.mjs`): rewrites only `ImportDeclaration` / `ExportNamedDeclaration` / `ExportAllDeclaration` / dynamic `import()` / `require()` specifiers that match the host-runtime specifier list. The `onResolve` externalizer stays as backstop for plain `.ts` files and preset-generated jsx-runtime imports. Unrelated string literals (e.g. `"solid-js"`) are never touched — covered by a regression test.

Two constraints discovered during implementation:

- OpenTUI's official `createRuntimePlugin` is unusable at build time — it inlines real runtime copies via `build.module()` (it is the host-side dev loader). Verified in `node_modules/@opentui/core/runtime-plugin.js`.
- `@opentui/core` entry points are Bun-only, but `transform-solid.mjs` runs under plain Node (spawned by `build.ts`). The encoder therefore lives in `host-runtime-rewrite.mjs` as a plain-JS one-liner; byte parity with `@opentui/core/runtime-plugin`'s `runtimeModuleIdForSpecifier` is asserted in `test/build-transform.test.ts`.

## Packed artifact test (`test/packed-tui-entrypoint.test.ts`)

- `PACKAGE_TARBALL` env: set → check that exact tarball (CI); unset → pack own (local).
- Removed: dialog-copy byte checks, braille spinner-frame checks, and the two spinner-dialog tests in `test/plugin-exports.test.ts` — the tmux render test owns visual behavior.
- All `spawnSync` time-bounded (`timeout: 60_000`).
- Guard regex widened to catch side-effect imports (`import "solid-js"`).
- Shared specifier list + encoder imported from build module / `@opentui/core` (no test-local reimplementation).
- Kept: exports map, stale-dist cleanup, encoded ids, optional-peer metadata, consumer-has-no-peers, consumer `tsc` without `skipLibCheck`.

## tmux harness (`scripts/test-opencode-tui-package.sh`)

- `wait_for <seconds> <desc> <cmd...>` deadline helper; polls predicate + `tmux has-session` each tick; fails fast with explicit dead-session/timeout reason.
- Readiness = visible pane predicate (`Ask anything`) only; private log text dropped.
- After typing `/supabase`, wait for the visible palette entry before sending Enter (floor 1.17.4 swallows early Enter); doubles as the command-registration assertion.
- Pack/install/launch bounded with `timeout`.
- Idempotent cleanup; evidence (pane, configs, versions, SHA-256, timestamps) captured to metadata before cleanup.
- `PACKAGE_TARBALL` seam kept; tarball SHA-256 printed/verified.

## Dependencies (`package.json`, `bun.lock`)

- Remove direct deps unused by source (`@opencode-ai/sdk`, `zod` — verified via `rg`).
- Pin exact versions from lockfile: `@opencode-ai/plugin@1.3.13`, `open@11.0.0`, `@types/bun@1.3.11`, `@types/node@25.5.2`.
- OpenTUI/Solid stay optional host-owned peers; never bundled.

## Weak spots & accepted trade-offs

- Readiness race after dropping log predicate — staged 15s/30s dialog polls absorb plugin-load lag; single `wait_for` knob if flaky.
- `opencode-ai@1.17.14` on Windows previously untested (smoke ran 1.4.3) — checks kept verbatim, CI validates; fallback = floor version.
- Packed-test Windows coverage moves from deleted `core` matrix leg to `package-smoke` consumer install — issue-accepted.
- Canary duplicates ~25 lines of YAML instead of a reusable workflow — shell script is the single source of truth; indirection rejected.
