import { $ } from "bun";
import { existsSync } from "node:fs";
import { readdir, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SOURCE_REPO = "supabase/agent-skills";
const SKILLS_DIR = "skills";
const MANAGED_SKILLS = ["supabase", "supabase-postgres-best-practices"] as const;
const UPSTREAM_SKILLS_DIR = "skills";

async function commandText(strings: TemplateStringsArray, ...values: string[]) {
  return (await $(strings, ...values).text()).trim();
}

function usage() {
  return `Usage: bun run skills:sync <commit-sha>

  Pins vendored skills to an explicit upstream commit.
  Downloads a tarball from ${SOURCE_REPO} at <commit-sha>,
  replaces the managed skill directories, and records provenance
  in ${SKILLS_DIR}/.upstream.json.`;
}

async function resolveCommit(inputSha: string) {
  const fullSha = await commandText`gh api repos/${SOURCE_REPO}/commits/${inputSha} --jq .sha`;
  return fullSha;
}

async function copyDir(srcDir: string, destDir: string) {
  await $`rm -rf ${destDir}`;
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const arg = Bun.argv[2];
  if (arg === "--help" || arg === "-h") {
    console.log(usage());
    return;
  }
  if (!arg) {
    console.error("Error: commit SHA required. Run with --help for usage.");
    process.exit(1);
  }

  const commit = await resolveCommit(arg);
  const tmp = await commandText`mktemp -d`;
  const tarball = `${tmp}/repo.tar.gz`;

  try {
    await $`gh api repos/${SOURCE_REPO}/tarball/${commit} > ${tarball}`;
    await $`mkdir -p ${tmp}/extracted`;
    await $`tar -xzf ${tarball} -C ${tmp}/extracted`;

    const extractedDirs = await readdir(`${tmp}/extracted`);
    const repoRoot = `${tmp}/extracted/${extractedDirs[0]}`;

    for (const skill of MANAGED_SKILLS) {
      const srcPath = join(repoRoot, UPSTREAM_SKILLS_DIR, skill);
      if (!existsSync(srcPath)) {
        throw new Error(`Skill directory not found in upstream: ${UPSTREAM_SKILLS_DIR}/${skill}`);
      }
      await copyDir(srcPath, `${SKILLS_DIR}/${skill}`);
    }

    const metadata = {
      source_repo: SOURCE_REPO,
      source_release: null,
      source_version: null,
      source_commit: commit,
      source_ref: arg,
      synced_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      managed_paths: MANAGED_SKILLS.map((skill) => `${SKILLS_DIR}/${skill}`),
    };

    await Bun.write(`${SKILLS_DIR}/.upstream.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Synced ${SOURCE_REPO} ${commit.slice(0, 7)} into ${SKILLS_DIR}/`);
  } finally {
    await $`rm -rf ${tmp}`;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
