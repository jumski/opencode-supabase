# Releasing opencode-supabase

Release runbook for maintainers.

This repo uses Changesets and a release PR workflow:

1. Feature PRs add `.changeset/*.md` for user-visible or package-relevant changes.
2. Merges to `main` trigger the release workflow.
3. `changesets/action` opens or updates a release PR.
4. Merging the release PR publishes to npm.

Current publish auth uses `NPM_TOKEN` for the initial rollout.
Target hardening is npm trusted publishing with GitHub OIDC.

This doc also acts as the transfer checklist for moving the repo to `supabase-community`.

## Current Release Model

- Package manager: Bun
- Registry: npm
- Versioning and changelog: Changesets
- Publish trigger: merge release PR on `main`
- Release workflow: `.github/workflows/release.yml`
- CI workflow: `.github/workflows/ci.yml`

## One-Time Setup

### npm

- Ensure the `opencode-supabase` package is owned by the intended npm maintainer or org.
- Create an npm automation token for publishing.
- Add the token to GitHub Actions secrets as `NPM_TOKEN`.

### GitHub

- Create label: `no-changeset`
- Protect `main`
- Require PR review before merge
- Require status checks before merge:
  - `core`
  - `changeset-check`
- Ensure GitHub Actions are enabled
- Ensure default branch is `main`

## Contributor Workflow

Add a changeset for user-visible or package-relevant changes:

```bash
bun run changeset
```

Commit the generated `.changeset/*.md` file with the code change.

Use the `no-changeset` label only for changes that should not affect package consumers, for example:

- docs-only updates
- CI-only updates
- internal refactors with no consumer impact
- test-only changes

## Maintainer Workflow

### Normal feature PR

1. Review code and changeset.
2. Merge the PR to `main`.

### Release PR

After merges with pending changesets, GitHub Actions will open or update a release PR.

Review the release PR for:

- expected version bump
- expected `CHANGELOG.md` contents
- no accidental package metadata changes

Merge the release PR to publish to npm.

Expected result:

- npm gets the new version
- git history includes the release commit
- `CHANGELOG.md` updates land in `main`

Note: `CHANGELOG.md` will appear on the first real release PR.

## Required Repo Files

These files must stay aligned:

- `package.json`
- `.changeset/config.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

Expected scripts in `package.json`:

```json
{
  "changeset": "changeset",
  "version-packages": "changeset version",
  "release": "changeset publish"
}
```

## Security Posture

Current choice: `NPM_TOKEN`

Why:

- fastest path to the first release
- simple to configure
- good enough for the initial rollout on protected `main`

Rules:

- use an npm automation token
- avoid a broad personal token if possible
- store it only as the GitHub Actions secret `NPM_TOKEN`
- do not expose publish secrets to PR workflows
- publish only from protected `main`
- keep the release PR merge as the approval gate

Future hardening:

- migrate to npm trusted publishing with GitHub OIDC
- optionally use a GitHub Environment approval for publish
- rotate credentials after repo transfer

## Failure Handling

### Release workflow fails because `NPM_TOKEN` is missing

- add or fix `NPM_TOKEN`
- rerun the failed workflow or push a follow-up commit if needed

### PR fails `changeset-check`

- add a real changeset with `bun run changeset`
- or apply `no-changeset` if the PR truly has no consumer-visible impact

### Bad release PR contents

- do not merge
- fix the source PR or a follow-up PR
- let Changesets regenerate the release PR

### Publish partially failed or version already exists

- inspect workflow logs
- confirm whether npm already has the version
- avoid trying to republish the same version blindly
- fix the root cause, then generate a new release version if needed

## Transfer Checklist: supabase-community

When the repo moves:

- transfer GitHub repository ownership
- verify GitHub Actions remain enabled
- verify the default branch is still `main`
- recreate or rotate `NPM_TOKEN`
- recreate the `no-changeset` label if missing
- reapply branch protection rules
- confirm npm package ownership includes the new maintainers or org
- verify workflow permissions still allow release PR creation and publish
- run one test release after transfer
- re-evaluate migration to trusted publishing after transfer

## First Release Checklist

- Changesets setup branch merged
- `NPM_TOKEN` configured
- `no-changeset` label exists
- branch protection configured
- real bugfix PR includes a real changeset
- bugfix PR merged to `main`
- release PR created automatically
- release PR reviewed
- release PR merged
- npm package version confirmed

## Quick Commands

Create changeset:

```bash
bun run changeset
```

Generate versions and changelog locally:

```bash
bun run version-packages
```

Publish locally if ever needed for debugging only:

```bash
bun run release
```
