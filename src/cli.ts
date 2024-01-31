import fs from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { compare } from "./compare";
import type { Result } from "./results";

const parse = (spec: string) => {
  try {
    return JSON.parse(spec);
  } catch {
    return yaml.load(spec);
  }
};

async function run() {
  const pactFile = resolve(process.argv[2]);
  const oasFile = resolve(process.argv[3]);
  const pact = parse(fs.readFileSync(pactFile, "utf-8"));
  const oas = parse(fs.readFileSync(oasFile, "utf-8"));
  const errors: Result[] = [];
  const warnings: Result[] = [];

  for await (const result of compare(oas, pact)) {
    result.mockDetails.mockFile = pactFile;
    result.specDetails.specFile = oasFile;

    const target = result.type === "error" ? errors : warnings;
    target.push(result);
  }

  console.log(
    JSON.stringify(
      {
        errors,
        failureReason: errors.length
          ? `Mock file "${pactFile}" is not compatible with spec file "${oasFile}"`
          : undefined,
        success: errors.length === 0,
        warnings,
      },
      null,
      2,
    ),
  );
}

run();
