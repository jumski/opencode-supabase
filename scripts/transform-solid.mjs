import { transformFileAsync } from "@babel/core";
import typescript from "@babel/preset-typescript";
import solid from "babel-preset-solid";

const result = await transformFileAsync(process.argv[2], {
  configFile: false,
  babelrc: false,
  presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], typescript],
});

process.stdout.write(result?.code ?? "");
