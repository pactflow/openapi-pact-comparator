import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";

const plugins = [commonjs(), typescript(), nodeResolve(), json()];

const onwarn = (warning, warn) => {
  if (
    warning.code === "CIRCULAR_DEPENDENCY" &&
    warning.message.includes("node_modules")
  ) {
    return;
  }
  warn(warning);
};

export default [
  {
    input: "src/cli.ts",
    onwarn,
    output: {
      file: "dist/cli.cjs",
      format: "cjs",
      sourcemap: true,
    },
    plugins,
  },
  {
    input: "src/index.ts",
    onwarn,
    output: {
      file: "dist/index.mjs",
      format: "es",
      sourcemap: true,
    },
    plugins,
  },
  {
    input: "src/index.ts",
    onwarn,
    output: {
      file: "dist/index.cjs",
      format: "cjs",
      sourcemap: true,
    },
    plugins,
  },
];
