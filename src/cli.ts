import fs from "node:fs";
import yaml from "js-yaml";
import { compare } from "./compare";

const parse = (spec: string) => {
  try {
    return JSON.parse(spec);
  } catch {
    return yaml.load(spec);
  }
};

async function run(oas, pact) {
  for await (const [interaction, errors, warnings] of compare(
    oas,
    pact,
  )) {
    if (errors.length || warnings.length) {
      console.log(
        JSON.stringify(
          { interaction: interaction.description, warnings, errors },
          null,
          2,
        ),
      );
    }
  }
}

const pact = parse(fs.readFileSync(process.argv[2], "utf-8"));
const oas = parse(fs.readFileSync(process.argv[3], "utf-8"));

run(oas, pact);
