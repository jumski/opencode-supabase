import { transformFileAsync } from "@babel/core";
import typescript from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import hostRuntimeRewrite from "./host-runtime-rewrite.mjs";

const result = await transformFileAsync(process.argv[2], {
  configFile: false,
  babelrc: false,
  presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], typescript],
  plugins: [hostRuntimeRewrite],
});

process.stdout.write(result?.code ?? "");
