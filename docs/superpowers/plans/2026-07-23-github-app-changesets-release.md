# GitHub App Changesets Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace expired personal Changesets PAT with an organization-owned GitHub App token that creates release PRs whose CI runs.

**Architecture:** Mint an installation token once at start of release job with `actions/create-github-app-token@v2`. Pass same token to checkout and `changesets/action`, while retaining `id-token: write` for npm trusted publishing. Document app setup and remove all PAT instructions.

**Tech Stack:** GitHub Actions, Changesets, Bun test.

## Global Constraints

- Use existing secrets `CHANGESETS_APP_ID` and `CHANGESETS_APP_PRIVATE_KEY`; never print either value.
- Use `actions/create-github-app-token@v2` with repository owner and current repository name.
- Preserve npm trusted publishing via existing `id-token: write` permission.
- Do not alter release commands, Bun/Node versions, or release trigger.
- Replace every reference to previous Changesets PAT secret in documentation with GitHub App guidance.
- Verify with project scripts, not raw `bun test`.

---

### Task 1: Mint and Use Changesets App Token

**Files:**
- Create: `test/release-workflow.test.ts`
- Modify: `.github/workflows/release.yml:20-54`
- Modify: `docs/releasing.md:67-90,254-258,273-289,329-336`

**Interfaces:**
- Consumes: repository secrets `CHANGESETS_APP_ID`, `CHANGESETS_APP_PRIVATE_KEY`.
- Produces: `steps.app-token.outputs.token`, passed to checkout and `changesets/action` as `GITHUB_TOKEN`.

- [ ] **Step 1: Write failing workflow contract test**

```ts
import { expect, test } from "bun:test";

const workflow = await Bun.file(
  new URL("../.github/workflows/release.yml", import.meta.url),
).text();

test("release workflow mints a GitHub App token", () => {
  expect(workflow).toContain("uses: actions/create-github-app-token@v2");
  expect(workflow).toContain("id: app-token");
});

test("release workflow uses its app token for repository writes", () => {
  expect(workflow).toContain("token: ${{ steps.app-token.outputs.token }}");
  expect(workflow).toContain("GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}");
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `bun run test test/release-workflow.test.ts`

Expected: FAIL because `release.yml` still uses previous Changesets PAT secret and has no `app-token` step.

- [ ] **Step 3: Mint token and replace all PAT use**

Add token step before checkout:

```yaml
      - name: Mint Changesets App token
        id: app-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.CHANGESETS_APP_ID }}
          private-key: ${{ secrets.CHANGESETS_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: ${{ github.event.repository.name }}
```

Set checkout `token` and `changesets/action` `GITHUB_TOKEN` to `${{ steps.app-token.outputs.token }}`. Replace old secret verification with a check for both app secrets and an error pointing to `docs/releasing.md > One-Time Setup > GitHub`.

- [ ] **Step 4: Replace PAT documentation**

Document GitHub App setup: no webhook, install only on this repository, Contents and Pull requests Read & write, and secrets `CHANGESETS_APP_ID` / `CHANGESETS_APP_PRIVATE_KEY`. Explain why app token allows CI to run on its release PR. Update troubleshooting, transfer checklist, and first-release checklist to use app secret names.

- [ ] **Step 5: Verify focused test and repository checks**

Run:

```bash
bun run test test/release-workflow.test.ts
bun run lint
bun run typecheck
bun run test
bun run verify:pack
```

Expected: every command exits 0. The workflow contract test confirms minting and both write paths use `steps.app-token.outputs.token`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml docs/releasing.md test/release-workflow.test.ts docs/superpowers/plans/2026-07-23-github-app-changesets-release.md
git commit -m "ci: use GitHub App token for changesets"
```
