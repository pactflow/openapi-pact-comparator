import fs from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { cloneDeep } from "lodash-es";
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
  const results: Result[] = [];

  for await (const interactionResults of compare(oas, pact)) {
    results.push(
      ...interactionResults.map((r) => {
        const modified = cloneDeep(r);

        modified.mockDetails.mockFile = pactFile;
        modified.specDetails.specFile = oasFile;
        return modified as Result;
      }),
    );
  }

  const errors = results.filter((r) => r.type === "error");
  const warnings = results.filter((r) => r.type === "warning");

  console.log(
    JSON.stringify(
      {
        errors,
        failureReason: `Mock file "${resolve(
          process.argv[2],
        )}" is not compatible with spec file "${resolve(process.argv[3])}"`,
        success: errors.length === 0,
        warnings,
      },
      null,
      2,
    ),
  );
}

run();
