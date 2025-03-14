import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";

const common = {
  input: "src/index.ts",
  plugins: [commonjs(), typescript(), nodeResolve(), json()],
};

export default [
  {
    ...common,
    output: {
      file: "dist/index.mjs",
      format: "es",
      sourcemap: true,
    },
  },
  {
    ...common,
    output: {
      file: "dist/index.js",
      format: "cjs",
      sourcemap: true,
    },
  },
];
