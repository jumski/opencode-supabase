import { fileURLToPath } from "node:url";

const transform = fileURLToPath(new URL("transform-solid.mjs", import.meta.url));
const solid = {
  name: "solid",
  setup(build: Bun.PluginBuilder) {
    build.onLoad({ filter: /\.tsx$/ }, ({ path }) => {
      const result = Bun.spawnSync(["node", transform, path]);
      if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
      return { contents: result.stdout, loader: "js" } as const;
    });
  },
};

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist",
  naming: "tui.js",
  target: "bun",
  packages: "external",
  plugins: [solid],
});

if (!result.success) {
  console.error(...result.logs);
  process.exit(1);
}

await Bun.write(
  "dist/tui.d.ts",
  'import type { TuiPlugin } from "@opencode-ai/plugin/tui";\ndeclare const plugin: { id: string; tui: TuiPlugin };\nexport default plugin;\n',
);
