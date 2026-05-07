import { describe, expect, it } from "vitest";
import { Comparator } from "./index";
import { ParserError } from "#documents/oas";

describe("Comparator constructor", () => {
  describe("legacy OAS input", () => {
    it("accepts a valid OpenAPI 3 document", () => {
      expect(
        () => new Comparator({ openapi: "3.0.0", info: { title: "T", version: "1" }, paths: {} }),
      ).not.toThrow();
    });

    it("accepts a valid Swagger 2 document", () => {
      expect(
        () =>
          new Comparator({
            swagger: "2.0",
            info: { title: "T", version: "1" },
            paths: {},
          } as never),
      ).not.toThrow();
    });

    it("throws ParserError for a malformed legacy OAS object (no openapi/swagger key)", () => {
      expect(
        () => new Comparator({ paths: {}, info: { title: "broken" } } as never),
      ).toThrow(ParserError);
    });

    it("throws ParserError for a legacy OAS object with unexpected keys only", () => {
      expect(() => new Comparator({ paths: {} } as never)).toThrow(ParserError);
    });
  });

  describe("ComparatorOptions input", () => {
    it("accepts an empty options object without throwing", () => {
      expect(() => new Comparator({})).not.toThrow();
    });

    it("accepts options with only an oas key", () => {
      expect(
        () =>
          new Comparator({
            oas: { openapi: "3.0.0", info: { title: "T", version: "1" }, paths: {} },
          }),
      ).not.toThrow();
    });

    it("throws ParserError when oas value is malformed", () => {
      expect(
        () => new Comparator({ oas: { paths: {} } as never }),
      ).toThrow(ParserError);
    });

    it("accepts options with only an asyncapi key (no oas validation)", () => {
      expect(() => new Comparator({ asyncapi: undefined })).not.toThrow();
    });
  });
});
