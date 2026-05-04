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
