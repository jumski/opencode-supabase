import { fileURLToPath } from "node:url";
import { runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin";

const transform = fileURLToPath(new URL("transform-solid.mjs", import.meta.url));
const hostRuntimeSpecifiers = [
  "@opentui/core",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "@opentui/solid/jsx-dev-runtime",
  "solid-js",
  "solid-js/store",
] as const;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostRuntimeFilter = new RegExp(`^(?:${hostRuntimeSpecifiers.map(escapeRegExp).join("|")})$`);
const hostRuntimeImportFilter = new RegExp(`(["'])(?:${hostRuntimeSpecifiers.map(escapeRegExp).join("|")})\\1`, "g");

const solid = {
  name: "solid",
  setup(build: Bun.PluginBuilder) {
    build.onLoad({ filter: /\.tsx$/ }, ({ path }) => {
      const result = Bun.spawnSync(["node", transform, path]);
      if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
      const contents = new TextDecoder().decode(result.stdout).replace(hostRuntimeImportFilter, (match) => {
        const quote = match[0];
        return `${quote}${runtimeModuleIdForSpecifier(match.slice(1, -1))}${quote}`;
      });
      return { contents, loader: "js" } as const;
    });
  },
};

const hostRuntimeModules = {
  name: "opencode-host-runtime-modules",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: hostRuntimeFilter }, ({ path }) => {
      return {
        path: runtimeModuleIdForSpecifier(path),
        external: true,
      };
    });
  },
};

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist",
  naming: "tui.js",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [solid, hostRuntimeModules],
});

if (!result.success) {
  console.error(...result.logs);
  process.exit(1);
}

await Bun.write(
  "dist/tui.d.ts",
  'import type { TuiPlugin } from "@opencode-ai/plugin/tui";\ndeclare const plugin: { id: string; tui: TuiPlugin };\nexport default plugin;\n',
);
