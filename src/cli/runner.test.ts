import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import yaml from "js-yaml";
import { Runner } from "./runner";
import type { Result } from "#results/index";

describe("Runner", () => {
  const defaultOasContent = JSON.stringify({ openapi: "3.0.0" });
  const defaultPactContent = JSON.stringify({ interactions: [] });

  let readFile: Mock;
  let output: Mock;
  let compare: Mock;
  let createComparator: Mock;

  const givenReadFileReturns = (...contents: string[]) => {
    readFile.mockReset();
    for (const content of contents) {
      readFile.mockResolvedValueOnce(content);
    }
  };

  const givenCompareReturns = (...resultsPerCall: Result[][]) => {
    let callCount = 0;
    compare.mockImplementation(async function* () {
      const results = resultsPerCall[callCount] ?? [];
      callCount++;
      for (const result of results) {
        yield result;
      }
    });
  };

  beforeEach(() => {
    readFile = vi.fn();
    output = vi.fn();
    compare = vi.fn();
    createComparator = vi.fn().mockReturnValue({ compare });
    givenReadFileReturns(defaultOasContent, defaultPactContent);
    givenCompareReturns([]);
  });

  const whenRunIsCalled = (oasPath: string, pactPaths: string[]) => {
    const runner = new Runner({ readFile, output, createComparator });
    return runner.run(oasPath, pactPaths);
  };

  describe("reading and parsing input files", () => {
    it("should parse JSON content", async () => {
      const oasDocument = {
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0" },
      };
      const pactDocument = { interactions: [] };
      const oasJsonContent = JSON.stringify(oasDocument);
      const pactJsonContent = JSON.stringify(pactDocument);
      givenReadFileReturns(oasJsonContent, pactJsonContent);

      await whenRunIsCalled("oas.json", ["pact.json"]);

      expect(createComparator).toHaveBeenCalledWith(oasDocument);
      expect(compare).toHaveBeenCalledWith(pactDocument);
    });

    it("should parse YAML content when JSON parsing fails", async () => {
      const oasDocument = {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0" },
      };
      const yamlContent = yaml.dump(oasDocument);
      givenReadFileReturns(yamlContent, defaultPactContent);

      await whenRunIsCalled("oas.yaml", ["pact.json"]);

      expect(createComparator).toHaveBeenCalledWith(oasDocument);
    });

    it("should throw JSON error when both JSON and YAML parsing fail", async () => {
      givenReadFileReturns("{ invalid json and not valid yaml either: [");

      await expect(
        whenRunIsCalled("invalid.txt", ["pact.json"]),
      ).rejects.toThrow(SyntaxError);
    });
  });

  describe("Comparator initialization", () => {
    it("should initialize Comparator with parsed OAS document", async () => {
      const oasDocument = { openapi: "3.0.0", paths: {} };
      givenReadFileReturns(JSON.stringify(oasDocument), defaultPactContent);

      await whenRunIsCalled("oas.json", ["pact.json"]);

      expect(createComparator).toHaveBeenCalledTimes(1);
      expect(createComparator).toHaveBeenCalledWith(oasDocument);
    });

    it("should reuse same Comparator instance for multiple pact files", async () => {
      const oasDocument = { openapi: "3.0.0" };
      const pactDocument1 = { interactions: [], name: "pact1" };
      const pactDocument2 = { interactions: [], name: "pact2" };
      givenReadFileReturns(
        JSON.stringify(oasDocument),
        JSON.stringify(pactDocument1),
        JSON.stringify(pactDocument2),
      );

      await whenRunIsCalled("oas.json", ["pact1.json", "pact2.json"]);

      expect(createComparator).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledTimes(2);
      expect(compare).toHaveBeenNthCalledWith(1, pactDocument1);
      expect(compare).toHaveBeenNthCalledWith(2, pactDocument2);
    });
  });

  describe("compare results handling", () => {
    it("should output results as JSON to stdout", async () => {
      const mockResults: Result[] = [
        {
          type: "warning",
          code: "request.header.unknown",
          message: "Test warning",
        },
      ];
      givenCompareReturns(mockResults);

      await whenRunIsCalled("oas.json", ["pact.json"]);

      expect(output).toHaveBeenCalledWith(JSON.stringify(mockResults));
    });

    it("should output separate JSON lines for each pact file", async () => {
      const results1: Result[] = [
        { type: "warning", code: "request.header.unknown", message: "warn 1" },
      ];
      const results2: Result[] = [
        { type: "warning", code: "request.query.unknown", message: "warn 2" },
      ];
      givenCompareReturns(results1, results2);
      givenReadFileReturns(
        defaultOasContent,
        defaultPactContent,
        defaultPactContent,
      );

      await whenRunIsCalled("oas.json", ["pact1.json", "pact2.json"]);

      expect(output).toHaveBeenCalledTimes(2);
      expect(output).toHaveBeenNthCalledWith(1, JSON.stringify(results1));
      expect(output).toHaveBeenNthCalledWith(2, JSON.stringify(results2));
    });
  });

  describe("exit codes", () => {
    it("should return 0 when no errors are found", async () => {
      givenCompareReturns([
        { type: "warning", code: "request.header.unknown", message: "warning" },
      ]);

      const exitCode = await whenRunIsCalled("oas.json", ["pact.json"]);

      expect(exitCode).toBe(0);
    });

    it("should return 1 when one pact file has errors", async () => {
      givenCompareReturns([
        {
          type: "error",
          code: "request.body.incompatible",
          message: "An error",
        },
      ]);

      const exitCode = await whenRunIsCalled("oas.json", ["pact.json"]);

      expect(exitCode).toBe(1);
    });

    it("should return count of pact files that have errors", async () => {
      givenCompareReturns(
        [
          {
            type: "error",
            code: "request.body.incompatible",
            message: "error",
          },
        ],
        [
          {
            type: "warning",
            code: "request.header.unknown",
            message: "warning",
          },
        ],
        [
          {
            type: "error",
            code: "request.body.incompatible",
            message: "error",
          },
        ],
      );
      givenReadFileReturns(
        defaultOasContent,
        defaultPactContent,
        defaultPactContent,
        defaultPactContent,
      );

      const exitCode = await whenRunIsCalled("oas.json", [
        "pact1.json",
        "pact2.json",
        "pact3.json",
      ]);

      expect(exitCode).toBe(2);
    });

    it("should count only one error per pact file even with multiple errors", async () => {
      givenCompareReturns([
        {
          type: "error",
          code: "request.body.incompatible",
          message: "First error",
        },
        {
          type: "error",
          code: "request.header.incompatible",
          message: "Second error",
        },
        {
          type: "error",
          code: "request.query.incompatible",
          message: "Third error",
        },
      ]);

      const exitCode = await whenRunIsCalled("oas.json", ["pact.json"]);

      expect(exitCode).toBe(1);
    });
  });

  describe("default dependencies", () => {
    it("should use default dependencies when none provided", () => {
      const runner = new Runner();
      expect(runner).toBeInstanceOf(Runner);
    });
  });
});
