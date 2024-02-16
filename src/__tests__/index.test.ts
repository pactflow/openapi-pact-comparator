import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { expect, it } from "vitest";
import { compare } from "../../src/compare";

const parse = (spec: string) => {
  try {
    return JSON.parse(spec);
  } catch {
    return yaml.load(spec);
  }
};

const FIXTURES = path.join(__dirname, "fixtures");

for (const entry of fs.readdirSync(FIXTURES)) {
  it(entry, async () => {
    const dir = path.join(FIXTURES, entry);
    const pactFile = path.join(dir, "pact.json");
    const oasFile = path.join(dir, "oas.yaml");

    const pact = parse(await fs.promises.readFile(pactFile, "utf-8"));
    const oas = parse(await fs.promises.readFile(oasFile, "utf-8"));

    let count = 0;
    for await (const result of compare(oas, pact)) {
      const resultFile = path.join(
        dir,
        `result-${String(count++).padStart(2, "0")}.json`,
      );
      expect(result).toMatchFileSnapshot(resultFile);
    }
  });
}
