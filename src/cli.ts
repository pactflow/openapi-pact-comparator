#!/usr/bin/env node

import { program } from "commander";
import yaml from "js-yaml";
import fs from "node:fs";
import { Comparator } from "./index";
import packageJson from "../package.json";

const readAndParse = async (filename: string) => {
  const file = await fs.promises.readFile(filename, { encoding: "utf-8" });
  try {
    return JSON.parse(file);
  } catch (error) {
    try {
      return yaml.load(file);
    } catch (_err) {
      throw error;
    }
  }
};

program
  .version(packageJson.version)
  .command("opc")
  .description(
    `Compares an OAD file against one or more Pact files.

Comparison output is presented as ND-JSON, with one line per Pact file.

The exit code equals the number of Pact files with errors (not the number of errors in one comparison).`,
  )
  .argument("<oas>", "path to OAS file")
  .argument("<pact...>", "path(s) to Pact file(s)")
  .action(async (oasPath, pactPaths) => {
    const oas = await readAndParse(oasPath);
    const comparator = new Comparator(oas);

    let errors = 0;
    for (const pactPath of pactPaths) {
      const pact = await readAndParse(pactPath);

      const results = [];
      for await (const result of comparator.compare(pact)) {
        results.push(result);
      }

      errors += results.some((r) => r.type === "error") ? 1 : 0;
      console.log(JSON.stringify(results));
    }

    process.exit(errors);
  })
  .parse(process.argv);
