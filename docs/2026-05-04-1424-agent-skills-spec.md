# Agent Skills Feature Spec

## Goal

Ship Supabase agent skills with `opencode-supabase` so a normal plugin install gives users both Supabase tools and Supabase-specific agent guidance without any extra setup step.

## Background

`supabase/agent-skills` publishes official Supabase skills that teach agents how to work with Supabase safely and correctly. The current manual install path, such as `npx skills add supabase/agent-skills`, is separate from installing `opencode-supabase`. That creates a gap: users may install the plugin and get Supabase auth/tools, but miss the guidance layer that improves correctness around RLS, Auth, migrations, CLI usage, and Postgres best practices.

OpenCode plugins can register extra skill directories by mutating `config.skills.paths` in the plugin server `config` hook. OpenCode treats each configured path as a directory root and scans it recursively for `**/SKILL.md`. This means `opencode-supabase` can register either a parent `skills/` directory or individual skill directories.

## Decisions

The MVP will vendor Supabase skills as real files inside this repository under `skills/` and auto-load them by default.

Runtime cloning is out of scope. Build-time or release-time hidden fetching is also out of scope. Skill updates should happen as reviewed source changes, not as hidden package-generation side effects.

The initial sync model is a manual reusable script. A future GitHub Action can reuse the same repo shape and metadata model to open automatic sync PRs.

## User Experience

Default install should require no skill-specific decision from the user. Installing `opencode-supabase` should enable:

- Supabase OAuth and tools.
- Bundled `supabase` skill.
- Bundled `supabase-postgres-best-practices` skill.

Users who do not want bundled skills can disable them with plugin options. Tools and `/supabase` auth must continue to work when skills are disabled.

Disable all bundled skills:

```json
{
  "plugin": [
    ["opencode-supabase", { "skills": false }]
  ]
}
```

Disable one bundled skill:

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

Load only the broad Supabase skill:

```json
{
  "plugin": [
    ["opencode-supabase", {
      "skills": {
        "supabase": true,
        "supabase-postgres-best-practices": false
      }
    }]
  ]
}
```

## Config Semantics

Supported plugin option shapes:

```ts
type SupabasePluginOptions = {
  skills?: boolean | Partial<Record<"supabase" | "supabase-postgres-best-practices", boolean>>;
};
```

Rules:

- Missing `skills` means all bundled skills are enabled.
- `skills: true` means all bundled skills are enabled.
- `skills: false` means no bundled skills are enabled.
- Object form is a partial override.
- Omitted keys in object form stay enabled.
- Unknown keys are logged as warnings and ignored.
- Missing bundled skill directories are logged as warnings and skipped.
- Duplicate path entries are not added to `config.skills.paths`.

## OpenCode Integration

The server plugin should add a `config` hook in `src/server/index.ts`. The hook should call a small helper that mutates `config.skills.paths` synchronously.

Use individual skill directories instead of the parent `skills/` directory:

```text
skills/supabase
skills/supabase-postgres-best-practices
```

This makes per-skill enablement simple and avoids loading disabled skills from a shared parent directory.

The hook must not perform network, git, or async filesystem setup work. It should only resolve local package paths, check selected skills, and push paths into the live config object.

## Vendored Skill Source

The source of truth for skill content remains `supabase/agent-skills`. This repository consumes tarball snapshots for a resolved upstream commit from that producer repo.

Vendored skills live under:

```text
skills/supabase
skills/supabase-postgres-best-practices
```

Provenance is tracked in:

```text
skills/.upstream.json
```

Initial metadata shape:

```json
{
  "source_repo": "supabase/agent-skills",
  "source_release": null,
  "source_version": null,
  "source_commit": null,
  "source_ref": null,
  "source_ref_type": null,
  "synced_at": null,
  "managed_paths": [
    "skills/supabase",
    "skills/supabase-postgres-best-practices"
  ],
  "assets": null
}
```

## Maintainer Workflow

For MVP, maintainers update skills manually:

```bash
bun run skills:sync
bun run typecheck
bun test
bun run verify:pack
```

The sync script should download the latest `supabase/agent-skills` default-branch commit by default. It should also support an explicit commit/ref:

```bash
bun run skills:sync -- 4bb13d858d19f1f848505a66f46fc9603fdcde95
```

After syncing, maintainers review the generated file diff and commit it as normal source. Releases package the already-vendored files from git.

## Future Automation

Create a GitHub issue for later automation. The issue should document how to port the automatic workflow from `supabase-community/supabase-plugin`.

Future automated workflow should:

- Run on a schedule and via `workflow_dispatch`.
- Resolve the latest `supabase/agent-skills` default-branch commit.
- Compare it against `skills/.upstream.json`.
- Download the upstream repository tarball at the resolved commit.
- Replace the vendored skill directories.
- Update `.upstream.json`.
- Open a PR with real file diffs.

The future workflow should not fetch skills during normal build, package, plugin startup, or user install.

## Non-Goals

- Runtime clone or install of `supabase/agent-skills`.
- User-facing setup tool for skills.
- Automatic update command in the plugin.
- Build-time network fetch.
- Release-time hidden fetch.
- Skill version manager UI.
- Auto-detection and reconciliation of globally installed duplicate skills.

## Acceptance Criteria

- Fresh plugin install auto-loads bundled Supabase skills.
- Users can disable all bundled skills.
- Users can disable individual bundled skills.
- Disabling skills does not disable OAuth, `/supabase`, or Supabase tools.
- Skills are vendored as real files, not symlinks or submodules.
- Published package includes `skills/**` and `skills/.upstream.json`.
- No runtime network or git dependency is introduced for users.
- Maintainer can sync skills manually and review diffs before release.
- Future automatic sync is tracked in a GitHub issue.
