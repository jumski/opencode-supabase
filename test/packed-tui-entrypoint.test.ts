import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "opencode-supabase-packed-tui-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const runtimeModuleIdForSpecifier = (specifier: string) => `opentui:runtime-module:${encodeURIComponent(specifier)}`;

const requiredRuntimeSpecifiers = ["@opentui/core", "@opentui/solid", "solid-js"] as const;
const allowedRuntimeSpecifiers = [
  ...requiredRuntimeSpecifiers,
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "solid-js/store",
] as const;

function run(command: [string, ...string[]], cwd: string) {
  const [executable, ...args] = command;
  const result = spawnSync(executable, args, { cwd, env: process.env });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
  };
}

function output(result: ReturnType<typeof run>) {
  return `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
}

describe("packed TUI entrypoint", () => {
  test("ships a compiled rich TUI using only canonical host runtime modules", () => {
    const consumer = join(temp, "consumer");
    function command(name: "npm" | "tsc") {
      const suffix = process.platform === "win32" ? ".cmd" : "";
      return name === "npm" ? `npm${suffix}` : join(consumer, `node_modules/.bin/tsc${suffix}`);
    }

    const pack = run([command("npm"), "pack", "--json", "--pack-destination", temp], root);
    expect(pack.exitCode, output(pack)).toBe(0);

    const [{ filename }] = JSON.parse(new TextDecoder().decode(pack.stdout));
    const tarball = join(temp, filename);
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true }));
    const install = run([command("npm"), "install", "--package-lock=false", `file:${tarball}`, "typescript@^5"], consumer);
    expect(install.exitCode, output(install)).toBe(0);

    writeFileSync(
      join(consumer, "index.ts"),
      'import plugin from "opencode-supabase/tui";\nconst id: string = plugin.id;\nconsole.log(id);\n',
    );
    writeFileSync(
      join(consumer, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { module: "Preserve", moduleResolution: "Bundler", noEmit: true, strict: true } }),
    );

    const installedPackage = join(consumer, "node_modules/opencode-supabase");
    const metadata = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
    expect(metadata.exports["./tui"]).toBe("./dist/tui.js");

    const bundled = readFileSync(join(installedPackage, "dist/tui.js"), "utf8");
    for (const specifier of requiredRuntimeSpecifiers) {
      expect(bundled).toContain(runtimeModuleIdForSpecifier(specifier));
    }
    for (const specifier of allowedRuntimeSpecifiers) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(bundled).not.toMatch(new RegExp(`(?:from\\s*|import\\s*\\(|require\\s*\\()(["'])${escaped}\\1`));
    }
    for (const malformed of [
      "opentui:runtime-module:@opentui/core",
      "opentui:runtime-module:@opentui/solid",
      "opentui:runtime-module:solid-js/store",
    ]) {
      expect(bundled).not.toContain(malformed);
    }
    expect(bundled).toContain("Starting authorization...");
    expect(bundled).toContain("Waiting for browser authorization...");
    for (const frame of ["280B", "2819", "2839", "2838", "283C", "2834", "2826", "2827", "2807", "280F"]) {
      expect(bundled).toContain(`\\u${frame}`);
    }

    for (const specifier of requiredRuntimeSpecifiers) {
      expect(metadata.dependencies?.[specifier]).toBeUndefined();
      expect(metadata.peerDependencies?.[specifier]).toBeDefined();
      expect(metadata.peerDependenciesMeta?.[specifier]?.optional).toBe(true);
      expect(metadata.devDependencies?.[specifier]).toBeDefined();
    }
    for (const runtimePath of ["@opentui/core", "@opentui/solid", "solid-js"]) {
      expect(existsSync(join(consumer, "node_modules", runtimePath))).toBe(false);
    }

    const checked = run([command("tsc")], consumer);
    expect(checked.exitCode, output(checked)).toBe(0);
  }, 120_000);
});
