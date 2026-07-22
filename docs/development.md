# Development

Contributor notes for working on `opencode-supabase`.

## Setup

Use Bun commands through package scripts.

```bash
bun install
```

## Verify

Mirror CI before opening a PR:

```bash
bun run lint
bun run typecheck
bun run test
bun run verify:pack
```

For focused tests, use the package script:

```bash
bun run test test/phase1-package-contract.test.ts
```

Do not run raw `bun test` for repository verification. The package script loads required TUI preloads.

## Package Verification

CI builds one npm tarball per run (`build-package` job) and every package-facing job verifies that exact file by SHA-256. The packed-artifact test suite checks the same tarball when `PACKAGE_TARBALL` is set:

```bash
npm pack --json                    # builds dist/ via prepack
PACKAGE_TARBALL="$(pwd)/opencode-supabase-<version>.tgz" bun run test test/packed-tui-entrypoint.test.ts
```

Without `PACKAGE_TARBALL` the suite packs its own tarball, so plain `bun run test` stays self-contained.

To exercise the packed TUI inside a real OpenCode host locally (requires tmux, jq, and GNU coreutils `timeout`):

```bash
# install a pinned OpenCode somewhere isolated
mkdir -p /tmp/oc && cd /tmp/oc && npm install --no-save opencode-ai@1.17.14 && cd -

OPENCODE_BIN=/tmp/oc/node_modules/.bin/opencode \
PACKAGE_TARBALL="$(pwd)/opencode-supabase-<version>.tgz" \
scripts/test-opencode-tui-package.sh
```

Without `PACKAGE_TARBALL` the harness packs the repo itself. Evidence (pane capture, plugin metadata, tool versions, tarball SHA-256) is retained in the artifact dir it prints.

## Plugin Surface

Server export: `src/server/index.ts`.

TUI export: `src/tui/index.tsx`.

Current server tools:

- `supabase_list_organizations`
- `supabase_list_projects`
- `supabase_list_regions`
- `supabase_create_project`
- `supabase_open_mcp_setup`
- `supabase_login`

## Bundled Skill Sync

`skills/` contains vendored files from `supabase/agent-skills`, pinned in `skills/.upstream.json`.

```bash
bun run skills:sync
# or: bun run skills:sync <commit-sha-or-ref>
```

After syncing, review skill diffs and run:

```bash
bun run typecheck
bun run test
bun run verify:pack
```

## Local OAuth Broker Testing

Normal users use the hosted broker. For local broker testing, set:

```bash
export OPENCODE_SUPABASE_BROKER_URL="https://<your-broker>"
export OPENCODE_SUPABASE_OAUTH_CLIENT_ID="<your-client-id>"
```

The OAuth app must allow:

- `http://localhost:14589/auth/callback`
- `http://localhost:14590/auth/callback`
- `http://localhost:14591/auth/callback`

See `docs/supabase-oauth-broker-contract.md` for the broker contract.

## Changesets

For user-visible or package-relevant changes:

```bash
bun run changeset
```

Commit the generated `.changeset/*.md` file with the change. Docs-only PRs usually do not need a changeset.
