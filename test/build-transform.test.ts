import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeModuleIdForSpecifier as opentuiRuntimeModuleId } from "@opentui/core/runtime-plugin";

const transformScript = join(import.meta.dir, "..", "scripts", "transform-solid.mjs");
const rewriteModule = join(import.meta.dir, "..", "scripts", "host-runtime-rewrite.mjs");

function transform(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "transform-solid-test-"));
  try {
    const fixture = join(dir, "fixture.tsx");
    writeFileSync(fixture, source);
    const result = spawnSync("node", [transformScript, fixture], { encoding: "utf8", timeout: 60_000 });
    if (result.status !== 0) throw new Error(`transform failed: ${result.stderr}`);
    return result.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("host-runtime specifier rewriting", () => {
  test("encoder stays byte-compatible with @opentui/core/runtime-plugin", async () => {
    const { hostRuntimeSpecifiers, runtimeModuleIdForSpecifier } = await import(rewriteModule);
    for (const specifier of hostRuntimeSpecifiers) {
      expect(runtimeModuleIdForSpecifier(specifier)).toBe(opentuiRuntimeModuleId(specifier));
    }
  });

  test("rewrites static, side-effect, export, dynamic, and require specifiers", () => {
    const output = transform(`
      import { createSignal } from "solid-js";
      import "@opentui/core";
      export { createStore } from "solid-js/store";
      const lazy = import("solid-js");
      const legacy = require("solid-js");
      export const value = createSignal(0);
    `);
    expect(output).toContain('from "opentui:runtime-module:solid-js"');
    expect(output).toContain('import "opentui:runtime-module:%40opentui%2Fcore"');
    expect(output).toContain('from "opentui:runtime-module:solid-js%2Fstore"');
    expect(output).toContain('import("opentui:runtime-module:solid-js")');
    expect(output).toContain('require("opentui:runtime-module:solid-js")');
    expect(output).not.toContain('from "solid-js"');
  });

  test("leaves unrelated string literals unchanged", () => {
    const output = transform(`
      const label = "solid-js";
      const message = 'uses @opentui/core at runtime';
      export const render = () => <text>{label}{message}</text>;
    `);
    expect(output).toContain('"solid-js"');
    expect(output).toContain("'uses @opentui/core at runtime'");
    expect(output).not.toContain('label = "opentui:runtime-module:');
  });
});
