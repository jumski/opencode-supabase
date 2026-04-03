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

  test("documents local-path install as the supported current path", () => {
    expect(readme).toContain("opencode plugin ../opencode-supabase");
    expect(readme).not.toContain("Primary package install:");
    expect(readme).toContain("Published package install via `opencode plugin opencode-supabase` is deferred");
  });
});
