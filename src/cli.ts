#!/usr/bin/env node

import { program } from "commander";
import packageJson from "../package.json";
import { Runner } from "./cli/runner";

program
  .version(packageJson.version)
  .command("opc")
  .description(
    `Compares an OAD file against one or more Pact files.

Comparison output is presented as ND-JSON, with one line per Pact file.

The exit code equals the number of Pact files with errors (not the number of errors in one comparison).`,
  )
  .argument("<oas>", "path or URL to OAD file")
  .argument("<pact...>", "path(s) or URL(s) to Pact file(s)")
  .action(async (oasPath: string, pactPaths: string[]) => {
    const runner = new Runner();
    const exitCode = await runner.run(oasPath, pactPaths);
    process.exit(exitCode);
  })
  .parse(process.argv);
