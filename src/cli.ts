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

async function run(oas, pact) {
  const results: Result[] = [];

  for await (const interactionResults of compare(oas, pact)) {
    results.push(...(interactionResults as Result[]));
  }

  const errors = results.filter((r) => r.type === "error");
  const warnings = results.filter((r) => r.type === "warning");

  console.log(
    JSON.stringify(
      {
        errors,
        success: errors.length === 0,
        warnings,
      },
      null,
      2,
    ),
  );
}

const pact = parse(fs.readFileSync(process.argv[2], "utf-8"));
const oas = parse(fs.readFileSync(process.argv[3], "utf-8"));

run(oas, pact);
