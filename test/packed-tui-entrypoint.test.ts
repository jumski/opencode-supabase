import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(root, "node_modules/.packed-tui-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("packed TUI entrypoint", () => {
  test("imports from node_modules without a host TSX preload", () => {
    const pack = Bun.spawnSync(["npm", "pack", "--json", "--pack-destination", temp], {
      cwd: root,
      env: process.env,
    });
    expect(pack.exitCode, new TextDecoder().decode(pack.stderr)).toBe(0);

    const [{ filename }] = JSON.parse(new TextDecoder().decode(pack.stdout));
    const extract = Bun.spawnSync(["tar", "-xzf", join(temp, filename), "-C", temp]);
    expect(extract.exitCode, new TextDecoder().decode(extract.stderr)).toBe(0);

    const packageRoot = join(temp, "package");
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const entrypoint = pathToFileURL(join(packageRoot, packageJson.exports["./tui"])).href;
    const imported = Bun.spawnSync([process.execPath, "-e", `console.log((await import(${JSON.stringify(entrypoint)})).default.id)`]);

    expect(imported.exitCode, new TextDecoder().decode(imported.stderr)).toBe(0);
    expect(new TextDecoder().decode(imported.stdout).trim()).toBe("supabase");
  });
});
