import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "src/cli.ts",
  output: {
    file: "dist/demo.mjs",
    format: "es",
  },
  plugins: [typescript(), json(), nodeResolve(), commonjs()],
};
