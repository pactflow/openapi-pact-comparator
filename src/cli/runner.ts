import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import yaml from "js-yaml";
import fs from "node:fs";
import { Comparator } from "../index";
import type { Result } from "#results/index";

type OASDocument = OpenAPIV2.Document | OpenAPIV3.Document;

export interface ComparatorLike {
  compare(pact: unknown): AsyncGenerator<Result>;
}

export interface RunnerDependencies {
  readFile: (path: string) => Promise<string>;
  output: (message: string) => void;
  createComparator: (oas: OASDocument) => ComparatorLike;
}

const defaultDependencies: RunnerDependencies = {
  readFile: (path: string) => fs.promises.readFile(path, { encoding: "utf-8" }),
  output: (message: string) => console.log(message),
  createComparator: (oas: OASDocument) => new Comparator(oas),
};

export class Runner {
  private deps: RunnerDependencies;

  constructor(deps: Partial<RunnerDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps };
  }

  private async readAndParse(filename: string): Promise<unknown> {
    const file = await this.deps.readFile(filename);
    try {
      return JSON.parse(file);
    } catch (error) {
      try {
        return yaml.load(file);
      } catch (_err) {
        throw error;
      }
    }
  }

  async run(oasPath: string, pactPaths: string[]): Promise<number> {
    const oas = (await this.readAndParse(oasPath)) as OASDocument;
    const comparator = this.deps.createComparator(oas);

    let errors = 0;
    for (const pactPath of pactPaths) {
      const pact = await this.readAndParse(pactPath);

      const results: Result[] = [];
      for await (const result of comparator.compare(pact)) {
        results.push(result);
      }

      errors += results.some((r) => r.type === "error") ? 1 : 0;
      this.deps.output(JSON.stringify(results));
    }

    return errors;
  }
}
