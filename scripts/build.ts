import solid from "@opentui/solid/bun-plugin";

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
