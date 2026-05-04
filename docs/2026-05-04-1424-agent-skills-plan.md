# Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle Supabase agent skills with `opencode-supabase`, auto-load them by default, and give users simple opt-out and per-skill selection.

**Architecture:** Vendor skill files under repo-local `skills/`, register individual skill directories through the server plugin `config` hook, and keep updates deterministic through a manual sync script. No runtime clone, no build-time fetch, and no hidden release-time fetch.

**Tech Stack:** Bun, TypeScript, OpenCode plugin server config hook, GitHub Release assets from `supabase/agent-skills`, existing `bun test` test suite.

---

## File Structure

- `skills/.upstream.json` tracks source release metadata for vendored skills.
- `skills/supabase/` contains the vendored broad Supabase skill.
- `skills/supabase-postgres-best-practices/` contains the vendored Postgres best-practices skill.
- `scripts/sync-agent-skills.ts` downloads release tarballs and replaces managed skill directories.
- `src/server/skills.ts` resolves plugin options and registers selected skill directories.
- `src/server/index.ts` wires the new `config` hook into the existing plugin server export.
- `test/server-skills.test.ts` verifies option semantics and path registration behavior.
- `package.json` includes `skills/` in published files and adds `skills:sync`.
- `README.md` documents bundled skills, opt-out, per-skill config, and maintainer sync.
- `AGENTS.md` documents that `skills/` must remain real vendored files.

## Task 1: Add Initial Skill Provenance File

**Files:**
- Create: `skills/.upstream.json`

- [ ] **Step 1: Create `skills/.upstream.json`**

Use this exact content:

```json
{
  "source_repo": "supabase/agent-skills",
  "source_release": null,
  "source_version": null,
  "source_commit": null,
  "synced_at": null,
  "managed_paths": [
    "skills/supabase",
    "skills/supabase-postgres-best-practices"
  ],
  "assets": [
    "supabase.tar.gz",
    "supabase-postgres-best-practices.tar.gz"
  ]
}
```

- [ ] **Step 2: Verify directory file is readable**

Run:

```bash
bun -e 'const data = await Bun.file("skills/.upstream.json").json(); console.log(data.source_repo)'
```

Expected output:

```text
supabase/agent-skills
```

- [ ] **Step 3: Commit**

```bash
git add skills/.upstream.json
git commit -m "feat: track bundled skill provenance"
```

## Task 2: Add Manual Skill Sync Script

**Files:**
- Create: `scripts/sync-agent-skills.ts`
- Modify: `package.json`

- [ ] **Step 1: Add failing smoke test command for missing script**

Run:

```bash
bun run skills:sync --help
```

Expected before implementation:

```text
error: Script not found "skills:sync"
```

- [ ] **Step 2: Create `scripts/sync-agent-skills.ts`**

Use this implementation:

```ts
import { $ } from "bun";

const SOURCE_REPO = "supabase/agent-skills";
const SKILLS_DIR = "skills";
const MANAGED_SKILLS = ["supabase", "supabase-postgres-best-practices"] as const;
const ASSETS = MANAGED_SKILLS.map((skill) => `${skill}.tar.gz`);

async function commandText(strings: TemplateStringsArray, ...values: string[]) {
  return (await $(strings, ...values).text()).trim();
}

function usage() {
  return `Usage: bun run skills:sync [release-tag]\n\nIf release-tag is omitted, the latest ${SOURCE_REPO} release is used.`;
}

async function resolveRelease(inputTag: string | undefined) {
  const tag = inputTag ?? (await commandText`gh release view --repo ${SOURCE_REPO} --json tagName --jq .tagName`);
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const commit = await commandText`gh release view ${tag} --repo ${SOURCE_REPO} --json targetCommitish --jq .targetCommitish`;
  return { tag, version, commit };
}

async function main() {
  const arg = Bun.argv[2];
  if (arg === "--help" || arg === "-h") {
    console.log(usage());
    return;
  }

  const release = await resolveRelease(arg);
  const tmp = await commandText`mktemp -d`;

  try {
    await $`mkdir -p ${SKILLS_DIR}`;
    await $`gh release download ${release.tag} --repo ${SOURCE_REPO} --dir ${tmp} --pattern ${ASSETS[0]} --pattern ${ASSETS[1]}`;

    for (const skill of MANAGED_SKILLS) {
      await $`rm -rf ${SKILLS_DIR}/${skill}`;
      await $`tar -xzf ${tmp}/${skill}.tar.gz -C ${SKILLS_DIR}`;
    }

    const metadata = {
      source_repo: SOURCE_REPO,
      source_release: release.tag,
      source_version: release.version,
      source_commit: release.commit,
      synced_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      managed_paths: MANAGED_SKILLS.map((skill) => `${SKILLS_DIR}/${skill}`),
      assets: ASSETS,
    };

    await Bun.write(`${SKILLS_DIR}/.upstream.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Synced ${SOURCE_REPO} ${release.tag} into ${SKILLS_DIR}/`);
  } finally {
    await $`rm -rf ${tmp}`;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```

