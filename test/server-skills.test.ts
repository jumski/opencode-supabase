import { describe, expect, test } from "bun:test";
import {
  registerSupabaseSkillPaths,
  resolveEnabledSupabaseSkills,
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

  test("warns on non-boolean known skill values", () => {
    const warnings: unknown[] = [];
    expect(resolveEnabledSupabaseSkills({ skills: { supabase: "yes" } }, { warn: (_message, data) => warnings.push(data) })).toEqual([
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

  test("replaces disabled skills config with paths array", () => {
    const config: { skills?: { paths?: string[] } | false } = { skills: false };

    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
    });

    expect(config.skills).toEqual({
      paths: ["/plugin/skills/supabase", "/plugin/skills/supabase-postgres-best-practices"],
    });
  });

  test("replaces malformed paths with a fresh array", () => {
    const warnings: unknown[] = [];
    const config = { skills: { paths: "nope" as unknown as string[] } };

    registerSupabaseSkillPaths(config, undefined, {
      skillsRoot: "/plugin/skills",
      exists: () => true,
      warn: (_message, data) => warnings.push(data),
    });

    expect(config.skills.paths).toEqual([
      "/plugin/skills/supabase",
      "/plugin/skills/supabase-postgres-best-practices",
    ]);
    expect(warnings).toHaveLength(1);
  });
});
