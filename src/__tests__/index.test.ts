// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { expect, it } from "vitest";
import { Comparator } from "../../src/compare";

const parse = (spec: string) => {
  try {
    return JSON.parse(spec);
  } catch {
    return yaml.load(spec);
  }
};

const FIXTURES = path.join(__dirname, "fixtures");

for (const entry of fs.readdirSync(FIXTURES)) {
  const dir = path.join(FIXTURES, entry);
  const pactFile = path.join(dir, "pact.json");
  const oasFile = path.join(dir, "oas.yaml");
  const resultFile = path.join(dir, "opc-results.json");

  const runOpc = async () => {
    const pact = parse(await fs.promises.readFile(pactFile, "utf-8"));
    const oas = parse(await fs.promises.readFile(oasFile, "utf-8"));

    const comparator = new Comparator(oas);
    const results = [];
    for await (const result of comparator.compare(pact)) {
      results.push(result);
    }

    await expect(JSON.stringify(results, null, 2) + "\n").toMatchFileSnapshot(
      resultFile,
    );
  };

  if (entry.endsWith("skip")) {
    it.skip(entry.replace(/\.skip$/, ""));
  } else if (entry.endsWith("only")) {
    it.only(entry.replace(/\.only/, ""), runOpc);
  } else {
    it(entry, runOpc);
  }
}
