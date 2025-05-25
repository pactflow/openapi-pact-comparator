import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";

const plugins = [commonjs(), typescript(), nodeResolve(), json()];

export default [
  {
    input: "src/cli.ts",
    output: {
      file: "dist/cli.cjs",
      format: "cjs",
      sourcemap: true,
    },
    plugins,
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.mjs",
      format: "es",
      sourcemap: true,
    },
    plugins,
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.cjs",
      format: "cjs",
      sourcemap: true,
    },
    plugins,
  },
];
