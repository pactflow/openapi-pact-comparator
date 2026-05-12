// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { describe, expect, it } from "vitest";
import { Comparator } from "../../src/compare";

const parse = (spec: string) => {
  try {
    return JSON.parse(spec);
  } catch {
    return yaml.load(spec);
  }
};

const FIXTURES = path.join(__dirname, "fixtures");

const makeRunner = (dir: string) => async () => {
  const pact = parse(
    await fs.promises.readFile(path.join(dir, "pact.json"), "utf-8"),
  );
  const oasFile = path.join(dir, "oas.yaml");
  const asyncapiFile = path.join(dir, "asyncapi.yaml");
  const resultFile = path.join(dir, "results.json");

  const oas = fs.existsSync(oasFile)
    ? parse(await fs.promises.readFile(oasFile, "utf-8"))
    : undefined;
  const asyncapi = fs.existsSync(asyncapiFile)
    ? parse(await fs.promises.readFile(asyncapiFile, "utf-8"))
    : undefined;

  const comparator = new Comparator({ oas, asyncapi });
  const results = [];
  for await (const result of comparator.compare(pact)) {
    results.push(result);
  }

  await expect(JSON.stringify(results, null, 2) + "\n").toMatchFileSnapshot(
    resultFile,
  );
};

const loadDir = (dir: string) => {
  for (const entry of fs.readdirSync(dir).sort()) {
    const fullPath = path.join(dir, entry);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    const isSkip = entry.endsWith(".skip");
    const isOnly = entry.endsWith(".only");
    const name = entry.replace(/\.(skip|only)$/, "");

    if (fs.existsSync(path.join(fullPath, "pact.json"))) {
      if (isSkip) it.skip(name);
      else if (isOnly) it.only(name, makeRunner(fullPath));
      else it(name, makeRunner(fullPath));
    } else {
      const fn = () => loadDir(fullPath);
      if (isSkip) describe.skip(name, fn);
      else if (isOnly) describe.only(name, fn);
      else describe(name, fn);
    }
  }
};

loadDir(FIXTURES);
