# opencode-supabase

Supabase plugin for OpenCode.

![opencode-supabase screenshot](assets/screenshot.png)

## Get started

Requires OpenCode `>= 1.3.4`.

```bash
opencode plugin opencode-supabase
```

Launch `opencode` in your project, then run:

```
/supabase
```

Connect your account and ask your agent about Supabase capabilities.

## Bundled Supabase Skills

`opencode-supabase` ships the official Supabase agent skills by default:

- `supabase`
- `supabase-postgres-best-practices`

No separate `skills` CLI setup is required. Installing the plugin makes these skills available to OpenCode through the plugin server config hook.

### Disable Bundled Skills

If you want Supabase tools without bundled skills, disable them in plugin options:

```json
{
  "plugin": [
    ["opencode-supabase", { "skills": false }]
  ]
}
```

### Select Individual Skills

Per-skill config is a partial override. Omitted skills stay enabled.

```json
{
  "plugin": [
    ["opencode-supabase", {
      "skills": {
        "supabase-postgres-best-practices": false
      }
    }]
  ]
}
```

### Maintainer Skill Sync

Bundled skills are vendored as real files under `skills/` from `supabase/agent-skills`, pinned to an exact upstream commit in `skills/.upstream.json`.

```bash
bun run skills:sync
# or: bun run skills:sync <commit-sha-or-ref>
bun run typecheck
bun test
bun run verify:pack
```

Review the generated diff before releasing.

## OAuth Callback Contract

Plugin uses fixed localhost callback window for browser auth:

- `http://localhost:14589/auth/callback`
- `http://localhost:14590/auth/callback`
- `http://localhost:14591/auth/callback`

Your Supabase OAuth app must allow all 3 redirect URIs.

Maintainer note: deployed OAuth app config must stay in sync with this fixed callback set. If callback ports change in code later, update OAuth app setup too.

## Debug Logging

If you hit auth or tool errors and need logs for an issue, collect the newest OpenCode session log from its default log directory:

- macOS/Linux: `~/.local/share/opencode/log/`
- Windows: `%USERPROFILE%\.local\share\opencode\log`

Run OpenCode with debug logging enabled while reproducing the problem:

```bash
opencode --log-level DEBUG --print-logs
```

Then share that newest session log file in the issue. In our testing, the session log file is more reliable than redirecting `stderr` with `2>` for capturing plugin activity.

## Available today

- **Connect** your Supabase account from OpenCode
- **List** organizations and projects
- **Get** project API keys
- **Create** new Supabase projects

## Reference

- Supabase Management API: https://supabase.com/docs/reference/api/introduction

## Releasing

For user-visible or package-relevant changes, add a changeset in your PR:

```bash
bun run changeset
```

Commit the generated `.changeset/*.md` file with your code change.

Maintainers use a release PR workflow driven by Changesets. Internal-only changes can use the `no-changeset` label when appropriate.

See `docs/releasing.md` for the full maintainer runbook.
