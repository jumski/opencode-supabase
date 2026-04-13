import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("phase 1 package contract", () => {
  test("exposes the dual-target exports", () => {
    expect(packageJson.name).toBe("opencode-supabase");
    expect(packageJson.main).toBe("./index.ts");
    expect(packageJson.exports["./server"]).toBe("./src/server/index.ts");
    expect(packageJson.exports["./tui"]).toBe("./src/tui/index.tsx");
    expect(packageJson["oc-plugin"]).toEqual(["server", "tui"]);
  });

  test("documents plugin install and debug log capture guidance", () => {
    expect(readme).toContain("opencode plugin opencode-supabase");
    expect(readme).toContain("opencode --log-level DEBUG --print-logs 2>opencode-supabase-debug.log");
    expect(readme).toContain("~/.local/share/opencode/log/");
    expect(readme).toContain("%USERPROFILE%\\.local\\share\\opencode\\log");
  });
});
