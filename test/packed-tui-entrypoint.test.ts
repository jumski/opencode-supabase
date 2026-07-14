import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "opencode-supabase-packed-tui-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function run(command: string[], cwd: string) {
  return Bun.spawnSync(command, { cwd, env: process.env });
}

function output(result: Bun.SyncSubprocess) {
  return `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
}

describe("packed TUI entrypoint", () => {
  test("resolves at runtime and from TypeScript in an isolated consumer", () => {
    const pack = run(["npm", "pack", "--json", "--pack-destination", temp], root);
    expect(pack.exitCode, output(pack)).toBe(0);

    const [{ filename }] = JSON.parse(new TextDecoder().decode(pack.stdout));
    const tarball = join(temp, filename);
    const consumer = join(temp, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true }));
    const install = run(["npm", "install", "--package-lock=false", `file:${tarball}`, "typescript@^5"], consumer);
    expect(install.exitCode, output(install)).toBe(0);

    writeFileSync(
      join(consumer, "index.ts"),
      'import plugin from "opencode-supabase/tui";\nconst id: string = plugin.id;\nconsole.log(id);\n',
    );
    writeFileSync(
      join(consumer, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "Preserve", moduleResolution: "Bundler", noEmit: true, strict: true, skipLibCheck: true } }),
    );

    const imported = run([process.execPath, "-e", 'console.log((await import("opencode-supabase/tui")).default.id)'], consumer);
    expect(imported.exitCode, output(imported)).toBe(0);
    expect(new TextDecoder().decode(imported.stdout).trim()).toBe("supabase");

    const checked = run([join(consumer, "node_modules/.bin/tsc")], consumer);
    expect(checked.exitCode, output(checked)).toBe(0);
  }, 120_000);
});
