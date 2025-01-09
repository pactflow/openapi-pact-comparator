import fs from "node:fs";
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
  const oasFile = process.argv[2];
  const pactFile = process.argv[3];
  const oas = parse(fs.readFileSync(oasFile, "utf-8"));
  const pact = parse(fs.readFileSync(pactFile, "utf-8"));
  const errors: Result[] = [];
  const warnings: Result[] = [];

  for await (const result of compare(oas, pact)) {
    const target = result.type === "error" ? errors : warnings;
    // explicitly rebuild result to get correct sort order
    target.push({
      code: result.code,
      message: result.message,
      mockDetails: result.mockDetails
        ? {
            interactionDescription: result.mockDetails?.interactionDescription,
            interactionState: result.mockDetails?.interactionState,
            location: result.mockDetails?.location,
            mockFile: pactFile,
            value: result.mockDetails?.value,
          }
        : undefined,
      source: "spec-mock-validation",
      specDetails: result.specDetails
        ? {
            location: result.specDetails?.location,
            pathMethod: result.specDetails.pathMethod,
            pathName: result.specDetails?.pathName,
            specFile: oasFile,
            value: result.specDetails?.value,
          }
        : undefined,
      type: result.type,
    });
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
