import fs from "node:fs/promises";
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
  const [oas, pact] = await Promise.all([
    fs.readFile(oasFile, { encoding: "utf-8" }),
    fs.readFile(pactFile, { encoding: "utf-8" }),
  ]);
  const errors: Result[] = [];
  const warnings: Result[] = [];

  for await (const result of compare(parse(oas), parse(pact))) {
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
