// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import fs from "fs";
import yaml from "js-yaml";
import { omit } from "lodash-es";
import path from "path";
import { expect, it } from "vitest";
import { SwaggerMockValidatorFactory } from "@pactflow/swagger-mock-validator";
import { Comparator } from "../../src/compare";

const swaggerMockValidator = SwaggerMockValidatorFactory.create();

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
  const resultFile = path.join(dir, "results.json");
  const baselineFile = path.join(dir, "baseline.json");

  const runTest = async () => {
    const pact = parse(await fs.promises.readFile(pactFile, "utf-8"));
    const oas = parse(await fs.promises.readFile(oasFile, "utf-8"));

    const comparator = new Comparator(oas);
    const results = [];
    for await (const result of comparator.compare(pact)) {
      results.push(result);
    }

    await expect(JSON.stringify(results, null, 2)).toMatchFileSnapshot(
      resultFile,
    );
  };

  const runBaseline = async () => {
    const baseline = await swaggerMockValidator.validate({
      mockPathOrUrl: pactFile,
      specPathOrUrl: oasFile,
    });
    const orderedBaseline = [...baseline.errors, ...baseline.warnings]
      .sort((a, b) =>
        a.mockDetails.location.localeCompare(
          b.mockDetails.location,
          undefined,
          { numeric: true },
        ),
      )
      .map((r) =>
        omit(r, ["source", "mockDetails.mockFile", "specDetails.specFile"]),
      );
    await expect(JSON.stringify(orderedBaseline, null, 2)).toMatchFileSnapshot(
      baselineFile,
    );
  };

  if (entry.endsWith("skip")) {
    it.skip(entry.replace(/\.skip$/, ""));
  } else if (entry.endsWith("only")) {
    it.only(entry.replace(/\.only/, ""), runTest);
    it.only(`${entry.replace(/\.only/, "")} baseline`, runBaseline, 300_000);
  } else {
    it(entry, runTest);
    it(`${entry} baseline`, runBaseline, 300_000);
  }
}
