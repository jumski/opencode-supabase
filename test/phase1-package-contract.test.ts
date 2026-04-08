import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("phase 1 package contract", () => {
  test("keeps the package private and exposes the dual-target exports", () => {
    expect(packageJson.name).toBe("opencode-supabase");
    expect(packageJson.private).toBe(true);
    expect(packageJson.exports["./server"]).toBe("./src/server/index.ts");
    expect(packageJson.exports["./tui"]).toBe("./src/tui/index.tsx");
  });

  test("documents CLI-first install with a manual config fallback", () => {
    expect(readme).toContain("opencode plugin ../../opencode-supabase");
    expect(readme).toContain(".opencode/opencode.jsonc");
    expect(readme).toContain(".opencode/tui.jsonc");
    expect(readme).toContain('"plugin": ["../../opencode-supabase"]');
    expect(readme).toContain("resolved from inside `.opencode/`, not from the consumer repo root");
  });
});