- [ ] **Step 3: Add package script**

Modify `package.json` scripts to include:

```json
"skills:sync": "bun scripts/sync-agent-skills.ts"
```

- [ ] **Step 4: Verify help output**

Run:

```bash
bun run skills:sync --help
```

Expected output includes:

```text
Usage: bun run skills:sync [release-tag]
```

- [ ] **Step 5: Run sync**

Run:

```bash
bun run skills:sync
```

Expected result:

- `skills/supabase/SKILL.md` exists.
- `skills/supabase-postgres-best-practices/SKILL.md` exists.
- `skills/.upstream.json` has non-null `source_release`.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/sync-agent-skills.ts skills/
git commit -m "feat: sync bundled Supabase skills"
```

## Task 3: Include Vendored Skills In Published Package

**Files:**
- Modify: `package.json`
- Check: `.npmignore`

- [ ] **Step 1: Update package files list**

Ensure `package.json` includes `skills/` in `files`:

```json
"files": [
  "src/",
  "skills/",
  "index.ts",
  "README.md"
]
```

- [ ] **Step 2: Check `.npmignore`**

If `.npmignore` contains a rule that excludes `skills/`, remove that rule or add an allow rule:

```text
!skills/
!skills/**
```

- [ ] **Step 3: Verify package contents**

Run:

```bash
bun run verify:pack
```

Expected output includes:

```text
skills/.upstream.json
skills/supabase/SKILL.md
skills/supabase-postgres-best-practices/SKILL.md
```

- [ ] **Step 4: Commit**

```bash
git add package.json .npmignore
git commit -m "feat: publish bundled Supabase skills"
```

## Task 4: Add Skill Option Resolver And Path Registration

**Files:**
- Create: `src/server/skills.ts`
- Create: `test/server-skills.test.ts`

- [ ] **Step 1: Write resolver tests**

Create `test/server-skills.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  resolveEnabledSupabaseSkills,
  registerSupabaseSkillPaths,
} from "../src/server/skills.ts";

describe("resolveEnabledSupabaseSkills", () => {
  test("enables all bundled skills by default", () => {
    expect(resolveEnabledSupabaseSkills(undefined)).toEqual([
      "supabase",
      "supabase-postgres-best-practices",
    ]);
  });

  test("disables all skills when skills is false", () => {
    expect(resolveEnabledSupabaseSkills({ skills: false })).toEqual([]);
  });

  test("keeps omitted skill keys enabled", () => {
    expect(resolveEnabledSupabaseSkills({ skills: { "supabase-postgres-best-practices": false } })).toEqual([
      "supabase",
    ]);
  });

  test("warns and ignores unknown skill keys", () => {
    const warnings: unknown[] = [];
    expect(resolveEnabledSupabaseSkills({ skills: { typo: false } }, { warn: (_message, data) => warnings.push(data) })).toEqual([
      "supabase",
      "supabase-postgres-best-practices",
    ]);
    expect(warnings).toHaveLength(1);
  });
});

describe("registerSupabaseSkillPaths", () => {
  test("adds selected skill directories", () => {
    const config: { skills?: { paths?: string[] } } = {};
    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
    });
    expect(config.skills?.paths).toEqual([
      "/plugin/skills/supabase",
      "/plugin/skills/supabase-postgres-best-practices",
    ]);
  });

  test("does not add duplicate paths", () => {
    const config = { skills: { paths: ["/plugin/skills/supabase"] } };
    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
    });
    expect(config.skills.paths).toEqual([
      "/plugin/skills/supabase",
      "/plugin/skills/supabase-postgres-best-practices",
    ]);
  });

  test("warns and skips missing directories", () => {
    const warnings: unknown[] = [];
    const config: { skills?: { paths?: string[] } } = {};
    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: (path) => !path.endsWith("postgres-best-practices"),
      warn: (_message, data) => warnings.push(data),
    });
    expect(config.skills?.paths).toEqual(["/plugin/skills/supabase"]);
    expect(warnings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test test/server-skills.test.ts
```

Expected before implementation:

```text
Cannot find module '../src/server/skills.ts'
```

- [ ] **Step 3: Create `src/server/skills.ts`**

Use this implementation:

```ts
import fs from "node:fs";
import path from "node:path";

export const BUNDLED_SUPABASE_SKILLS = [
  "supabase",
  "supabase-postgres-best-practices",
] as const;

export type BundledSupabaseSkill = (typeof BUNDLED_SUPABASE_SKILLS)[number];

type Warn = (message: string, data?: unknown) => void;

type ResolverDeps = {
  warn?: Warn;
};

type RegisterDeps = ResolverDeps & {
  skillsRoot?: string;
  exists?: (path: string) => boolean;
};

type ConfigWithSkills = {
  skills?: {
    paths?: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginSkillsOption(options: unknown) {
  if (!isRecord(options) || !("skills" in options)) return true;
  return options.skills;
}

export function resolveEnabledSupabaseSkills(options: unknown, deps: ResolverDeps = {}) {
  const value = pluginSkillsOption(options);
  if (value === false) return [];
  if (value === true || value === undefined) return [...BUNDLED_SUPABASE_SKILLS];

  if (!isRecord(value)) {
    deps.warn?.("invalid Supabase skills option; loading bundled skills", { value });
    return [...BUNDLED_SUPABASE_SKILLS];
  }

  const known = new Set<string>(BUNDLED_SUPABASE_SKILLS);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      deps.warn?.("unknown Supabase bundled skill option ignored", { skill: key });
    }
  }

  return BUNDLED_SUPABASE_SKILLS.filter((skill) => value[skill] !== false);
}

export function defaultSkillsRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../skills");
}

export function registerSupabaseSkillPaths(
  config: ConfigWithSkills,
  options: unknown,
  deps: RegisterDeps = {},
) {
  const skillsRoot = deps.skillsRoot ?? defaultSkillsRoot();
  const exists = deps.exists ?? fs.existsSync;
  const enabled = resolveEnabledSupabaseSkills(options, deps);

  config.skills = config.skills ?? {};
  config.skills.paths = config.skills.paths ?? [];

  for (const skill of enabled) {
    const skillPath = path.join(skillsRoot, skill);
    if (!exists(skillPath)) {
      deps.warn?.("bundled Supabase skill directory not found", { skill, path: skillPath });
      continue;
    }
    if (!config.skills.paths.includes(skillPath)) {
      config.skills.paths.push(skillPath);
    }
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
bun test test/server-skills.test.ts
```

Expected:

```text
pass
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 6: Commit**

```bash
git add src/server/skills.ts test/server-skills.test.ts
git commit -m "feat: resolve bundled Supabase skills"
```

## Task 5: Wire OpenCode Config Hook

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Modify server plugin to register skill paths**

Update `src/server/index.ts` to import and call the helper:

```ts
import type { Plugin } from "@opencode-ai/plugin";

import { createServerLogWriter, createSupabaseLogger } from "../shared/log.ts";
import { createSupabaseAuth } from "./auth.ts";
import { registerSupabaseSkillPaths } from "./skills.ts";
import { createSupabaseTools } from "./tools.ts";

const server: Plugin = async (input, options) => {
  const logger = createSupabaseLogger({
    write: createServerLogWriter(input.client),
  });

  return {
    config: async (config) => {
      registerSupabaseSkillPaths(config, options, {
        warn: (message, data) => logger.warn(message, data as Record<string, unknown>),
      });
    },
    auth: createSupabaseAuth(input, options, { logger }),
    tool: createSupabaseTools(input, options, { logger }),
  };
};

export default { id: "supabase", server };
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 3: Run tests**

Run:

```bash
bun test
```

Expected:

```text
all tests pass
```

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: auto-load bundled Supabase skills"
```

## Task 6: Document User And Maintainer Behavior

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add README section for bundled skills**

Add this section near install/configuration docs:

```md
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

Bundled skills are vendored as real files under `skills/` from `supabase/agent-skills` GitHub release assets.

```bash
bun run skills:sync
bun run typecheck
bun test
bun run verify:pack
```

Review the generated diff before releasing.
```

- [ ] **Step 2: Add AGENTS.md maintainer rule**

Add this section:

```md
## Bundled Supabase Skills

`skills/` contains real vendored files synced from `supabase/agent-skills` release tarballs.

- Do not replace `skills/` with a symlink or submodule.
- Do not fetch skills during plugin startup, normal build, or release artifact generation.
- Use `bun run skills:sync` to update vendored skills.
- Review skill diffs and `skills/.upstream.json` before release.
```

- [ ] **Step 3: Verify docs mention opt-out**

Run:

```bash
bun -e 'const text = await Bun.file("README.md").text(); if (!text.includes("skills\": false")) process.exit(1); console.log("ok")'
```

Expected output:

```text
ok
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document bundled Supabase skills"
```

## Task 7: Create Follow-Up Issue For Automatic Sync PRs

**Files:**
- No source files required.

- [ ] **Step 1: Create issue body file in temporary location**

Run:

```bash
cat > /tmp/opencode-supabase-sync-skills-issue.md <<'EOF'
## Goal

Port the automatic sync PR workflow from `supabase-community/supabase-plugin` so `opencode-supabase` can poll `supabase/agent-skills` releases and open PRs when vendored skills are stale.

## Current MVP

`opencode-supabase` vendors real skill files under `skills/` and updates them manually with `bun run skills:sync`.

## Reference

- `/home/jumski/Code/supabase-community/supabase-plugin/.github/workflows/sync-agent-skills.yml`
- `/home/jumski/Code/supabase-community/supabase-plugin/skills/.upstream.json`

## Desired Workflow

- Trigger weekly and via `workflow_dispatch`.
- Resolve latest `supabase/agent-skills` GitHub release.
- Compare release tag against `skills/.upstream.json`.
- Download `supabase.tar.gz`.
- Download `supabase-postgres-best-practices.tar.gz`.
- Replace `skills/supabase`.
- Replace `skills/supabase-postgres-best-practices`.
- Update `skills/.upstream.json`.
- Open PR with `peter-evans/create-pull-request`.

## Acceptance Criteria

- No runtime clone/install.
- No hidden build-time fetch.
- Sync PR contains real file diffs.
- Release remains deterministic.
EOF
```

- [ ] **Step 2: Create GitHub issue**

Run:

```bash
gh issue create --title "Port automatic agent-skills sync workflow" --body-file /tmp/opencode-supabase-sync-skills-issue.md
```

Expected output:

```text
https://github.com/jumski/opencode-supabase/issues/<number>
```

## Task 8: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```

Expected:

```text
no TypeScript errors
```

- [ ] **Step 2: Run tests**

```bash
bun test
```

Expected:

```text
all tests pass
```

- [ ] **Step 3: Verify package contents**

```bash
bun run verify:pack
```

Expected output includes:

```text
skills/.upstream.json
skills/supabase/SKILL.md
skills/supabase-postgres-best-practices/SKILL.md
```

- [ ] **Step 4: Manual OpenCode smoke test**

From a consumer repo, install and start OpenCode:

```bash
opencode plugin ../../opencode-supabase
opencode
```

Expected:

- `supabase` skill is listed as available.
- `supabase-postgres-best-practices` skill is listed as available.
- `/supabase` auth flow and tools still load.

- [ ] **Step 5: Manual opt-out smoke test**

Configure plugin options with:

```json
{
  "plugin": [
    ["../../opencode-supabase", { "skills": false }]
  ]
}
```

Restart OpenCode.

Expected:

- Bundled Supabase skill paths are not registered by the plugin.
- `/supabase` auth flow and tools still load.

- [ ] **Step 6: Commit final verification/docs if changed**

```bash
git status --short
git add .
git commit -m "test: verify bundled Supabase skills"
```

## Acceptance Criteria

- Fresh plugin install auto-loads bundled Supabase skills.
- Users can disable all bundled skills with `skills: false`.
- Users can disable individual bundled skills with object-form `skills` config.
- Omitted per-skill keys remain enabled.
- Unknown skill keys log warnings and do not break plugin startup.
- Missing bundled skill directories log warnings and do not break tools/auth.
- Package includes vendored skill files.
- User install has no runtime network, git, or setup tool dependency for skills.
- Manual maintainer sync exists and updates `skills/.upstream.json`.
- GitHub issue tracks future automatic sync PR workflow.

## Self-Review

- Spec coverage: covered default auto-load, opt-out, per-skill config, manual sync, package inclusion, docs, and future automation issue.
- Placeholder scan: no unresolved TBD/TODO placeholders.
- Type consistency: plan consistently uses `skills`, `registerSupabaseSkillPaths`, `resolveEnabledSupabaseSkills`, `skills/.upstream.json`, and the two bundled skill names.
