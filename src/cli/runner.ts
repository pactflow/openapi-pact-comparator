import fs from "node:fs";
import yaml from "js-yaml";
import type { OpenAPIV2, OpenAPIV3 } from "openapi-types";
import type { AsyncAPIDocument } from "../documents/asyncapi";
import { Comparator, type Result } from "../index";

type OASDocument = OpenAPIV2.Document | OpenAPIV3.Document;

const MAX_EXIT_CODE = 255;

export interface SpecPaths {
  oasPath?: string;
  asyncapiPath?: string;
}

export interface ComparatorDocs {
  oas?: OASDocument;
  asyncapi?: AsyncAPIDocument;
}

export interface ComparatorLike {
  compare(pact: unknown): AsyncGenerator<Result>;
}

export interface RunnerDependencies {
  readFile: (path: string) => Promise<string>;
  fetch: (url: string) => Promise<Response>;
  output: (message: string) => void;
  createComparator: (docs: ComparatorDocs) => ComparatorLike;
}

const defaultDependencies: RunnerDependencies = {
  readFile: (path: string) => fs.promises.readFile(path, { encoding: "utf-8" }),
  fetch: (url: string) => fetch(url),
  output: (message: string) => console.log(message),
  createComparator: (docs: ComparatorDocs) => new Comparator(docs),
};

export class Runner {
  private deps: RunnerDependencies;

  constructor(deps: Partial<RunnerDependencies> = {}) {
    this.deps = { ...defaultDependencies, ...deps };
  }

  private isUrl(path: string): boolean {
    try {
      const url = new URL(path);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  private async readContent(path: string): Promise<string> {
    if (this.isUrl(path)) {
      const response = await this.deps.fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    }
    return this.deps.readFile(path);
  }

  private parseContent(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch (error) {
      try {
        return yaml.load(content);
      } catch (_err) {
        throw error;
      }
    }
  }

  private async readAndParse(path: string): Promise<unknown> {
    const content = await this.readContent(path);
    return this.parseContent(content);
  }

  async run(
    specPaths: SpecPaths | string,
    pactPaths: string[],
  ): Promise<number> {
    const docs: ComparatorDocs = {};

    if (typeof specPaths === "string") {
      // Legacy: run(oasPath, pactPaths)
      docs.oas = (await this.readAndParse(specPaths)) as OASDocument;
    } else {
      if (specPaths.oasPath) {
        docs.oas = (await this.readAndParse(specPaths.oasPath)) as OASDocument;
      }
      if (specPaths.asyncapiPath) {
        docs.asyncapi = (await this.readAndParse(
          specPaths.asyncapiPath,
        )) as AsyncAPIDocument;
      }
    }

    const comparator = this.deps.createComparator(docs);

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

    return Math.min(errors, MAX_EXIT_CODE);
  }
}
