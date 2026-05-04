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

type ConfigWithSkills = object & {
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
  config: object,
  options: unknown,
  deps: RegisterDeps = {},
) {
  const configWithSkills = config as ConfigWithSkills;
  const skillsRoot = deps.skillsRoot ?? defaultSkillsRoot();
  const exists = deps.exists ?? fs.existsSync;
  const enabled = resolveEnabledSupabaseSkills(options, deps);

  configWithSkills.skills = configWithSkills.skills ?? {};
  configWithSkills.skills.paths = configWithSkills.skills.paths ?? [];

  for (const skill of enabled) {
    const skillPath = path.join(skillsRoot, skill);
    if (!exists(skillPath)) {
      deps.warn?.("bundled Supabase skill directory not found", { skill, path: skillPath });
      continue;
    }
    if (!configWithSkills.skills.paths.includes(skillPath)) {
      configWithSkills.skills.paths.push(skillPath);
    }
  }
}
