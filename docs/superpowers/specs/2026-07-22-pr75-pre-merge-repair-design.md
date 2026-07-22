# PR 75 Pre-Merge Repair — Design

Context: PR #75 (artifact-centric package CI) implements issue #73 and passed review with no blockers. This repair addresses the five approved findings before merge. No architecture or workflow behavior changes.

## 1. Harness signal exits (`scripts/test-opencode-tui-package.sh`)

Current: `trap diagnostics EXIT INT TERM` (line 56). On INT/TERM bash runs `diagnostics` then resumes the interrupted `wait_for` loop; cleanup runs twice (idempotent) and the exit code is wrong.

Change:

- Keep `trap diagnostics EXIT`.
- Add `trap 'exit 130' INT` and `trap 'exit 143' TERM` — the EXIT trap runs `diagnostics` once with the conventional signal exit code.

Result: single diagnostics pass, no resumed polling against a killed tmux server, correct exit status.

## 2. Surface failure reason in job log

Current: `wait_for` appends `timeout (<s>s): <desc>` / `dead session: <desc>` to `failure-reason.txt`, but the failed-run stderr dump (lines 43-50) omits it; the reason is only visible after downloading the uploaded artifact.

Change: add `failure-reason.txt` to the diagnostics stderr dump list.

Result: CI job log directly names the timeout/dead-session cause — the key evidence issue #73 asked for.

## 3. Design spec accuracy (`docs/superpowers/specs/2026-07-20-artifact-centric-package-ci-design.md`)

Fix three stale statements to match the merged implementation:

- Canary section: describe the scheduled frontier matrix (last 2 stable minors × latest 2 patches) plus manual `workflow_dispatch` single-version/dist-tag flow; not a single `@latest` run.
- `build-package` bullet: artifact `retention-days: 3` (ci.yml), not 1.
- `build-package` bullet: only the packed test receives `PACKAGE_TARBALL`; lint/typecheck do not need it (current wording implies all three get it).

## 4. Windows smoke artifact identity print (`.github/workflows/ci.yml`)

Current: `package-smoke` verifies SHA-256 and throws on mismatch, but never prints the verified identity on success.

Change: after the hash comparison, `Write-Host` the metadata filename and verified SHA-256.

Result: "prints/verifies SHA-256" acceptance wording satisfied on the Windows boundary too; audit trail closed.

## 5. Build typing hygiene (`scripts/build.ts`)

Current: `build.ts:3` has `// @ts-expect-error plain-JS module without declarations; scripts/ is not typechecked`, but `scripts/host-runtime-rewrite.d.mts` declarations exist and are needed by typechecked tests (`test/packed-tui-entrypoint.test.ts:8`). The suppression comment is stale and false.

Change: keep `.d.mts`; remove the `@ts-expect-error` comment from `build.ts` (the file is excluded from tsconfig `include`, so no directive is needed at all).

## Explicitly out of scope

- `verify:pack` script + AGENTS.md mention: intentionally local-only verification; not a defect.
- `spawnSync` grandchild orphaning: requirement is bounded child invocations; tests fail within 60s; no leak evidence.
- Canary frontier matrix and `core` aggregate name: intentional, correct deviations from issue #73.

## Verification

- `bash -n scripts/test-opencode-tui-package.sh`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run verify:pack`
- CI on push validates the Windows print and full host matrix.
