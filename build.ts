import { build, BuildOptions } from "esbuild";

const opts: BuildOptions = {
  bundle: true,
  entryPoints: ["src/compare/index.ts"],
  outdir: "dist",
  packages: "external",
  platform: "node",
  sourcemap: true,
};

await Promise.all([
  build({
    ...opts,
    format: "cjs",
  }),
  build({
    ...opts,
    format: "esm",
    outExtension: { ".js": ".mjs" },
  }),
]);
